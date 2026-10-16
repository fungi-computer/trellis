import * as z from "zod";
import { defineAppMethod } from "@fungi.computer/agar/backend-definition";
import { catalogReplySchema } from "@fungi.computer/workflows-wire";
import { runReply } from "@fungi.computer/workflows-wire";
import { workflowToolListing } from "../shared/tool-contracts.js";
import type { WorkflowIndexes } from "./indexes.js";
import type { WorkflowMethodContext } from "./methods.js";

const output = z.toJSONSchema(runReply, { io: "output" });

// Workflow ids have no underscores or upper-case letters. Preserve dash cases
// that cannot become camel case, so distinct ids cannot alias the same tool.
function toolName(workflowId: string): string {
  const camel = workflowId.replace(
    /-([a-z])|-/g,
    (_, letter: string | undefined) =>
      letter === undefined ? "_" : letter.toUpperCase(),
  );
  return /^[0-9]/.test(camel) ? `Workflow_${camel}` : camel;
}

/** A Workflow's own declared App roles: `{ alias: { appId, role? } }`. */
const appRoleSchema = z.record(
  z.string(),
  z.object({ appId: z.string(), role: z.string().optional() }),
);
type InstalledApp = Readonly<{ installationId: string; appId: string }>;

/**
 * Resolve each declared App role to exactly one installed App: the same
 * unambiguous match the Run dialog's own default picks for a person. A role
 * with zero or more than one installed candidate has no single correct
 * answer without a person choosing, so the caller withholds the whole row
 * rather than guessing a binding.
 */
function resolveBindings(
  apps: z.output<typeof appRoleSchema>,
  installed: readonly InstalledApp[],
): Record<string, string> | null {
  const bindings: Record<string, string> = {};
  for (const [alias, spec] of Object.entries(apps)) {
    const matches = installed.filter((app) => app.appId === spec.appId);
    const [match] = matches;
    if (matches.length !== 1 || match === undefined) return null;
    bindings[alias] = match.installationId;
  }
  return bindings;
}

async function listTools(
  indexes: WorkflowIndexes | undefined,
  workflows: WorkflowMethodContext["env"]["WORKFLOWS"],
): Promise<z.output<typeof workflowToolListing>> {
  const library = indexes?.libraryList();
  if (!indexes || library?.kind !== "ready") return { kind: "unindexed" };
  // Read the Team's installed Apps once for every row, not once per row.
  const catalog = workflows
    ? catalogReplySchema.parse(await workflows.catalog({}))
    : { error: "not_granted" as const };
  const installed: readonly InstalledApp[] =
    "apps" in catalog
      ? catalog.apps.map((app) => ({
          installationId: app.installationId,
          appId: app.appId,
        }))
      : [];
  const tools: unknown[] = [];
  for (const item of [...library.value.items].sort((a, b) =>
    a.workflowId.localeCompare(b.workflowId),
  )) {
    const published = item.published;
    if (published?.version == null) continue;
    // The immutable publication row written at publish; no Git is read here.
    const row = indexes.publications.read(
      `${item.workflowId}:v${String(published.version)}`,
    );
    if (
      row.kind !== "ready" ||
      row.value.workflowId !== item.workflowId ||
      row.value.version !== published.version ||
      row.value.commit !== published.commit
    )
      return { kind: "unindexed" };
    const definition = row.value.definition;
    const apps = appRoleSchema.safeParse(definition.apps);
    if (!apps.success) continue;
    const bindings = resolveBindings(apps.data, installed);
    // No single correct binding today (a role is unmet or ambiguous): never
    // guess one, so withhold this one Workflow's tool, not the whole family.
    if (bindings === null) continue;
    tools.push({
      workflowId: item.workflowId,
      tool: toolName(item.workflowId),
      title: definition.title,
      description: definition.description ?? "",
      version: published.version,
      commit: published.commit,
      input: definition.input,
      output,
      // The exact extra arguments a generic tool-family host merges with the
      // caller's own `input` when it calls `runWorkflow`; see tool-contracts.
      call: {
        workflowId: item.workflowId,
        version: published.version,
        bindings,
      },
    });
  }
  return workflowToolListing.parse({ kind: "ready", tools });
}

export const toolFamilyMethods = {
  listWorkflowTools: defineAppMethod({
    description:
      "List typed tools from saved published Workflow versions; drafts are excluded.",
    hidden: true,
    effect: "read",
    requires: ["workflow.run"],
    input: z.strictObject({}),
    output: workflowToolListing,
    handler: (_input, context: WorkflowMethodContext) =>
      listTools(context.indexes, context.env.WORKFLOWS),
  }),
};
