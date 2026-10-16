import { workflowIdSchema } from "@fungi.computer/braid";
import * as S from "effect/Schema";
import * as Result from "effect/Result";
import type * as z from "zod";
import { gitSha1Schema } from "@fungi.computer/puffball/git-representation";
import { sha256DigestSchema } from "@fungi.computer/puffball/effect";
import {
  workflowDefinitionSchema,
  validate,
  type Catalog,
  type WorkflowDefinition,
  type Issue,
} from "@fungi.computer/braid";
import {
  provenanceSchema,
  shareReview,
  shareCopyReply,
  shareExportReply,
} from "@fungi.computer/workflows-wire";
import type { WorkflowDraft } from "@fungi.computer/workflows-wire";
import type { createWorkflowLibrary } from "./library.js";

const workflowId = S.declare(
  (value): value is string => workflowIdSchema.safeParse(value).success,
);
const commit = S.declare(
  (value): value is string => gitSha1Schema.safeParse(value).success,
);
export const shareBundleSchema = S.Struct({
  format: S.Literal("fungi.workflow-share/v1"),
  definition: workflowDefinitionSchema,
  layout: S.Record(S.String, S.Struct({ x: S.Finite, y: S.Finite })),
  source: S.Struct({
    workflowId,
    version: S.Number.pipe(S.check(S.isInt()), S.check(S.isGreaterThan(0))),
    commit,
    origin: S.optionalKey(S.String.pipe(S.check(S.isMaxLength(256)))),
  }),
});
type Bundle = typeof shareBundleSchema.Type;
type Provenance = z.output<typeof provenanceSchema>;
const maxShareBytes = 512 * 1024;

function review(definition: WorkflowDefinition, catalog: Catalog) {
  const graphs = [
    { id: "root", graph: definition },
    ...Object.entries(definition.subgraphs ?? {}).map(([id, graph]) => ({
      id,
      graph,
    })),
  ];
  return shareReview.parse({
    gitAccess: graphs.flatMap(({ id, graph }) =>
      graph.nodes.flatMap((node) =>
        node.kind === "app" && node.gitAccess
          ? [{ graph: id, node: node.id, ...node.gitAccess }]
          : [],
      ),
    ),
    writeNodes: graphs.flatMap(({ id, graph }) =>
      graph.nodes.flatMap((node) => {
        if (node.kind !== "app") return [];
        const appId = definition.apps[node.app]?.appId;
        const method =
          appId === undefined
            ? undefined
            : catalog[appId]?.methods[node.method];
        return method?.effect === "write" || method?.effect === "external"
          ? [
              {
                graph: id,
                node: node.id,
                appId,
                method: node.method,
                effect: method.effect,
              },
            ]
          : [];
      }),
    ),
    triggers: definition.triggers ?? [],
  });
}

/** A copy is named after its source; an over-long title keeps the source's. */
function copyTitled(definition: WorkflowDefinition): WorkflowDefinition {
  const named = { ...definition, title: `${definition.title} (copy)` };
  return S.is(workflowDefinitionSchema)(named) ? named : definition;
}

async function digest(bytes: Uint8Array) {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
  );
  return S.decodeUnknownSync(sha256DigestSchema)(
    `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
  );
}

/** Copies published content into a new draft; provenance is a claim, never authority. */
export function createWorkflowShare({
  library,
  catalog,
  origin,
}: {
  library: Pick<
    ReturnType<typeof createWorkflowLibrary>,
    "published" | "saveDraft"
  >;
  catalog: (appIds: readonly string[]) => Promise<Catalog>;
  origin?: string;
}) {
  async function save(
    workflowId: string,
    draft: Pick<WorkflowDraft, "definition" | "layout">,
    provenance: Provenance,
  ) {
    const wanted = [
      ...new Set(Object.values(draft.definition.apps).map((app) => app.appId)),
    ];
    const available = await catalog(wanted);
    const appIds = wanted.filter((appId) => !Object.hasOwn(available, appId));
    if (appIds.length)
      return shareCopyReply.parse({ kind: "missing_apps", appIds });
    const issues: readonly Issue[] = validate(draft.definition, available);
    if (issues.length) return shareCopyReply.parse({ kind: "invalid", issues });
    const result = await library.saveDraft(
      workflowId,
      { definition: draft.definition, layout: draft.layout, provenance },
      0,
    );
    return shareCopyReply.parse(
      result.kind === "saved"
        ? {
            ...result,
            title: draft.definition.title,
            review: review(draft.definition, available),
          }
        : result,
    );
  }
  return {
    async exportWorkflow(input: {
      workflowId: string;
      version: number;
    }): Promise<z.output<typeof shareExportReply>> {
      const document = await library.published(input.workflowId, {
        version: input.version,
      });
      if (!document) return { kind: "not_found" as const };
      let source: Bundle["source"] = { ...input, commit: document.commit };
      if (origin !== undefined) source = { ...source, origin };
      const bundle: Bundle = S.decodeUnknownSync(shareBundleSchema)(
        {
          format: "fungi.workflow-share/v1",
          definition: document.definition,
          layout: document.layout,
          source,
        },
        { onExcessProperty: "error" },
      );
      const bytes = JSON.stringify(bundle);
      const encoded = new TextEncoder().encode(bytes);
      if (encoded.byteLength > maxShareBytes)
        return { kind: "too_large" as const };
      return { bytes, sha256: await digest(encoded) };
    },
    async importWorkflow(input: {
      bytes: string;
      sha256: string;
      workflowId: string;
    }) {
      const bytes = new TextEncoder().encode(input.bytes);
      if (bytes.byteLength > maxShareBytes)
        return { kind: "too_large" as const };
      if (
        !S.is(sha256DigestSchema)(input.sha256) ||
        (await digest(bytes)) !== input.sha256
      )
        return { kind: "digest_mismatch" as const };
      const parsed = S.decodeUnknownResult(S.fromJsonString(shareBundleSchema))(
        input.bytes,
        { onExcessProperty: "error" },
      );
      if (Result.isFailure(parsed)) return { kind: "invalid_bundle" as const };
      const bundle = parsed.success;
      return save(
        input.workflowId,
        { definition: copyTitled(bundle.definition), layout: bundle.layout },
        provenanceSchema.parse({
          kind: "import",
          ...bundle.source,
          sha256: input.sha256,
        }),
      );
    },
    async forkPublishedWorkflow(input: {
      sourceWorkflowId: string;
      at: { version: number } | { commit: string };
      workflowId: string;
    }) {
      const document = await library.published(
        input.sourceWorkflowId,
        input.at,
      );
      if (!document) return { kind: "not_found" as const };
      return save(
        input.workflowId,
        {
          definition: copyTitled(document.definition),
          layout: document.layout,
        },
        provenanceSchema.parse({
          kind: "fork",
          workflowId: input.sourceWorkflowId,
          commit: document.commit,
        }),
      );
    },
  };
}
