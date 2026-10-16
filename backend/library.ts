import { workflowIdSchema } from "@fungi.computer/braid";
import * as S from "effect/Schema";
import { countingGit } from "@fungi.computer/agar/read-copy";
import { sha256DigestSchema } from "@fungi.computer/puffball/effect";
import type { GitBinding } from "@fungi.computer/agar/git";
import {
  mayEnqueueBackground,
  type BackgroundBinding,
} from "@fungi.computer/puffball/background-replay";
import type { AppMethodCallContext } from "@fungi.computer/puffball/app-method-runtime";
import {
  commitFiles,
  moveRefs,
  type GitIdentity,
  type MoveRefRequest,
  type GitRefMovesOutcome,
} from "@fungi.computer/agar/git-commit";
import { validate, contentDigest, type Catalog } from "@fungi.computer/braid";

import type { WorkflowIndexes } from "./indexes.js";
import { definitionAppIds } from "./catalog.js";
import {
  draftDocument,
  listingGit,
  readPublishedWorkflow,
  readWorkflowAt as readAt,
  versionRefs,
  workflowDraftSchema as draftSchema,
  workflowFilePath,
  workflowFiles,
  workflowLibraryRepository,
  type WorkflowDraft,
} from "@fungi.computer/workflows-wire";
export function retainedDraft(draft: {
  readonly definition: WorkflowDraft["definition"];
  readonly layout: WorkflowDraft["layout"];
  readonly provenance?: WorkflowDraft["provenance"];
}): WorkflowDraft {
  const content = { definition: draft.definition, layout: draft.layout };
  if (draft.provenance !== undefined)
    return { ...content, provenance: draft.provenance };
  return content;
}
export function serializedDraft(draft: WorkflowDraft) {
  const content = {
    ...draft.definition,
    layout: draft.layout,
  };
  if (draft.provenance !== undefined)
    return JSON.stringify({ ...content, provenance: draft.provenance });
  return JSON.stringify(content);
}
const repository = workflowLibraryRepository;
const filePath = workflowFilePath;

