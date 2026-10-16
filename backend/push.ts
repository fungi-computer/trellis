import {
  countingGit,
  ReadCopyBudgetExceeded,
} from "@fungi.computer/agar/read-copy";
import { validate, type Catalog } from "@fungi.computer/braid";
import {
  dispatchAppGitPush,
  type AppGitPushFact,
  type GitBinding,
} from "@fungi.computer/agar/git";
import {
  changedWorkflowIds,
  listingGit,
  versionRefs,
  inspectWorkflowFile,
} from "@fungi.computer/workflows-wire";
import { definitionAppIds } from "./catalog.js";
import type { WorkflowIndexes, WorkflowPushIssue } from "./indexes.js";

/** Accepted push facts invalidate the list and refresh validation; they cannot start runs. */
export async function onWorkflowGitPush(
  {
    git,
    indexes,
    catalog,
  }: {
    git: GitBinding;
    indexes: WorkflowIndexes;
    catalog: (appIds: readonly string[]) => Promise<Catalog | null>;
  },
  raw: AppGitPushFact,
): Promise<void> {
  await dispatchAppGitPush(
    {
      onGitPush: async (fact) => {
        if (fact.repository !== "trellis") return;
        const updates = fact.updates.filter(
          (update) =>
            update.ref === "refs/heads/main" ||
            update.ref.startsWith("refs/tags/"),
        );
        if (updates.length === 0 && !fact.unexplained?.length) return;
        const snapshot = indexes.librarySnapshot();
        if (
          snapshot.snapshot &&
          updates.every(
            (update) => snapshot.snapshot?.refs[update.ref] === update.after,
          ) &&
          !fact.unexplained?.length
        )
          return;
        indexes.invalidateLibrary();
        const revision = indexes.librarySnapshot().revision;
        const controller = new AbortController();
        const counted = countingGit(git, {
          limit: 40,
          signal: controller.signal,
        });
        const source = listingGit(counted.git);
        // Accumulates only the App ids this push's own files actually name;
        // a later file in the same push extends it instead of refetching.
        let known: Catalog | null = null;
        const catalogFor = async (appIds: readonly string[]) => {
          const current = known;
          if (current === null) {
            known = await catalog(appIds);
            return known;
          }
          const missing = appIds.filter((id) => !(id in current));
          if (missing.length === 0) return current;
          const fetched = await catalog(missing);
          if (fetched === null) {
            known = null;
            return null;
          }
          known = { ...current, ...fetched };
          return known;
        };
        const zero = "0".repeat(40);
        const nextRefs = new Map(Object.entries(snapshot.snapshot?.refs ?? {}));
        const items = [...(snapshot.snapshot?.items ?? [])];
        const invalidate = () => {
          for (const item of snapshot.snapshot?.items ?? []) {
            indexes.documents.stale(`main:${item.workflowId}`);
            indexes.versionCopies.stale(item.workflowId);
          }
          indexes.invalidateLibrary();
        };
        try {
          if (fact.unexplained?.length) {
            invalidate();
            return;
          }
          const recorded = new Set(
            indexes
              .issues(fact.eventId)
              .map((row) => `${row.commit}:${row.workflowId}`),
          );
          for (const update of updates) {
            if (update.ref !== "refs/heads/main") continue;
            for (const workflowId of await changedWorkflowIds(
              source,
              update.before,
              update.after,
            )) {
              const key = `${update.after}:${workflowId}`;
              if (recorded.has(key)) continue;
              const file = await inspectWorkflowFile(
                source,
                workflowId,
                update.after,
              );
              const issues: WorkflowPushIssue[] =
                file.kind === "invalid" ? [...file.issues] : [];
              if (file.kind !== "missing") {
                const needed =
                  file.kind === "valid"
                    ? definitionAppIds(file.draft.definition)
                    : [];
                const resolved = await catalogFor(needed);
                if (resolved === null)
                  issues.push({
                    code: "catalog_unavailable",
                    message:
                      "App-method validation requires the lifecycle installation catalog",
                  });
                else if (file.kind === "valid")
                  issues.push(...validate(file.draft.definition, resolved));
              }
              if (indexes.librarySnapshot().revision !== revision) return;
              indexes.recordIssues(
                fact.eventId,
                update.after,
                workflowId,
                issues,
              );
              recorded.add(key);
              const scope = "main";
              const copied = indexes.documents.read(`${scope}:${workflowId}`);
              const known =
                (snapshot.snapshot?.refs[update.ref] ?? zero) ===
                  update.before ||
                (copied.kind === "ready" && copied.head === update.after);
              if (!known) {
                invalidate();
                return;
              }
              if (update.after === zero) {
                indexes.documents.stale(`${scope}:${workflowId}`);
                const remaining = indexes.drafts.read(workflowId);
                const position = items.findIndex(
                  (item) => item.workflowId === workflowId,
                );
                if (remaining) {
                  const row = {
                    workflowId,
                    title: remaining.definition.title,
                    draftRevision: remaining.revision,
                    published: null,
                  };
                  if (position < 0) items.push(row);
                  else items[position] = row;
                } else if (position >= 0) items.splice(position, 1);
                continue;
              }
              const doc =
                file.kind === "valid"
                  ? { ...file.draft, commit: update.after }
                  : null;
              indexes.documents.write(
                `${scope}:${workflowId}`,
                update.after,
                doc,
              );
              if (doc)
                indexes.documents.write(
                  `at:${workflowId}:${update.after}`,
                  update.after,
                  doc,
                );
              const position = items.findIndex(
                (item) => item.workflowId === workflowId,
              );
              const draft = indexes.drafts.read(workflowId);
              const title =
                draft?.definition.title ?? doc?.definition.title ?? null;
              if (title !== null) {
                const row = {
                  workflowId,
                  title,
                  draftRevision: draft?.revision ?? null,
                  published: doc
                    ? { commit: update.after, version: null }
                    : null,
                };
                if (position < 0) items.push(row);
                else items[position] = row;
              } else if (position >= 0) items.splice(position, 1);
            }
            if (update.after === zero) nextRefs.delete(update.ref);
            else nextRefs.set(update.ref, update.after);
          }
          for (const update of updates) {
            if (!update.ref.startsWith("refs/tags/")) continue;
            const candidateIds = items.map((item) => item.workflowId);
            const selected = candidateIds.flatMap((workflowId) =>
              versionRefs(workflowId, [
                { name: update.ref, hash: update.after },
              ]).map((tag) => ({ workflowId, ...tag })),
            )[0];
            if (!selected) continue;
            const { workflowId, version } = selected;
            const copied = indexes.versionCopies.read(workflowId);
            if (copied.kind !== "ready") {
              indexes.versionCopies.stale(workflowId);
              continue;
            }
            if (update.after === zero) {
              indexes.versionCopies.stale(workflowId);
              nextRefs.delete(update.ref);
              const row = items.find((item) => item.workflowId === workflowId);
              if (row?.published?.version === version)
                row.published.version = null;
              continue;
            }
            if (
              copied.value.some(
                (item) =>
                  item.version === version && item.commit === update.after,
              )
            )
              continue;
            if (
              update.before !== zero &&
              !copied.value.some(
                (item) =>
                  item.version === version && item.commit === update.before,
              )
            ) {
              indexes.versionCopies.stale(workflowId);
              continue;
            }
            const metadata = await source.readCommit(
              fact.repository,
              update.after,
            );
            if (indexes.librarySnapshot().revision !== revision) return;
            if (!metadata) {
              indexes.versionCopies.stale(workflowId);
              continue;
            }
            indexes.versionCopies.write(
              workflowId,
              update.after,
              [
                ...copied.value.filter((item) => item.version !== version),
                {
                  version,
                  commit: update.after,
                  committedAt: metadata.committedAt,
                  message: metadata.message,
                },
              ].sort((a, b) => b.version - a.version),
            );
            const row = items.find((item) => item.workflowId === workflowId);
            if (row?.published?.commit === update.after)
              row.published.version = version;
            nextRefs.set(update.ref, update.after);
          }
          if (snapshot.snapshot)
            indexes.recordLibrary(revision, {
              refs: Object.fromEntries(nextRefs),
              items: items
                .sort((a, b) => a.workflowId.localeCompare(b.workflowId))
                .slice(0, 100),
            });
        } catch (error) {
          if (!(error instanceof ReadCopyBudgetExceeded)) throw error;
          invalidate();
        } finally {
          controller.abort();
        }
      },
    },
    raw,
  );
}
