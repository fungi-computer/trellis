import * as S from "effect/Schema";
import { AppError } from "@fungi.computer/agar";
import { workflowDefinitionSchema } from "@fungi.computer/braid";
import { PublicationObservationTimeout } from "./draft-store.js";
import type { WorkflowClient } from "../workflow-client.js";
import type {
  Draft,
  DraftCatalog,
  DraftDocument,
  DraftStore,
} from "./draft-store.js";

function cancelled() {
  return new AppError("Publication observation cancelled", {
    code: "CANCELLED",
    retryable: false,
  });
}
async function waitForPublication(signal?: AbortSignal) {
  if (signal?.aborted) throw cancelled();
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      globalThis.clearTimeout(timer);
      reject(cancelled());
    };
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 1000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function publicationFailure(
  status: Extract<
    Awaited<ReturnType<WorkflowClient["publicationStatus"]>>,
    { kind: "failed" }
  >,
) {
  const code =
    status.reason === "git_conflict"
      ? "CONFLICT"
      : status.reason === "too_large"
        ? "FILE_TOO_LARGE"
        : status.reason === "access_changed"
          ? "CAPABILITY_REVOKED"
          : "HOST_FAILURE";
  return new AppError("Publication did not finish", {
    code,
    retryable:
      status.reason !== "too_large" && status.reason !== "access_changed",
    cause: status,
  });
}

/** Draft revisions belong to the App row; published commits remain immutable versions. */
export function rowDraftStore(
  client: WorkflowClient,
  workflowId: string,
): DraftStore {
  let discovery: DraftCatalog = { catalog: {}, appDisplay: {}, palette: {} };
  let pendingPublication: string | null = null;
  async function observePublication(
    publicationId: string,
    signal?: AbortSignal,
  ) {
    // This window may pause observation; the same durable job continues running.
    for (let observations = 0; observations < 60; observations++) {
      if (signal?.aborted) throw cancelled();
      const status = await client.publicationStatus(workflowId, publicationId);
      if (signal?.aborted) throw cancelled();
      if (status.kind === "publishing") {
        await waitForPublication(signal);
        continue;
      }
      if (pendingPublication === publicationId) pendingPublication = null;
      if (status.kind === "not_found")
        throw new AppError("Publication was not found", {
          code: "HOST_FAILURE",
          retryable: false,
        });
      if (status.kind === "failed") throw publicationFailure(status);
      return status.version;
    }
    throw new PublicationObservationTimeout();
  }

  function document(draft: Draft, revision: number): DraftDocument {
    return { draft, revision, ...discovery, durability: "persistent" };
  }
  function copiedDraft(source: {
    definition: unknown;
    layout: Draft["layout"];
    provenance?: Draft["provenance"];
  }): Draft {
    const draft: Draft = {
      definition: S.decodeUnknownSync(workflowDefinitionSchema)(
        source.definition,
      ),
      layout: source.layout,
    };
    if (source.provenance !== undefined)
      return { ...draft, provenance: source.provenance };
    return draft;
  }
  return {
    async readCatalog(appIds = []) {
      const { catalog, apps } = await client.catalog(appIds);
      discovery = {
        catalog,
        appDisplay: Object.fromEntries(
          apps.map(({ appId, displayName, icon }) => [
            appId,
            icon === undefined ? { displayName } : { displayName, icon },
          ]),
        ),
        palette: Object.fromEntries(
          apps.map(({ appId, methods }) => [
            appId,
            Object.fromEntries(
              Object.entries(methods).map(([method, summary]) => [
                method,
                { description: summary.description, digest: summary.digest },
              ]),
            ),
          ]),
        ),
      };
      return discovery;
    },
    async load(version) {
      const at =
        version === undefined
          ? "draft"
          : (await client.listVersions(workflowId)).find(
              (item) => item.version === version,
            );
      if (!at) return null;
      const loaded = await client.loadWorkflow(
        workflowId,
        at === "draft" ? at : { commit: at.commit },
      );
      if (!loaded) return null;
      if ("revision" in loaded)
        return document(copiedDraft(loaded), loaded.revision);
      const current = await client.loadWorkflow(workflowId, "draft");
      return document(
        copiedDraft(loaded),
        current && "revision" in current ? current.revision : 0,
      );
    },
    async save(draft, expectedRevision) {
      const result = await client.saveDraft(
        workflowId,
        draft,
        expectedRevision,
      );
      if (result.kind === "invalid")
        throw new Error(result.issues.map((issue) => issue.message).join("; "));
      if (result.kind === "conflict") {
        if (!result.current)
          throw new Error("The draft was removed. Reload the library.");
        return {
          status: "conflict",
          document: document(
            copiedDraft(result.current),
            result.current.revision,
          ),
        };
      }
      return {
        status: "saved",
        document: document(draft, result.revision),
      };
    },
    async restore(version, expectedRevision) {
      const selected = (await client.listVersions(workflowId)).find(
        (item) => item.version === version,
      );
      if (!selected) throw new Error("Published version was not found.");
      const source = await client.loadWorkflow(workflowId, {
        commit: selected.commit,
      });
      if (!source) throw new Error("Published version was not found.");
      const result = await client.revertDraft(
        workflowId,
        selected.commit,
        expectedRevision,
      );
      if (result.kind === "invalid")
        throw new Error(result.issues.map((issue) => issue.message).join("; "));
      if (result.kind === "conflict") {
        if (!result.current)
          throw new Error("The draft was removed. Reload the library.");
        return {
          status: "conflict",
          document: document(
            copiedDraft(result.current),
            result.current.revision,
          ),
        };
      }
      return {
        status: "saved",
        document: document(copiedDraft(source), result.revision),
      };
    },
    async listVersions() {
      return (await client.listVersions(workflowId)).map((item) => ({
        version: item.version,
        commit: item.commit,
        title: item.message,
        createdAt: new Date(item.committedAt * 1000).toISOString(),
      }));
    },
    async publish(revision, signal) {
      const result = await client.publishWorkflow(workflowId, revision);
      if (result.kind === "publishing_elsewhere")
        throw new AppError(
          "This draft is already publishing in another window.",
          { code: "CONFLICT", retryable: true, cause: result },
        );
      if (result.kind === "conflict")
        throw new AppError(
          "This draft changed elsewhere. Reload before publishing.",
          { code: "CONFLICT", retryable: false },
        );
      if (result.kind === "invalid")
        throw new AppError(
          result.issues.map((issue) => issue.message).join("; "),
          { code: "INVALID_ARGUMENT", retryable: false },
        );
      if (result.kind === "publishing") {
        pendingPublication = result.publicationId;
        return observePublication(result.publicationId, signal);
      }
      if (result.kind === "failed") throw publicationFailure(result);
      return result.version;
    },
    async checkPublication(signal) {
      if (pendingPublication === null)
        throw new AppError("No pending publication to check", {
          code: "INVALID_ARGUMENT",
          retryable: false,
        });
      return observePublication(pendingPublication, signal);
    },
  };
}