/** Installation-local git owns documents; the catalog owns method validation. */
export function createWorkflowLibrary({
  git: gitAccess,
  author,
  catalog,
  background,
  index,
}: {
  git?: GitBinding;
  author: GitIdentity;
  catalog: (appIds: readonly string[]) => Promise<Catalog>;
  background?: BackgroundBinding;
  index?: Pick<
    WorkflowIndexes,
    | "recordPublication"
    | "publications"
    | "drafts"
    | "librarySnapshot"
    | "recordLibrary"
    | "invalidateLibrary"
    | "documents"
    | "versionCopies"
    | "frontier"
    | "libraryList"
    | "publicationJobs"
  >;
}) {
  function requireGit() {
    if (!gitAccess) throw new Error("Git access is not granted");
    return gitAccess;
  }
  async function refs() {
    return (await requireGit().info(repository))
      ? requireGit().refs(repository)
      : [];
  }
  async function head(ref: string) {
    return (await refs()).find((entry) => entry.name === ref)?.hash ?? null;
  }
  async function move(
    request: MoveRefRequest,
    next: readonly Pick<MoveRefRequest, "ref" | "expected">[] = [],
  ): Promise<GitRefMovesOutcome> {
    try {
      return await moveRefs(requireGit(), {
        repository: request.repository,
        source: request.source,
        commit: request.commit,
        updates: [{ ref: request.ref, expected: request.expected }, ...next],
      });
    } catch (cause) {
      if (!(cause instanceof RangeError)) throw cause;
      const current = await head(`refs/heads/${request.source}`);
      if (current === request.commit) throw cause;
      return { kind: "stale", ref: request.ref, head: current };
    }
  }
  function read(workflowId: string, at: "draft" | { commit: string }) {
    workflowIdSchema.parse(workflowId);
    if (at === "draft")
      return Promise.resolve(index?.drafts.read(workflowId) ?? null);
    const key = `at:${workflowId}:${at.commit}`;
    const copied = index?.documents.read(key);
    if (copied?.kind !== "ready")
      return Promise.resolve({ kind: "rebuilding" });
    return Promise.resolve(
      copied.value === null
        ? null
        : {
            ...S.decodeUnknownSync(draftSchema)(retainedDraft(copied.value)),
            commit: copied.value.commit,
          },
    );
  }
  async function saveDraft(
    workflowId: string,
    raw: unknown,
    expectedRevision: number,
  ) {
    workflowIdSchema.parse(workflowId);
    let draft: WorkflowDraft;
    try {
      draft = S.decodeUnknownSync(draftSchema)(raw, {
        onExcessProperty: "error",
      });
    } catch (cause) {
      if (!S.isSchemaError(cause)) throw cause;
      return {
        kind: "invalid" as const,
        issues: [
          {
            code: "schema",
            message: "Workflow definition or layout failed decoding",
          },
        ],
      };
    }
    const available = await catalog(definitionAppIds(draft.definition));
    const issues = validate(draft.definition, available);
    if (issues.length) return { kind: "invalid" as const, issues };
    if (!index) throw new Error("Workflow row storage unavailable");
    const body = draftDocument.omit({ revision: true }).parse(draft);
    return index.drafts.save(workflowId, body, expectedRevision);
  }
  function versions(workflowId: string) {
    workflowIdSchema.parse(workflowId);
    const copied = index?.versionCopies.read(workflowId);
    if (copied?.kind === "ready") return Promise.resolve(copied.value);
    const snapshot = index?.librarySnapshot().snapshot;
    if (
      snapshot &&
      versionRefs(
        workflowId,
        Object.entries(snapshot.refs).map(([name, hash]) => ({ name, hash })),
      ).length === 0
    )
      return Promise.resolve([]);
    return Promise.resolve({ kind: "rebuilding" as const });
  }
  const fileContent = (draft: WorkflowDraft) =>
    S.decodeUnknownSync(S.Json)(retainedDraft(draft));
  async function sameFile(left: WorkflowDraft, right: WorkflowDraft) {
    return (
      (await contentDigest(fileContent(left))) ===
      (await contentDigest(fileContent(right)))
    );
  }
  async function publish(
    workflowId: string,
    expectedRevision: number,
    caller?: AppMethodCallContext,
  ) {
    if (!index) throw new Error("Workflow row storage unavailable");
    const draft = index.drafts.read(workflowId);
    if (draft?.revision !== expectedRevision)
      return { kind: "conflict" as const, head: null };
    const retainedPublication = index.publicationJobs.existing(
      workflowId,
      expectedRevision,
      caller,
    );
    if (retainedPublication !== null) return retainedPublication;
    const issues = validate(
      draft.definition,
      await catalog(definitionAppIds(draft.definition)),
    );
    if (issues.length) return { kind: "invalid" as const, issues };
    const snapshot = index.librarySnapshot();
    const mainCopy = index.documents.read(`main:${workflowId}`);
    const versionsCopy = index.versionCopies.read(workflowId);
    if (
      mainCopy.kind === "ready" &&
      mainCopy.value &&
      versionsCopy.kind === "ready" &&
      (await sameFile(retainedDraft(draft), retainedDraft(mainCopy.value)))
    ) {
      for (const previous of versionsCopy.value) {
        const publication = index.publications.read(
          `${workflowId}:v${String(previous.version)}`,
        );
        if (
          publication.kind === "ready" &&
          (await sameFile(
            retainedDraft(draft),
            retainedDraft(publication.value),
          ))
        )
          return {
            kind: "published" as const,
            commit: publication.value.commit,
            version: publication.value.version,
          };
      }
    }
    if (caller && mayEnqueueBackground(caller))
      return index.publicationJobs.enqueue(
        workflowId,
        expectedRevision,
        caller,
      );
    if (!(await requireGit().info(repository)))
      await requireGit().create(repository, { defaultBranch: "main" });
    const references = await requireGit().refs(repository);
    const main =
      references.find((ref) => ref.name === "refs/heads/main")?.hash ?? null;
    const existing = versionRefs(workflowId, references);
    const result = await commitFiles(requireGit(), {
      repository,
      branch: "main",
      expectedHead: main,
      changes: [
        {
          path: filePath(workflowId),
          content: new TextEncoder().encode(
            serializedDraft(retainedDraft(draft)),
          ),
          mode: "100644",
        },
      ],
      message: `Publish ${workflowId}`,
      author,
    });
    if (result.kind === "stale")
      return { kind: "conflict" as const, head: result.head };
    if (result.kind === "updated")
      throw new Error("Unexpected ref-only publication");
    const version = (existing[0]?.version ?? 0) + 1;
    const tagRef = `refs/tags/${workflowId}@v${String(version)}`;
    const tag = await move({
      repository,
      ref: tagRef,
      expected: null,
      commit: result.commit,
      source: "main",
    });
    if (tag.kind === "stale" && tag.head !== result.commit)
      return { kind: "conflict" as const, head: tag.head };
    const saved = { ...retainedDraft(draft), commit: result.commit };
    const publication = {
      ...saved,
      workflowId,
      version,
      digest: S.decodeUnknownSync(sha256DigestSchema)(
        await contentDigest(S.decodeUnknownSync(S.Json)(draft.definition)),
      ),
    };
    index.recordPublication(publication, snapshot.revision);
    return { kind: "published" as const, commit: result.commit, version };
  }
  async function rebuildCopies(
    cursor: string | null,
    target?: { workflowId: string; at: { commit: string } },
  ) {
    if (!index) throw new Error("Workflow copy storage unavailable");
    const controller = new AbortController();
    const counted = countingGit(requireGit(), {
      limit: 40,
      signal: controller.signal,
    });
    const source = listingGit(counted.git);
    try {
      if (target) {
        workflowIdSchema.parse(target.workflowId);
        const at = target.at;
        const key = `at:${target.workflowId}:${at.commit}`;
        const copied = await index.documents.load(key, {
          git: requireGit(),
          signal: controller.signal,
          async rebuild(currentGit) {
            const available = await currentGit.info(repository);
            const commit = available ? at.commit : null;
            const value = available
              ? await readAt(listingGit(currentGit), target.workflowId, commit)
              : null;
            return { head: commit, value };
          },
        });
        if (copied.kind !== "ready") return { done: false, cursor: null };
        const doc = copied.value;
        if (doc)
          index.documents.write(
            `at:${target.workflowId}:${doc.commit}`,
            doc.commit,
            doc,
          );
        return { done: true, cursor: null };
      }
      const epoch = index.librarySnapshot().revision;
      const progress = cursor === null ? null : index.frontier.read(cursor);
      let state =
        progress?.kind === "ready" && progress.value.epoch === epoch
          ? progress.value
          : null;
      const key = String(epoch);
      if (!state) {
        const references = (await counted.git.info(repository))
          ? await counted.git.refs(repository)
          : [];
        const main =
          references.find((ref) => ref.name === "refs/heads/main")?.hash ??
          null;
        const ids = new Set<string>();
        for (const file of await workflowFiles(source, main)) {
          const id = file.name.endsWith(".json") ? file.name.slice(0, -5) : "";
          if (workflowIdSchema.safeParse(id).success) ids.add(id);
        }
        for (const ref of references)
          if (ref.name.startsWith("refs/tags/")) {
            const id = ref.name.slice("refs/tags/".length).split("@v")[0];
            if (
              id !== undefined &&
              workflowIdSchema.safeParse(id).success &&
              versionRefs(id, [ref]).length
            )
              ids.add(id);
          }
        state = {
          epoch,
          refs: references,
          ids: [...ids].sort().slice(0, 100),
          offset: 0,
          items: [],
          current: null,
          queue: [],
        };
      }
      const main =
        state.refs.find((ref) => ref.name === "refs/heads/main")?.hash ?? null;
      while (state.offset < state.ids.length) {
        const workflowId = state.ids[state.offset];
        if (workflowId === undefined)
          throw new Error("Workflow frontier is incomplete");
        if (state.current === null) {
          if (state.queue.length === 0) {
            const width = Math.min(4, Math.floor((40 - counted.total()) / 8));
            if (width === 0) break;
            state.queue = await Promise.all(
              state.ids
                .slice(state.offset, state.offset + width)
                .map(async (id) => {
                  const published = await readAt(source, id, main);
                  return {
                    workflowId: id,
                    main: published,
                    versions: [],
                    versionOffset: 0,
                  };
                }),
            );
          }
          const prepared = state.queue.shift();
          if (!prepared) throw new Error("Workflow cursor has no pending key");
          state.current = prepared;
        }
        const current = state.current;
        const tags = versionRefs(workflowId, state.refs).slice(0, 1000);
        while (current.versionOffset < tags.length && counted.total() < 36) {
          const tag = tags[current.versionOffset];
          if (tag === undefined)
            throw new Error("Workflow version frontier is incomplete");
          const metadata = await source.readCommit(repository, tag.commit);
          const historical = await readAt(source, workflowId, tag.commit);
          if (metadata)
            current.versions.push({
              ...tag,
              committedAt: metadata.committedAt,
              message: metadata.message,
            });
          if (historical) {
            index.documents.write(
              `at:${workflowId}:${tag.commit}`,
              tag.commit,
              historical,
            );
            const stored = {
              ...historical,
              workflowId,
              version: tag.version,
              digest: S.decodeUnknownSync(sha256DigestSchema)(
                await contentDigest(
                  S.decodeUnknownSync(S.Json)(historical.definition),
                ),
              ),
            };
            index.publications.write(
              `${workflowId}:v${String(tag.version)}`,
              tag.commit,
              stored,
            );
            index.publications.write(
              `${workflowId}:${tag.commit}`,
              tag.commit,
              stored,
            );
          }
          current.versionOffset++;
        }
        if (index.librarySnapshot().revision !== epoch)
          return { done: false, cursor: null };
        if (current.versionOffset < tags.length) break;
        const doc = current.main;
        index.documents.write(`main:${workflowId}`, main, current.main);
        for (const selected of [current.main])
          if (selected)
            index.documents.write(
              `at:${workflowId}:${selected.commit}`,
              selected.commit,
              selected,
            );
        index.versionCopies.write(workflowId, main, current.versions);
        if (doc) {
          let latest: { version: number; commit: string } | null = null;
          if (current.main)
            for (const version of current.versions.slice(0, 1)) {
              const historical = index.documents.read(
                `at:${workflowId}:${version.commit}`,
              );
              if (
                historical.kind === "ready" &&
                historical.value &&
                (await sameFile(
                  retainedDraft(current.main),
                  retainedDraft(historical.value),
                ))
              ) {
                latest = version;
                break;
              }
            }
          state.items.push({
            workflowId,
            title: doc.definition.title,
            draftRevision: index.drafts.read(workflowId)?.revision ?? null,
            published: current.main
              ? {
                  commit: latest?.commit ?? current.main.commit,
                  version: latest?.version ?? null,
                }
              : null,
          });
        }
        state.offset++;
        state.current = null;
      }
      if (index.librarySnapshot().revision !== epoch)
        return { done: false, cursor: null };
      if (state.offset === state.ids.length) {
        index.recordLibrary(epoch, {
          refs: Object.fromEntries(
            state.refs.map((ref) => [ref.name, ref.hash]),
          ),
          items: state.items,
        });
        index.frontier.stale(key);
        return { done: true, cursor: null };
      }
      index.frontier.write(key, main, state);
      return { done: false, cursor: key };
    } finally {
      controller.abort();
    }
  }
  function list() {
    const cached = index?.libraryList();
    return Promise.resolve(
      cached?.kind === "ready"
        ? cached.value.items
        : { kind: "unindexed" as const },
    );
  }
  async function history(workflowId: string) {
    const saved = await versions(workflowId);
    return Array.isArray(saved)
      ? saved.slice(0, 50).map(({ commit, committedAt, message }) => ({
          commit,
          committedAt,
          message,
        }))
      : [];
  }
  async function revert(
    workflowId: string,
    toCommit: string,
    expectedRevision: number,
  ) {
    const previous = await read(workflowId, { commit: toCommit });
    return previous && !("kind" in previous)
      ? saveDraft(workflowId, retainedDraft(previous), expectedRevision)
      : {
          kind: "invalid",
          issues: [
            { code: "schema", message: "Workflow file not found at commit" },
          ],
        };
  }
  async function published(
    workflowId: string,
    at: { version: number } | { commit: string },
  ) {
    return readPublishedWorkflow(requireGit(), workflowId, at, (commit) => {
      const copied = index?.documents.read(`at:${workflowId}:${commit}`);
      return copied?.kind === "ready" &&
        copied.head === commit &&
        copied.value?.commit === commit
        ? { ...retainedDraft(copied.value), commit }
        : null;
    });
  }
  function publishedRow(
    workflowId: string,
    at: { version: number } | { commit: string },
  ) {
    workflowIdSchema.parse(workflowId);
    if (!index) throw new Error("Workflow row storage unavailable");
    const key =
      "version" in at
        ? `${workflowId}:v${String(at.version)}`
        : `${workflowId}:${at.commit}`;
    const row = index.publications.read(key);
    if (row.kind !== "ready" || row.value.workflowId !== workflowId)
      return null;
    if (
      "version" in at
        ? row.value.version !== at.version
        : row.value.commit !== at.commit
    )
      return null;
    return row.value;
  }
  return {
    publishedRow,
    read,
    saveDraft,
    publish,
    versions,
    list,
    rebuildCopies,
    history,
    revert,
    published,
    continuePublication: (caller: AppMethodCallContext) => {
      if (!index) throw new Error("Workflow row storage unavailable");
      return index.publicationJobs.continue(caller, {
        git: requireGit(),
        author,
        background,
        catalog,
      });
    },
    publicationStatus: (
      workflowId: string,
      publicationId: string,
      caller: AppMethodCallContext,
    ) => {
      if (!index) throw new Error("Workflow row storage unavailable");
      return index.publicationJobs.status(workflowId, publicationId, caller);
    },
  };
}
