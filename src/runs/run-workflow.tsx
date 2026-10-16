import { useEffect, useRef, useState } from "react";
import { workflowRunRequestIds } from "@fungi.computer/workflows-wire";
import * as z from "zod";
import { field, SchemaForm } from "@fungi.computer/caps/form";
import {
  workflowDefinitionSchema,
  parseProjection,
  type PortSchema,
  type WorkflowDefinition,
} from "@fungi.computer/braid";
import * as S from "effect/Schema";
import { workflowInputField } from "./input-form.js";
import type { WorkflowClient } from "../workflow-client.js";
export function RunWorkflow({
  client,
  workflowId,
  version,
  onRun,
}: {
  client: WorkflowClient;
  workflowId: string;
  version: number | undefined;
  onRun: (id: string) => void;
}) {
  const request = useRef<{ key: string; id: string } | null>(null);
  const [ready, setReady] = useState<{
    definition: WorkflowDefinition;
    input: PortSchema;
    apps: Awaited<ReturnType<WorkflowClient["catalog"]>>["apps"];
    chats: Awaited<ReturnType<WorkflowClient["chatChoices"]>>;
  } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true;
    setReady(null);
    setError(null);
    if (version === undefined) return;
    void Promise.all([
      client.listVersions(workflowId),
      client.catalog(),
      client.chatChoices(),
    ])
      .then(async ([versions, { apps }, chats]) => {
        const chosen = versions.find((item) => item.version === version);
        if (!chosen) throw new Error("Version missing");
        const doc = await client.loadWorkflow(workflowId, {
          commit: chosen.commit,
        });
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
  }, [client, workflowId, version]);
  if (version === undefined)
    return <p>Publish a version before running this workflow.</p>;
  if (error) return <p role="alert">{error.message}</p>;
  if (!ready) return <p>Loading published workflow…</p>;
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
    ["input", inputField.defaultValue] as const,
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
    <>
      {ready.chats.kind === "unavailable" ? (
        <p>Chats could not be loaded, so this run cannot report to a chat.</p>
      ) : null}
      <SchemaForm
        schema={schema}
        defaultValues={defaults}
        allowClean
        submitLabel={`Run v${String(version)}`}
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
            });
            if (request.current?.key !== key)
              request.current = {
                key,
                id: workflowRunRequestIds.request.generate(),
              };
            const run = {
              requestId: request.current.id,
              workflowId,
              version,
              bindings: selectedBindings,
              input: values.input,
            };
            const result = await client.runWorkflow(
              chat === undefined
                ? run
                : {
                    ...run,
                    delivery: {
                      agentId: chat.agentId,
                      sessionId: chat.sessionId,
                    },
                  },
            );
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
    </>
  );
}

/** One select value per chat; Session ids are opaque, so both parts are kept. */
export const chatKey = (chat: { agentId: string; sessionId: string }) =>
  JSON.stringify([chat.agentId, chat.sessionId]);
