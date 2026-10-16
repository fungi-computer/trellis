import { workflowIdSchema } from "@fungi.computer/braid";
import * as z from "zod";
import * as Schema from "effect/Schema";
import { workflowDefinitionSchema } from "@fungi.computer/braid";
import { createReadCopies } from "@fungi.computer/agar/read-copy";
import { gitSha1Schema } from "@fungi.computer/puffball/git-representation";
import { createPublicationJobs } from "./publication-job.js";
import { versionRefs } from "@fungi.computer/workflows-wire";
import type { GitBinding } from "@fungi.computer/agar/git";
import {
  document,
  publishedDocument,
  draftDocument,
  version,
  listings,
} from "@fungi.computer/workflows-wire";

/** The facet SQL boundary; rows are decoded rather than asserted into domain types. */
export type WorkflowSql = {
  exec(
    query: string,
    ...bindings: (string | number | null | ArrayBuffer)[]
  ): { toArray(): readonly unknown[] };
};
const issueSchema = z.object({
  code: z.string(),
  message: z.string(),
  graph: z.string().optional(),
  node: z.string().optional(),
  trigger: z.string().optional(),
  port: z.string().optional(),
  edge: z.number().optional(),
});
const pushRowSchema = z.strictObject({
  eventId: z.string(),
  commit: z.string(),
  workflowId: z.string(),
  issues: z.string(),
});
export type WorkflowPushIssue = z.output<typeof issueSchema>;

const copiedDocument = document.transform((raw) => ({
  ...raw,
  definition: Schema.decodeUnknownSync(workflowDefinitionSchema)(
    raw.definition,
  ),
}));

const librarySnapshotSchema = z.strictObject({
  refs: z.record(z.string(), gitSha1Schema),
  items: listings,
});

