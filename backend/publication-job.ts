import * as z from "zod";
import * as S from "effect/Schema";
import {
  Watchdog,
  watchdogSqliteRowSchema,
  type ConcurrentWatchdogRuntime,
  type WatchdogQueuedJob,
} from "@fungi.computer/watchdog";
import {
  begin,
  GitStepMaterialError,
  runStep,
  gitStepSchema,
  sqliteGitStepMaterial,
  dropMaterial,
  type GitStep,
  type GitStepResult,
} from "@fungi.computer/agar/git-steps";
import type { GitBinding } from "@fungi.computer/agar/git";
import type { GitIdentity } from "@fungi.computer/agar/git-commit";
import { countingGit } from "@fungi.computer/agar/read-copy";
import { advertisedRefs } from "@fungi.computer/agar/git-wire";
import {
  contentDigest,
  validate,
  workflowDefinitionSchema,
  type Catalog,
} from "@fungi.computer/braid";
import {
  actorLane,
  backgroundOriginSchema,
  type BackgroundBinding,
  type BackgroundOrigin,
  backgroundSyncRefusalSchema,
  type BackgroundSyncRefusal,
} from "@fungi.computer/puffball/background-replay";
import type { AppMethodCallContext } from "@fungi.computer/puffball/app-method-runtime";
import { sha256DigestSchema } from "@fungi.computer/puffball/effect";
import {
  draftDocument,
  publicationIds,
  publishedDocument,
  publicationFailure,
  publicationStatus,
  publicationComplete,
  publicationFailed,
  publishReply,
  workflowIdSchema,
} from "@fungi.computer/workflows-wire";
import type { WorkflowStorage } from "./indexes.js";
import { versionRefs } from "@fungi.computer/workflows-wire";
import { serializedDraft, retainedDraft } from "./library.js";
import { definitionAppIds } from "./catalog.js";

export type PublicationDraft = z.output<typeof draftDocument>;
export type StoredPublication = z.output<typeof publishedDocument>;
type PublicationStatus = z.output<typeof publicationStatus>;
type PublicationPorts = Readonly<{
  git: GitBinding;
  author: GitIdentity;
  background: BackgroundBinding | undefined;
  catalog: (appIds: readonly string[]) => Promise<Catalog>;
}>;
export type PublicationStore = Readonly<{
  readDraft: (workflowId: string) => PublicationDraft | null;
  revision: () => number;
  publish: (
    publication: StoredPublication,
    epoch: number,
    refs: Awaited<ReturnType<GitBinding["refs"]>>,
  ) => void;
}>;
const cargo = z.strictObject({
  publicationId: publicationIds.publication.schema,
  step: z.number().int().nonnegative(),
});
const rowSchema = z.strictObject({
  id: publicationIds.publication.schema,
  workflow_id: workflowIdSchema,
  revision: z.number().int().positive(),
  lane: z.string(),
  origin: z.string(),
  body: z.string().nullable(),
  epoch: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  attempts: z.number().int().min(0).max(2),
  phase: z.enum(["inspect", "create", "prepare", "git"]),
  checkpoint: z.string().nullable(),
  version: z.number().int().positive().nullable(),
  status: z.enum(["publishing", "published", "failed"]),
  reason: publicationFailure.nullable(),
  commit_oid: z.string().nullable(),
  request_key: z.string().nullable(),
  digest: z.string().refine(S.is(sha256DigestSchema)),
});
type Row = z.output<typeof rowSchema>;
type Progress = Readonly<{
  checkpoint: GitStep | null;
  version: number | null;
  result?: PublicationStatus;
  refs?: Awaited<ReturnType<GitBinding["refs"]>>;
  attempts?: number;
  phase?: Row["phase"];
}>;
const queue = (id: string) => `publication:${id}`;

