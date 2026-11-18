import { useEffect, useRef, useState } from "react";
import { workflowRunRequestIds } from "@fungi.computer/workflows-wire";
import * as z from "zod";
import { field, SchemaForm } from "@fungi.computer/caps/form";
import { LoadingState } from "@fungi.computer/caps/blocks/loading-state";
import { FailureLine } from "@fungi.computer/caps/components/failure-line";
import {
  workflowDefinitionSchema,
  parseProjection,
  type PortSchema,
  type WorkflowDefinition,
} from "@fungi.computer/braid";
import * as S from "effect/Schema";
import { workflowInputField } from "./input-form.js";
import { humanTitle } from "../editor/human-title.js";
import type { WorkflowClient } from "../workflow-client.js";
import type { RunStatus } from "./run-state.js";
export function RunWorkflow({
  client,
  workflowId,
  version,
  testRevision,
  input: prefilled,
  autoRun = false,
  onRun,
}: {
  client: WorkflowClient;
  workflowId: string;
  version: number | undefined;
  /** Run the saved draft at this revision as a test, instead of a published version. */
  testRevision?: number | undefined;
  /** Start the form from these values (a run's own input) instead of the defaults. */
  input?: RunStatus["input"];
  /** Run a newly published version when its defaults need no further choices. */
  autoRun?: boolean;
  onRun: (id: string) => void;
}) {
  const request = useRef<{ key: string; id: string } | null>(null);
  const form = useRef<HTMLDivElement>(null);
  const autoSubmitted = useRef(false);
  // A test that writes or posts asks once; the next submit is the confirmation.
  const allowWrites = useRef(false);
  const [ready, setReady] = useState<{
    definition: WorkflowDefinition;
    input: PortSchema;
    apps: Awaited<ReturnType<WorkflowClient["catalog"]>>["apps"];
    chats: Awaited<ReturnType<WorkflowClient["chatChoices"]>>;
  } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!autoRun || !ready || autoSubmitted.current) return;
    const input = workflowInputField(ready.input);
    // Required input or an ambiguous App choice stays in the existing run form.
    if (!input.schema.safeParse(input.defaultValue).success) return;
    if (
      Object.values(ready.definition.apps).some(
        (binding) =>
          ready.apps.filter((app) => app.appId === binding.appId).length !== 1,
      )
    )
      return;
    const element = form.current?.querySelector("form");
    if (!element) return;
    autoSubmitted.current = true;
    element.requestSubmit();
  }, [autoRun, ready]);
  useEffect(() => {
    let active = true;
    setReady(null);
    setError(null);
    if (version === undefined && testRevision === undefined) return;
    void Promise.all([
      testRevision === undefined
        ? client.listVersions(workflowId)
        : Promise.resolve([]),
      client.catalog(),
      client.chatChoices(),
    ])
      .then(async ([versions, { apps }, chats]) => {
        const chosen = versions.find((item) => item.version === version);
        if (testRevision === undefined && !chosen)
          throw new Error("Version missing");
        const doc = await client.loadWorkflow(
          workflowId,
          chosen ? { commit: chosen.commit } : "draft",
        );
        if (!doc) throw new Error("Version missing");
        const definition = S.decodeUnknownSync(workflowDefinitionSchema)(
          doc.definition,
        );
        const input = parseProjection(definition.input);
        if (active) setReady({ definition, input, apps, chats });
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            new Error("The published workflow could not be loaded.", { cause }),
          );
      });
    return () => {
      active = false;
    };
  }, [client, workflowId, version, testRevision, attempt]);
  // What this form starts: a test of the saved draft, or a published version.
  const target =
    testRevision !== undefined
      ? ({ kind: "test", revision: testRevision } as const)
      : version !== undefined
        ? ({ kind: "version", version } as const)
        : undefined;
  if (target === undefined)
    return <p>Publish a version before running this workflow.</p>;
  if (error)
    return (
      <FailureLine
        message={error.message}
        onRetry={() => {
          setAttempt((value) => value + 1);
        }}
      />
    );
  if (!ready) return <LoadingState message="Loading published workflow…" />;
  const bindings = Object.entries(ready.definition.apps);
  const bindingFields: Record<string, z.ZodString> = {};
  for (const [alias, spec] of bindings) {
    const apps = ready.apps.filter((app) => app.appId === spec.appId);
    bindingFields[`binding_${alias}`] = z
      .string()
      .min(1)
      .meta(
        field({
          label: apps.at(0)?.displayName ?? spec.appId,
          kind: "select",
          options: Object.fromEntries(
            apps.map((app) => [app.installationId, app.displayName]),
          ),
        }),
      );
  }
  const chats = new Map(
    (ready.chats.kind === "ready" ? ready.chats.chats : []).map(
      (chat) => [chatKey(chat), chat] as const,
    ),
  );
  if (chats.size > 0)
    bindingFields.reportTo = z.string().meta(
      field({
        label: "Report to chat",
        help: "Post this run's result to a chat when it ends.",
        kind: "select",
        options: {
          "": "Don't report",
          ...Object.fromEntries(
            [...chats].map(([key, chat]) => [
              key,
              chat.title || "Untitled chat",
            ]),
          ),
        },
      }),
    );
  const inputField = workflowInputField(ready.input);
  const schema = z.object({ input: inputField.schema, ...bindingFields });
  const defaults = Object.fromEntries([
    [
      "input",
      prefilled === undefined
        ? inputField.defaultValue
        : JSON.stringify(prefilled),
    ] as const,
    ["reportTo", ""] as const,
    ...bindings.map(([alias, spec]) => {
      const matches = ready.apps.filter((app) => app.appId === spec.appId);
      return [
        `binding_${alias}`,
        matches.length === 1 ? matches[0].installationId : "",
      ] as const;
    }),
  ]);
  return (
    <div ref={form} className="grid gap-sm">
      {ready.chats.kind === "unavailable" ? (
        <p>Chats could not be loaded, so this run cannot report to a chat.</p>
      ) : null}
      <SchemaForm
        schema={schema}
        defaultValues={defaults}
        allowClean
        submitLabel={
          target.kind === "test"
            ? "Run a test"
            : `Run v${String(target.version)}`
        }
        aria-label="Run workflow"
        onSubmit={async (values, raw) => {
          const selectedBindings = Object.fromEntries(
            bindings.map(([alias]) => [alias, raw[`binding_${alias}`]]),
          );
          const chat = chats.get(raw.reportTo);
          try {
            const key = JSON.stringify({
              workflowId,
              version,
              values,
              selectedBindings,
              reportTo: raw.reportTo,
              allowWrites: allowWrites.current,
            });
            if (request.current?.key !== key)
              request.current = {
                key,
                id: workflowRunRequestIds.request.generate(),
              };
            const base = {
              requestId: request.current.id,
              workflowId,
              bindings: selectedBindings,
              input: values.input,
            };
            const delivery =
              chat === undefined
                ? {}
                : {
                    delivery: {
                      agentId: chat.agentId,
                      sessionId: chat.sessionId,
                    },
                  };
            const result =
              target.kind === "version"
                ? await client.runWorkflow({
                    ...base,
                    ...delivery,
                    version: target.version,
                  })
                : await client.testDraft({
                    ...base,
                    ...delivery,
                    expectedRevision: target.revision,
                    allowWrites: allowWrites.current,
                  });
            if ("kind" in result && result.kind === "draft_conflict")
              return {
                kind: "refused",
                error:
                  "The draft changed after this run. Open the editor, then test it again.",
              };
            if (
              "kind" in result &&
              result.kind === "writes_need_confirmation"
            ) {
              allowWrites.current = true;
              return {
                kind: "refused",
                error: `This test really runs: ${result.steps.map((step) => `${step.appId} · ${humanTitle(step.method)}`).join(", ")}. Run it again to confirm.`,
              };
            }
            if (
              "kind" in result &&
              (result.kind === "started" || result.kind === "replay")
            ) {
              onRun(result.runId);
              return;
            }
            return {
              kind: "refused",
              error:
                "error" in result
                  ? result.error
                  : result.kind === "invalid"
                    ? result.issues.map((issue) => issue.message).join("; ")
                    : "Run identity conflict.",
            };
          } catch {
            return {
              kind: "refused",
              error: "Could not start the workflow. Try again.",
            };
          }
        }}
      />
    </div>
  );
}

/** One select value per chat; Session ids are opaque, so both parts are kept. */
export const chatKey = (chat: { agentId: string; sessionId: string }) =>
  JSON.stringify([chat.agentId, chat.sessionId]);