/** Facet-local draft rows, immutable publication copies and run identities. */
export type WorkflowStorage = {
  sql: WorkflowSql;
  transactionSync<T>(operation: () => T): T;
};
export function createWorkflowIndexes(storage: WorkflowStorage) {
  const { sql } = storage;
  sql.exec(
    "CREATE TABLE IF NOT EXISTS workflow_drafts (workflow_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  );
  const draftRow = z.strictObject({
    revision: z.number().int().positive(),
    body: z.string(),
  });
  const decodeDraft = (raw: unknown) => {
    const row = draftRow.parse(raw);
    const value = draftDocument.parse({
      ...z.record(z.string(), z.json()).parse(JSON.parse(row.body)),
      revision: row.revision,
    });
    return {
      ...value,
      definition: Schema.decodeUnknownSync(workflowDefinitionSchema)(
        value.definition,
      ),
    };
  };
  function readDraft(workflowId: string) {
    workflowIdSchema.parse(workflowId);
    const raw = sql
      .exec(
        "SELECT revision, body FROM workflow_drafts WHERE workflow_id = ?",
        workflowId,
      )
      .toArray()[0];
    return raw === undefined ? null : decodeDraft(raw);
  }
  sql.exec(
    'CREATE TABLE IF NOT EXISTS workflow_push_issues (eventId TEXT NOT NULL, "commit" TEXT NOT NULL, workflowId TEXT NOT NULL, issues TEXT NOT NULL, PRIMARY KEY (eventId, "commit", workflowId))',
  );
  const copies = createReadCopies(sql, {
    version: 2,
    maxRows: 4096,
    maxValueBytes: 1048576,
    maxBlobBytes: 1048576,
    maxBlobTotalBytes: 8388608,
  });
  const library = copies.open("workflow.library", librarySnapshotSchema);
  const generation = copies.open(
    "workflow.revision",
    z.number().int().nonnegative(),
  );
  const documents = copies.open("workflow.document", copiedDocument.nullable());
  const publications = copies.open(
    "workflow.publication",
    publishedDocument.transform((raw) => ({
      ...raw,
      definition: Schema.decodeUnknownSync(workflowDefinitionSchema)(
        raw.definition,
      ),
    })),
  );
  const versionCopies = copies.open(
    "workflow.versions",
    z.array(version).max(1000),
  );
  const rebuildingRow = z.strictObject({
    workflowId: z.string(),
    main: copiedDocument.nullable(),
    versions: z.array(version).max(1000),
    versionOffset: z.number().int().nonnegative(),
  });
  const frontier = copies.open(
    "workflow.frontier",
    z.strictObject({
      epoch: z.number().int().nonnegative(),
      refs: z.array(z.strictObject({ name: z.string(), hash: gitSha1Schema })),
      ids: z.array(z.string()).max(100),
      offset: z.number().int().nonnegative(),
      items: listings,
      current: rebuildingRow.nullable(),
      queue: z.array(rebuildingRow).max(4),
    }),
  );
  function mergeDraftListings(items: z.output<typeof listings>) {
    const saved = new Map(items.map((item) => [item.workflowId, item]));
    for (const raw of sql
      .exec(
        "SELECT workflow_id, revision, body FROM workflow_drafts ORDER BY workflow_id LIMIT 100",
      )
      .toArray()) {
      const row = z
        .object({
          workflow_id: workflowIdSchema,
          revision: z.number().int().positive(),
          body: z.string(),
        })
        .parse(raw);
      const draft = decodeDraft({ revision: row.revision, body: row.body });
      const previous = saved.get(row.workflow_id);
      saved.set(row.workflow_id, {
        workflowId: row.workflow_id,
        title: draft.definition.title,
        draftRevision: row.revision,
        published: previous?.published ?? null,
      });
    }
    return [...saved.values()]
      .sort((a, b) => a.workflowId.localeCompare(b.workflowId))
      .slice(0, 100);
  }
  function librarySnapshot() {
    const saved = library.read("all");
    const epoch = generation.read("all");
    return {
      revision: epoch.kind === "ready" ? epoch.value : 0,
      snapshot: saved.kind === "ready" ? saved.value : null,
    };
  }
  const indexes = {
    drafts: {
      read: readDraft,
      save(
        workflowId: string,
        body: Omit<z.output<typeof draftDocument>, "revision">,
        expectedRevision: number,
      ) {
        workflowIdSchema.parse(workflowId);
        return storage.transactionSync(() => {
          const current = readDraft(workflowId);
          if ((current?.revision ?? 0) !== expectedRevision)
            return { kind: "conflict" as const, current };
          const revision = expectedRevision + 1;
          const saved = draftDocument.parse({ ...body, revision });
          const { revision: savedRevision, ...content } = saved;
          sql.exec(
            "INSERT INTO workflow_drafts (workflow_id, revision, body, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(workflow_id) DO UPDATE SET revision = excluded.revision, body = excluded.body, updated_at = excluded.updated_at",
            workflowId,
            savedRevision,
            JSON.stringify(content),
            Date.now(),
          );
          const currentLibrary = librarySnapshot();
          const previous = currentLibrary.snapshot?.items.find(
            (item) => item.workflowId === workflowId,
          );
          library.write(
            "all",
            currentLibrary.snapshot?.refs["refs/heads/main"] ?? null,
            {
              refs: currentLibrary.snapshot?.refs ?? {},
              items: [
                ...(currentLibrary.snapshot?.items ?? []).filter(
                  (item) => item.workflowId !== workflowId,
                ),
                {
                  workflowId,
                  title: Schema.decodeUnknownSync(workflowDefinitionSchema)(
                    content.definition,
                  ).title,
                  draftRevision: revision,
                  published: previous?.published ?? null,
                },
              ]
                .sort((a, b) => a.workflowId.localeCompare(b.workflowId))
                .slice(0, 100),
            },
          );
          return { kind: "saved" as const, revision };
        });
      },
    },
    libraryList: () => library.read("all"),
    documents,
    versionCopies,
    publications,
    recordPublication(
      value: Parameters<typeof publications.write>[2],
      epoch: number,
    ) {
      storage.transactionSync(() => {
        const { workflowId, version: number, commit } = value;
        const saved: Pick<
          typeof value,
          "definition" | "layout" | "commit" | "provenance"
        > = {
          definition: value.definition,
          layout: value.layout,
          commit,
        };
        if (value.provenance !== undefined) saved.provenance = value.provenance;
        publications.write(`${workflowId}:v${String(number)}`, commit, value);
        publications.write(`${workflowId}:${commit}`, commit, value);
        documents.write(`main:${workflowId}`, commit, saved);
        documents.write(`at:${workflowId}:${commit}`, commit, saved);
        const previous = versionCopies.read(workflowId);
        versionCopies.write(
          workflowId,
          commit,
          [
            {
              version: number,
              commit,
              committedAt: Math.floor(Date.now() / 1000),
              message: `Publish ${workflowId}`,
            },
            ...(previous.kind === "ready" ? previous.value : []),
          ].slice(0, 1000),
        );
        const current = librarySnapshot();
        if (current.revision === epoch && current.snapshot)
          library.write("all", commit, {
            refs: {
              ...current.snapshot.refs,
              "refs/heads/main": commit,
              [`refs/tags/${workflowId}@v${String(number)}`]: commit,
            },
            items: current.snapshot.items.map((item) =>
              item.workflowId === workflowId
                ? { ...item, published: { commit, version: number } }
                : item,
            ),
          });
      });
    },
    recordBackgroundPublication(
      value: Parameters<typeof publications.write>[2],
      epoch: number,
      references: Awaited<ReturnType<GitBinding["refs"]>>,
    ) {
      storage.transactionSync(() => {
        const { workflowId, version: number, commit } = value;
        const saved: Pick<
          typeof value,
          "definition" | "layout" | "commit" | "provenance"
        > = { definition: value.definition, layout: value.layout, commit };
        if (value.provenance !== undefined) saved.provenance = value.provenance;
        publications.write(`${workflowId}:v${String(number)}`, commit, value);
        publications.write(`${workflowId}:${commit}`, commit, value);
        documents.write(`at:${workflowId}:${commit}`, commit, saved);
        const previous = versionCopies.read(workflowId);
        const retained = previous.kind === "ready" ? previous.value : [];
        const next = [
          {
            version: number,
            commit,
            committedAt: Math.floor(Date.now() / 1000),
            message: `Publish ${workflowId}`,
          },
          ...retained.filter((version) => version.version !== number),
        ]
          .sort((a, b) => b.version - a.version)
          .slice(0, 1000);
        versionCopies.write(workflowId, next[0]?.commit ?? commit, next);
        const main =
          references.find((ref) => ref.name === "refs/heads/main")?.hash ??
          null;
        const copiedMain = documents.read(`main:${workflowId}`);
        if (main === commit && (retained[0]?.version ?? 0) <= number)
          documents.write(`main:${workflowId}`, commit, saved);
        else if (copiedMain.kind === "ready" && copiedMain.head !== main)
          documents.stale(`main:${workflowId}`);
        const current = librarySnapshot();
        if (current.revision === epoch && current.snapshot) {
          const latest = versionRefs(workflowId, references)[0];
          library.write("all", main, {
            refs: Object.fromEntries(
              references.map((ref) => [ref.name, ref.hash]),
            ),
            items: current.snapshot.items.map((item) => {
              if (
                item.workflowId !== workflowId ||
                !latest ||
                (item.published?.version ?? 0) > latest.version
              )
                return item;
              return {
                ...item,
                published: { commit: latest.commit, version: latest.version },
              };
            }),
          });
        }
      });
    },
    frontier,
    librarySnapshot,
    recordLibrary(
      revision: number,
      snapshot: {
        refs: Record<string, string>;
        items: z.output<typeof listings>;
      },
    ) {
      if (librarySnapshot().revision === revision)
        library.write("all", snapshot.refs["refs/heads/main"] ?? null, {
          ...snapshot,
          items: mergeDraftListings(snapshot.items),
        });
    },
    invalidateLibrary(updates?: readonly { ref: string; after: string }[]) {
      const current = librarySnapshot();
      if (
        updates &&
        current.snapshot &&
        updates.every(
          ({ ref, after }) =>
            (current.snapshot?.refs[ref] ?? "0".repeat(40)) === after,
        )
      )
        return;
      generation.write("all", null, current.revision + 1);
      library.stale("all");
    },
    recordIssues(
      eventId: string,
      commit: string,
      workflowId: string,
      issues: readonly WorkflowPushIssue[],
    ) {
      sql.exec(
        'INSERT INTO workflow_push_issues (eventId, "commit", workflowId, issues) VALUES (?, ?, ?, ?) ON CONFLICT(eventId, "commit", workflowId) DO NOTHING',
        eventId,
        commit,
        workflowId,
        JSON.stringify(issues),
      );
    },
    issues(eventId: string) {
      return sql
        .exec(
          'SELECT eventId, "commit", workflowId, issues FROM workflow_push_issues WHERE eventId = ? ORDER BY workflowId, "commit"',
          eventId,
        )
        .toArray()
        .map((raw) => {
          const row = pushRowSchema.parse(raw);
          return {
            ...row,
            issues: z.array(issueSchema).parse(JSON.parse(row.issues)),
          };
        });
    },
  };
  const publicationJobs = createPublicationJobs(storage, {
    readDraft: (workflowId) => {
      const draft = readDraft(workflowId);
      return draft === null ? null : draftDocument.parse(draft);
    },
    revision: () => librarySnapshot().revision,
    publish: (value, epoch, refs) => {
      indexes.recordBackgroundPublication(
        {
          ...value,
          definition: Schema.decodeUnknownSync(workflowDefinitionSchema)(
            value.definition,
          ),
        },
        epoch,
        refs,
      );
    },
  });
  return { ...indexes, publicationJobs };
}
export type WorkflowIndexes = ReturnType<typeof createWorkflowIndexes>;
