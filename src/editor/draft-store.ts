import type { Catalog, WorkflowDefinition } from "@fungi.computer/braid";
import type * as z from "zod";
import { AppError } from "@fungi.computer/agar/errors";
import {
  publicationElsewhere,
  publicationFailed,
} from "@fungi.computer/workflows-wire";
import type { provenanceSchema } from "@fungi.computer/workflows-wire";

/** Layout never enters compilation or changes a plan's identity. */
export type Draft = Readonly<{
  definition: WorkflowDefinition;
  layout: Readonly<Record<string, Readonly<{ x: number; y: number }>>>;
  provenance?: z.output<typeof provenanceSchema>;
}>;
export type DraftDocument = Readonly<{
  draft: Draft;
  revision: number;
  catalog: Catalog;
  appDisplay: Readonly<
    Partial<Record<string, Readonly<{ displayName: string; icon?: string }>>>
  >;
  /**
   * Every installed App's addable methods, from the bounded catalog index.
   * `catalog` holds full ports only for Apps the draft names; the palette
   * offers every installation, and adding a node names its App, which loads
   * that App's ports.
   */
  palette: Palette;
  durability: "memory" | "persistent";
}>;
export type Palette = Readonly<
  Record<
    string,
    Readonly<Record<string, Readonly<{ description: string; digest: string }>>>
  >
>;
export type DraftCatalog = Pick<
  DraftDocument,
  "catalog" | "appDisplay" | "palette"
>;

/** A palette for a store that already holds every App's full ports. */
export function paletteFromCatalog(catalog: Catalog): Palette {
  return Object.fromEntries(
    Object.entries(catalog).map(([appId, app]) => [
      appId,
      Object.fromEntries(
        Object.entries(app.methods).map(([method, spec]) => [
          method,
          { description: spec.description, digest: spec.digest },
        ]),
      ),
    ]),
  );
}
export type WorkflowVersion = Readonly<{
  version: number;
  commit: string;
  title: string;
  createdAt: string;
}>;

/** Scoped to one authorized Workflow. W4 owns identity, access and persistence. */
export type DraftStore = {
  load(version?: number): Promise<DraftDocument | null>;
  /**
   * Discovery is independent of reading the saved document. `appIds` names
   * which installed Apps' full ports this read actually needs; the index
   * (every installation's display name and method summaries) is always
   * included regardless.
   */
  readCatalog(appIds?: readonly string[]): Promise<DraftCatalog>;
  save(
    draft: Draft,
    expectedRevision: number,
  ): Promise<
    | { readonly status: "saved"; readonly document: DraftDocument }
    | { readonly status: "conflict"; readonly document: DraftDocument }
  >;
  /** Copies an immutable published version into the current draft using its revision. */
  restore?(
    version: number,
    expectedRevision: number,
  ): ReturnType<DraftStore["save"]>;
  /** Resolves with the completed version; known publication failures reject with Agar AppError. */
  publish?(revision: number, signal?: AbortSignal): Promise<number>;
  /** Resumes observation of the accepted publication without submitting a new write. */
  checkPublication?(signal?: AbortSignal): Promise<number>;
  listVersions(): Promise<readonly WorkflowVersion[]>;
};

/** Stops this window's observation only; the durable publication keeps running. */
export class PublicationObservationTimeout extends AppError {
  constructor() {
    super("Publication is still running", { code: "TIMEOUT", retryable: true });
  }
}

/** Only the declared publication status supplies these trusted failure reasons. */
export function publicationFailureCopy(cause: unknown): string | undefined {
  if (cause instanceof PublicationObservationTimeout)
    return "Publishing is still running.";
  if (!(cause instanceof AppError)) return undefined;
  if (publicationElsewhere.safeParse(cause.cause).success)
    return "Couldn't publish: this draft is already publishing in another window.";
  const failure = publicationFailed.safeParse(cause.cause);
  if (!failure.success) return undefined;
  switch (failure.data.reason) {
    case "git_conflict":
      return "Couldn't publish: the repository changed. Try again.";
    case "too_large":
      return "Couldn't publish: this workflow is too large.";
    case "access_changed":
      return "Couldn't publish: your access changed.";
    case "publication_failed":
      return "Couldn't publish: the service couldn't complete this request.";
  }
}

/** Window-local editing only. No durable save and no published versions. */
export function memoryDraftStore(
  draft: Draft,
  catalog: Catalog,
  appDisplay: DraftDocument["appDisplay"] = {},
): DraftStore {
  let document: DraftDocument = structuredClone({
    draft,
    catalog,
    appDisplay,
    palette: paletteFromCatalog(catalog),
    revision: 0,
    durability: "memory",
  });
  return {
    readCatalog() {
      return Promise.resolve({
        catalog: document.catalog,
        appDisplay: document.appDisplay,
        palette: document.palette,
      });
    },
    load(version) {
      return Promise.resolve(
        version === undefined ? structuredClone(document) : null,
      );
    },
    save(next, expectedRevision) {
      if (expectedRevision !== document.revision)
        return Promise.resolve({
          status: "conflict",
          document: structuredClone(document),
        });
      document = structuredClone({
        ...document,
        draft: next,
        revision: document.revision + 1,
      });
      return Promise.resolve({
        status: "saved",
        document: structuredClone(document),
      });
    },
    listVersions() {
      return Promise.resolve([]);
    },
  };
}

export function emptyDraft(): Draft {
  return {
    definition: {
      format: "fungi.workflow/v1",
      title: "Untitled workflow",
      apps: {},
      input: { type: "object", properties: {}, additionalProperties: false },
      nodes: [],
      edges: [],
      output: {},
    },
    layout: {},
  };
}