/** StoredPublication cargo and status share the facet's existing SQLite owner with Watchdog. */
export function createPublicationJobs(
  storage: WorkflowStorage,
  store: PublicationStore,
) {
  const sql = {
    exec(
      statement: string,
      ...bindings: (string | number | ArrayBuffer | null)[]
    ) {
      const cursor = storage.sql.exec(statement, ...bindings);
      return {
        toArray: () =>
          cursor
            .toArray()
            .map((row) => S.decodeUnknownSync(watchdogSqliteRowSchema)(row)),
      };
    },
  };
  const owner = {
    sql,
    transactionSync: <T>(operation: () => T) =>
      storage.transactionSync(operation),
  };
  const material = sqliteGitStepMaterial(sql);
  sql.exec(
    "CREATE TABLE IF NOT EXISTS workflow_publication_jobs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, revision INTEGER NOT NULL, lane TEXT NOT NULL, origin TEXT NOT NULL, body TEXT, epoch INTEGER NOT NULL, step INTEGER NOT NULL, attempts INTEGER NOT NULL, phase TEXT NOT NULL, checkpoint TEXT, version INTEGER, status TEXT NOT NULL, reason TEXT, commit_oid TEXT, request_key TEXT, digest TEXT NOT NULL)",
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS workflow_publication_pending ON workflow_publication_jobs(lane,status)",
  );
  const live = new Set<string>();
  function read(id: string): Row | null {
    const raw = sql
      .exec("SELECT * FROM workflow_publication_jobs WHERE id = ?", id)
      .toArray()[0];
    return raw === undefined ? null : rowSchema.parse(raw);
  }
  function status(row: Row): Exclude<PublicationStatus, { kind: "not_found" }> {
    if (row.status === "published")
      return publicationComplete.parse({
        kind: "published",
        commit: row.commit_oid,
        version: row.version,
      });
    if (row.status === "failed")
      return publicationFailed.parse({ kind: "failed", reason: row.reason });
    return { kind: "publishing", publicationId: row.id };
  }
  function forDraft(workflowId: string, revision: number): Row | null {
    const raw = sql
      .exec(
        "SELECT * FROM workflow_publication_jobs WHERE workflow_id = ? AND revision = ? ORDER BY rowid DESC LIMIT 1",
        workflowId,
        revision,
      )
      .toArray()[0];
    return raw === undefined ? null : rowSchema.parse(raw);
  }
  function existing(
    workflowId: string,
    revision: number,
    caller?: AppMethodCallContext,
  ): z.output<typeof publishReply> | null {
    const row = forDraft(workflowId, revision);
    if (row === null) return null;
    const lane =
      caller?.actor.kind === "member" ? actorLane(caller.actor) : null;
    if (row.status === "publishing" && row.lane !== lane)
      return { kind: "publishing_elsewhere" };
    if (
      row.status !== "failed" ||
      (row.lane === lane &&
        caller?.idempotencyKey !== undefined &&
        row.request_key === caller.idempotencyKey)
    )
      return status(row);
    return null;
  }
  const queued = (row: Row): WatchdogQueuedJob => ({
    jobId: `${row.id}:${String(row.step)}`,
    queue: queue(row.id),
    lane: row.lane,
    priority: 0,
    state: "queued",
    payload: { publicationId: row.id, step: row.step },
    recovery: { maxRecoveries: 3 },
  });
  function storedOrigin(value: string): BackgroundOrigin | null {
    try {
      const decoded = backgroundOriginSchema.safeParse(JSON.parse(value));
      return decoded.success ? decoded.data : null;
    } catch (cause) {
      if (cause instanceof SyntaxError) return null;
      throw cause;
    }
  }
  const frameClosed = (signal: AbortSignal) => signal.aborted;
  async function runtime(lane: string, ports?: PublicationPorts) {
    const progress = new Map<string, Progress>();
    const terminal = new Set<string>();
    const claimed = new Set<string>();
    const retry = (jobId: string, row: Row, interrupted = false) => {
      if (!interrupted && row.attempts === 2)
        return { kind: "failed" as const, reason: "publication_failed" };
      progress.set(jobId, {
        checkpoint:
          row.checkpoint === null
            ? null
            : gitStepSchema.parse(JSON.parse(row.checkpoint)),
        version: row.version,
        attempts: interrupted ? row.attempts : row.attempts + 1,
      });
      return { kind: "completed" as const };
    };
    const runner: ConcurrentWatchdogRuntime = await Watchdog.make({
      owner,
      concurrentLane: lane,
      isAlive: (job) => Promise.resolve(live.has(job.jobId)),
      wake: { recompute: () => Promise.resolve() },
      execute: async (job, signal) => {
        const input = cargo.parse(job.payload);
        const row = read(input.publicationId);
        if (
          row?.status !== "publishing" ||
          row.lane !== lane ||
          job.lane !== lane ||
          row.step !== input.step
        )
          return { kind: "failed", reason: "publication_changed" };
        if (!ports) throw new Error("StoredPublication transport unavailable");
        live.add(job.jobId);
        claimed.add(job.jobId);
        try {
          if (frameClosed(signal)) return retry(job.jobId, row, true);
          const origin = storedOrigin(row.origin);
          if (origin === null || !ports.background)
            return { kind: "failed", reason: "access_changed" };
          const admission = await ports.background.admit(origin);
          if (admission.kind === "refused")
            return { kind: "failed", reason: admission.code };
          const git = countingGit(ports.git, { limit: 1, signal }).git;
          if (row.body === null)
            return { kind: "failed", reason: "publication_changed" };
          const draft = draftDocument.parse(JSON.parse(row.body));
          const definition = S.decodeUnknownSync(workflowDefinitionSchema)(
            draft.definition,
          );
          const catalog = await ports.catalog(definitionAppIds(definition));
          if (validate(definition, catalog).length) {
            progress.set(job.jobId, {
              checkpoint: null,
              version: row.version,
              result: { kind: "failed", reason: "publication_failed" },
            });
            return { kind: "completed" };
          }
          if (row.checkpoint === null) {
            if (frameClosed(signal)) return retry(job.jobId, row, true);
            if (row.phase === "inspect") {
              const exists = await git.info("trellis");
              progress.set(job.jobId, {
                checkpoint: null,
                version: null,
                phase: exists ? "prepare" : "create",
              });
              return { kind: "completed" };
            }
            if (row.phase === "create") {
              await git.create("trellis", { defaultBranch: "main" });
              progress.set(job.jobId, {
                checkpoint: null,
                version: null,
                phase: "prepare",
              });
              return { kind: "completed" };
            }
            const refs = await git.refs("trellis");
            if (frameClosed(signal)) return retry(job.jobId, row, true);
            const version =
              (versionRefs(row.workflow_id, refs)[0]?.version ?? 0) + 1;
            const checkpoint = await begin(
              {
                kind: "commit",
                requestKey: row.id,
                request: {
                  repository: "trellis",
                  branch: "main",
                  expectedHead:
                    refs.find((ref) => ref.name === "refs/heads/main")?.hash ??
                    null,
                  changes: [
                    {
                      path: `workflows/${row.workflow_id}.json`,
                      content: new TextEncoder().encode(
                        serializedDraft(
                          retainedDraft({ ...draft, definition }),
                        ),
                      ),
                      mode: "100644",
                    },
                  ],
                  message: `Publish ${row.workflow_id}`,
                  author: ports.author,
                },
                tags: [
                  {
                    ref: `refs/tags/${row.workflow_id}@v${String(version)}`,
                    expected: null,
                  },
                ],
              },
              material,
            );
            progress.set(job.jobId, { checkpoint, version, phase: "git" });
          } else {
            const checkpoint = gitStepSchema.parse(JSON.parse(row.checkpoint));
            let witnessedRefs:
              Awaited<ReturnType<GitBinding["refs"]>> | undefined;
            const witnessedGit: Pick<GitBinding, "exchange"> = {
              exchange: async (repository, request) => {
                const response = await git.exchange(repository, request);
                if (
                  request.service === "upload-pack" &&
                  request.phase === "advertise" &&
                  response.status === 200
                )
                  witnessedRefs = [...advertisedRefs(response.body)].map(
                    ([name, hash]) => ({ name, hash }),
                  );
                return response;
              },
            };
            const result: GitStepResult = await runStep(
              checkpoint,
              { git: witnessedGit, material },
              signal,
            );
            if ("done" in result) {
              const done = result.done;
              // Reuse the helper's fresh confirmation witness. An extra read
              // after the tag lands could fail or observe a different main.
              const refs =
                done.kind === "committed" ? witnessedRefs : undefined;
              const tag = `refs/tags/${row.workflow_id}@v${String(row.version)}`;
              const final: PublicationStatus =
                done.kind === "committed" &&
                refs?.some(
                  (ref) => ref.name === tag && ref.hash === done.commit,
                )
                  ? publicationComplete.parse({
                      kind: "published",
                      commit: done.commit,
                      version: row.version,
                    })
                  : {
                      kind: "failed",
                      reason:
                        done.kind === "too_large"
                          ? "too_large"
                          : "git_conflict",
                    };
              const completed = {
                checkpoint,
                version: row.version,
                result: final,
              };
              if (refs === undefined) progress.set(job.jobId, completed);
              else progress.set(job.jobId, { ...completed, refs });
            } else
              progress.set(job.jobId, {
                checkpoint: "next" in result ? result.next : checkpoint,
                version: row.version,
              });
          }
          if (frameClosed(signal)) return retry(job.jobId, row, true);
          return { kind: "completed" };
        } catch (cause) {
          if (
            frameClosed(signal) ||
            (cause instanceof Error && cause.name === "AbortError")
          )
            return retry(job.jobId, row, true);
          if (cause instanceof GitStepMaterialError)
            return { kind: "failed", reason: "publication_failed" };
          return retry(job.jobId, row);
        }
      },
      project: (transition) => {
        const settled = transition.settled;
        if (!settled) return;
        const input = cargo.parse(settled.payload);
        const row = read(input.publicationId);
        if (row?.status !== "publishing" || row.step !== input.step) return;
        let next =
          settled.outcome === "completed"
            ? progress.get(settled.jobId)
            : undefined;
        if (
          !next &&
          (settled.outcome === "cancelled" ||
            settled.failureReason === "execution_interrupted")
        ) {
          retry(settled.jobId, row, true);
          next = progress.get(settled.jobId);
        }
        if (!next || next.result?.kind === "failed") {
          const reason =
            next?.result?.kind === "failed"
              ? next.result.reason
              : settled.failureReason === "access_changed"
                ? "access_changed"
                : "publication_failed";
          sql.exec(
            "UPDATE workflow_publication_jobs SET status = 'failed', reason = ?, body = NULL WHERE id = ?",
            reason,
            row.id,
          );
          terminal.add(row.id);
          return;
        }
        if (next.result?.kind === "published") {
          if (row.body === null)
            throw new Error("StoredPublication draft missing");
          const { revision, ...draft } = draftDocument.parse(
            JSON.parse(row.body),
          );
          if (revision !== row.revision)
            throw new Error("StoredPublication revision mismatch");
          if (!next.refs) throw new Error("Confirmed publication refs missing");
          store.publish(
            publishedDocument.parse({
              ...draft,
              workflowId: row.workflow_id,
              commit: next.result.commit,
              version: next.result.version,
              digest: row.digest,
            }),
            row.epoch,
            next.refs,
          );
          sql.exec(
            "UPDATE workflow_publication_jobs SET status = 'published', commit_oid = ?, version = ?, body = NULL WHERE id = ?",
            next.result.commit,
            next.result.version,
            row.id,
          );
          terminal.add(row.id);
          return;
        }
        const successor = {
          ...row,
          step: row.step + 1,
          attempts: next.attempts ?? 0,
          phase: next.phase ?? row.phase,
          version: next.version,
          checkpoint:
            next.checkpoint === null ? null : JSON.stringify(next.checkpoint),
        };
        sql.exec(
          "UPDATE workflow_publication_jobs SET step = ?, attempts = ?, phase = ?, checkpoint = ?, version = ? WHERE id = ?",
          successor.step,
          successor.attempts,
          successor.phase,
          successor.checkpoint,
          successor.version,
          row.id,
        );
        runner.transactional.enqueueAcceptedJob(queued(successor));
      },
    });
    return {
      runner,
      release: () => {
        for (const id of claimed) live.delete(id);
      },
      cleanup: async () => {
        for (const id of terminal) {
          const row = read(id);
          if (row && row.status !== "publishing" && row.checkpoint !== null)
            await dropMaterial(
              gitStepSchema.parse(JSON.parse(row.checkpoint)),
              material,
            );
        }
        terminal.clear();
      },
    };
  }
  return {
    existing,
    async enqueue(
      workflowId: string,
      revision: number,
      caller: AppMethodCallContext,
    ): Promise<z.output<typeof publishReply>> {
      const lane = actorLane(caller.actor);
      const draft = store.readDraft(workflowId);
      if (draft?.revision !== revision) return { kind: "conflict", head: null };
      const { runner } = await runtime(lane);
      const digest = S.decodeUnknownSync(sha256DigestSchema)(
        await contentDigest(S.decodeUnknownSync(S.Json)(draft.definition)),
      );
      return storage.transactionSync(() => {
        if (store.readDraft(workflowId)?.revision !== revision)
          return { kind: "conflict" as const, head: null };
        const retained = existing(workflowId, revision, caller);
        if (retained !== null) return retained;
        const row: Row = {
          id: publicationIds.publication.generate(),
          workflow_id: workflowId,
          revision,
          lane,
          origin: JSON.stringify(
            backgroundOriginSchema.parse(caller.backgroundOrigin),
          ),
          body: JSON.stringify(draft),
          epoch: store.revision(),
          step: 0,
          attempts: 0,
          phase: "inspect",
          checkpoint: null,
          version: null,
          status: "publishing",
          reason: null,
          commit_oid: null,
          request_key: caller.idempotencyKey ?? null,
          digest,
        };
        sql.exec(
          "INSERT INTO workflow_publication_jobs(id,workflow_id,revision,lane,origin,body,epoch,step,attempts,phase,checkpoint,version,status,reason,commit_oid,request_key,digest) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          row.id,
          workflowId,
          revision,
          lane,
          row.origin,
          row.body,
          row.epoch,
          row.step,
          row.attempts,
          row.phase,
          row.checkpoint,
          row.version,
          row.status,
          row.reason,
          row.commit_oid,
          row.request_key,
          row.digest,
        );
        runner.transactional.enqueueAcceptedJob(queued(row));
        return status(row);
      });
    },
    async continue(caller: AppMethodCallContext, ports: PublicationPorts) {
      if (caller.actor.kind !== "member" || caller.workflow !== undefined)
        return { more: false };
      const lane = actorLane(caller.actor);
      if (caller.backgroundLane !== undefined && caller.backgroundLane !== lane)
        return { more: false };
      // R0 strips enqueue markers on readmission. A sealed foreground write
      // is still foreground, even if its host exposes a refusing binding.
      if (
        caller.backgroundOrigin !== undefined ||
        caller.backgroundLane !== undefined ||
        !ports.background
      )
        return {
          more:
            sql
              .exec(
                "SELECT id FROM workflow_publication_jobs WHERE lane = ? AND status = 'publishing' LIMIT 1",
                lane,
              )
              .toArray().length !== 0,
        };
      const { runner, cleanup, release } = await runtime(lane, ports);
      try {
        await runner.tickConcurrent();
      } finally {
        release();
      }
      await cleanup();
      return {
        more:
          sql
            .exec(
              "SELECT id FROM workflow_publication_jobs WHERE lane = ? AND status = 'publishing' LIMIT 1",
              lane,
            )
            .toArray().length !== 0,
      };
    },
    status(
      workflowId: string,
      publicationId: string,
      caller: AppMethodCallContext,
    ): PublicationStatus {
      const row = read(publicationId);
      return caller.actor.kind === "member" &&
        row?.workflow_id === workflowId &&
        row.lane === actorLane(caller.actor)
        ? status(row)
        : { kind: "not_found" };
    },
    async refused(input: BackgroundSyncRefusal) {
      const refusal = backgroundSyncRefusalSchema.parse(input);
      const { runner, cleanup } = await runtime(refusal.lane);
      let more: boolean;
      do {
        const result = await runner.failLane({
          lane: refusal.lane,
          reason: refusal.code,
        });
        more = result.more;
        await cleanup();
      } while (more);
    },
  };
}
