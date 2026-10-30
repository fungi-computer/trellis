import { eventLabel } from "./event-label.js";
import { scheduleSummary } from "./schedule.js";
import { useEffect, useRef, useState } from "react";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { Button } from "@fungi.computer/caps/components/button";
import { Surface } from "@fungi.computer/caps/components/surface";
import { Field, FieldSet } from "@fungi.computer/caps/components/field";
import { Select } from "@fungi.computer/caps/components/select";
import { Switch } from "@fungi.computer/caps/components/switch";
import { Status } from "@fungi.computer/caps/components/status";
import type { WorkflowClient } from "../workflow-client.js";
import type {
  RunDelivery,
  WorkflowTriggerTarget,
} from "@fungi.computer/workflows-wire";
import { chatKey } from "../runs/run-workflow.js";
import type { WorkflowDefinition } from "@fungi.computer/braid";

/** Presentation port for the selected Workflow's currently declared triggers. */
export type TriggerControl = {
  list(): Promise<
    readonly {
      triggerId: string;
      state: "active" | "paused" | "cancelled" | "finished";
      lastError: string | null;
    }[]
  >;
  arm(
    triggerId: string,
    bindings: WorkflowTriggerTarget["bindings"],
    delivery?: RunDelivery,
  ): Promise<{ kind: "armed" } | { kind: "refused"; reason: string }>;
  disarm(
    triggerId: string,
  ): Promise<
    { kind: "disarmed" | "not_found" } | { kind: "refused"; reason: string }
  >;
};

/** List by Workflow and declaration; the selected commit is used only when arming. */
export function createTriggerControl(
  client: WorkflowClient,
  definition: WorkflowDefinition,
  publication: Omit<WorkflowTriggerTarget, "triggerId" | "bindings">,
): TriggerControl {
  let controls = new Map<string, { on: "schedule" | "event"; id: string }>();
  const declared = new Map(
    (definition.triggers ?? []).map((trigger) => [trigger.id, trigger.on]),
  );
  return {
    async list() {
      // A failed refresh must not leave previously read control IDs usable.
      controls.clear();
      const [schedules, events] = await Promise.all([
        // One native maximum-sized page is a work budget, not a retention cap.
        client.listTriggers({ limit: 100 }),
        client.eventTriggers(),
      ]);
      if ("error" in schedules) throw new Error(schedules.error);
      if ("error" in events) throw new Error(events.error);
      if (schedules.nextCursor !== null)
        throw new Error(
          "Schedule state is incomplete. This view cannot load another page; controls are unavailable.",
        );
      const next = new Map<string, { on: "schedule" | "event"; id: string }>();
      const rows: Awaited<ReturnType<TriggerControl["list"]>>[number][] = [];
      for (const row of schedules.schedules) {
        if (
          row.workflowId !== publication.workflowId ||
          declared.get(row.triggerId) !== "schedule"
        )
          continue;
        if (next.has(row.triggerId))
          throw new Error(
            `Multiple registrations match trigger "${row.triggerId}"; controls are unavailable.`,
          );
        next.set(row.triggerId, { on: "schedule", id: row.scheduleId });
        rows.push({
          triggerId: row.triggerId,
          state: row.state,
          lastError: row.lastError,
        });
      }
      for (const row of events.eventTriggers) {
        if (
          row.workflowId !== publication.workflowId ||
          declared.get(row.triggerId) !== "event"
        )
          continue;
        if (next.has(row.triggerId))
          throw new Error(
            `Multiple registrations match trigger "${row.triggerId}"; controls are unavailable.`,
          );
        next.set(row.triggerId, { on: "event", id: row.eventTriggerId });
        rows.push({
          triggerId: row.triggerId,
          state: row.state,
          lastError: row.lastError,
        });
      }
      controls = next;
      return rows;
    },
    async arm(triggerId, bindings, delivery) {
      const on = declared.get(triggerId);
      if (on !== "schedule" && on !== "event")
        throw new Error("Choose a published schedule or App event.");
      const base = { ...publication, triggerId, bindings };
      const target = delivery === undefined ? base : { ...base, delivery };
      const reply =
        on === "schedule"
          ? await client.arm(target)
          : await client.armEventTrigger(target);
      if ("error" in reply) throw new Error(reply.error);
      return reply.kind === "refused"
        ? { kind: "refused", reason: reply.reason }
        : { kind: "armed" };
    },
    async disarm(triggerId) {
      const control = controls.get(triggerId);
      if (!control)
        throw new Error(
          "Trigger state changed. Retry to read its current state.",
        );
      const reply =
        control.on === "schedule"
          ? await client.disarm(control.id)
          : await client.disarmEventTrigger(control.id);
      if ("error" in reply) throw new Error(reply.error);
      return reply;
    },
  };
}

export function Triggers({
  client,
  workflowId,
  control,
}: {
  client: WorkflowClient;
  workflowId: string | null;
  control?: TriggerControl;
}) {
  const [loadedControl, setLoadedControl] = useState<TriggerControl | null>(
    null,
  );
  const triggerControl = control ?? loadedControl;
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [unpublished, setUnpublished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<
    Awaited<ReturnType<TriggerControl["list"]>>
  >([]);
  const [apps, setApps] = useState<
    Awaited<ReturnType<WorkflowClient["catalog"]>>["apps"]
  >([]);
  const [appBindings, setAppBindings] = useState<Record<string, string>>({});
  const [chats, setChats] = useState<
    Awaited<ReturnType<WorkflowClient["listChats"]>>
  >([]);
  const [chatsUnavailable, setChatsUnavailable] = useState(false);
  const [reportTo, setReportTo] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const generation = useRef(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    generation.current++;
    setDefinition(null);
    setLoadedControl(null);
    setError(null);
    setUnpublished(false);
    setArmed([]);
    setPending(null);
    setApps([]);
    setAppBindings({});
    setChats([]);
    setChatsUnavailable(false);
    setReportTo("");
    if (workflowId)
      void client
        .listVersions(workflowId)
        .then(async (versions) => {
          const latest = [...versions]
            .sort((a, b) => b.version - a.version)
            .at(0);
          if (!latest) {
            if (active) setUnpublished(true);
            return;
          }
          const doc = await client.loadWorkflow(workflowId, {
            commit: latest.commit,
          });
          if (!doc) throw new Error("Published workflow missing");
          const nextControl =
            control ??
            createTriggerControl(client, doc.definition, {
              workflowId,
              commit: latest.commit,
            });
          const [catalog, rows, available] = await Promise.all([
            Object.keys(doc.definition.apps).length
              ? client.catalog()
              : Promise.resolve({ apps: [] }),
            doc.definition.triggers?.length
              ? nextControl.list()
              : Promise.resolve([]),
            client.chatChoices(),
          ]);
          const defaults = Object.fromEntries(
            Object.entries(doc.definition.apps).map(([alias, spec]) => {
              const matches = catalog.apps.filter(
                (app) => app.appId === spec.appId,
              );
              return [
                alias,
                matches.length === 1 ? matches[0].installationId : "",
              ];
            }),
          );
          if (active) {
            setDefinition(doc.definition);
            setLoadedControl(nextControl);
            setArmed(rows);
            setApps(catalog.apps);
            setAppBindings(defaults);
            setChats(available.kind === "ready" ? available.chats : []);
            setChatsUnavailable(available.kind === "unavailable");
          }
        })
        .catch((cause: unknown) => {
          if (active)
            setError(
              cause instanceof Error
                ? cause.message
                : "Triggers could not be loaded.",
            );
        });
    return () => {
      active = false;
      generation.current++;
    };
  }, [client, workflowId, control, attempt]);
  /** Arm with the chosen chat, or with none when "Don't report" is chosen. */
  function armWith(id: string) {
    if (!triggerControl) throw new Error("Triggers are not loaded");
    const chat = chats.find((item) => chatKey(item) === reportTo);
    return chat === undefined
      ? triggerControl.arm(id, appBindings)
      : triggerControl.arm(id, appBindings, {
          agentId: chat.agentId,
          sessionId: chat.sessionId,
        });
  }
  async function toggle(id: string, isArmed: boolean) {
    if (!triggerControl || pending) return;
    const current = generation.current;
    setPending(id);
    setError(null);
    try {
      const result = isArmed
        ? await triggerControl.disarm(id)
        : await armWith(id);
      if (current !== generation.current) return;
      if (result.kind === "refused") {
        setError(result.reason);
        return;
      }
      const rows = await triggerControl.list();
      if (current === generation.current) setArmed(rows);
    } catch {
      if (current === generation.current)
        setError(
          "Trigger could not be updated. Retry to read its current state.",
        );
    } finally {
      if (current === generation.current) setPending(null);
    }
  }
  const bindingsByAlias = new Map(Object.entries(appBindings));
  const missingBinding = definition
    ? Object.keys(definition.apps).some((alias) => !bindingsByAlias.get(alias))
    : false;
  return (
    <main className="wf-page">
      {error ? (
        <p role="alert">
          {error}{" "}
          <Button
            variant="ghost"
            onClick={() => {
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </p>
      ) : null}
      {!workflowId ? (
        <p>Choose a workflow to see its triggers.</p>
      ) : unpublished ? (
        <p>
          Publish a version to arm its triggers. Manual runs become available
          after publishing.
        </p>
      ) : !definition ? (
        !error && <p>Loading published triggers…</p>
      ) : (
        <>
          {Object.keys(definition.apps).length ? (
            <FieldSet
              legend="Apps for arming"
              description="Choose the installations this published workflow will use."
            >
              {Object.entries(definition.apps).map(([alias, spec]) => {
                const matches = apps.filter((app) => app.appId === spec.appId);
                const name = matches.at(0)?.displayName ?? spec.appId;
                const label =
                  Object.values(definition.apps).filter(
                    (app) => app.appId === spec.appId,
                  ).length > 1
                    ? `${name} (${alias})`
                    : name;
                return (
                  <Field
                    key={alias}
                    label={label}
                    description={
                      matches.length
                        ? undefined
                        : "No available installation of this App."
                    }
                  >
                    <Select
                      required
                      value={bindingsByAlias.get(alias) ?? ""}
                      disabled={pending !== null}
                      onChange={(event) => {
                        const installationId = event.currentTarget.value;
                        setAppBindings((current) => ({
                          ...current,
                          [alias]: installationId,
                        }));
                      }}
                    >
                      <option value="" disabled>
                        Choose an installation
                      </option>
                      {matches.map((app) => (
                        <option
                          key={app.installationId}
                          value={app.installationId}
                        >
                          {matches.length > 1
                            ? `${app.displayName} · ${app.installationId}`
                            : app.displayName}
                        </option>
                      ))}
                    </Select>
                  </Field>
                );
              })}
            </FieldSet>
          ) : null}
          {chatsUnavailable ? (
            <p>
              Chats could not be loaded, so triggers armed now will not report
              to a chat.
            </p>
          ) : null}
          {chats.length ? (
            <Field
              label="Report to chat"
              description="Post each triggered run's result to a chat when it ends. Applies when you arm."
            >
              <Select
                value={reportTo}
                disabled={pending !== null}
                onChange={(event) => {
                  setReportTo(event.currentTarget.value);
                }}
              >
                <option value="">Don't report</option>
                {chats.map((chat) => (
                  <option key={chatKey(chat)} value={chatKey(chat)}>
                    {chat.title || "Untitled chat"}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Surface placement="embedded" size="sm">
            <DataList className="@container">
              <DataRow className="flex flex-wrap items-start">
                <div className="min-w-0 flex-1 basis-full @sm:basis-48">
                  <strong>Manual</strong>
                  <p>Run the published workflow with its inputs.</p>
                </div>
                <Status label="Always available" tone="neutral" />
              </DataRow>
              {(definition.triggers ?? []).map((trigger) => {
                const row = armed.find((item) => item.triggerId === trigger.id);
                const isArmed = row?.state === "active";
                const needsRearm =
                  row?.state === "paused" || Boolean(row?.lastError);
                const disabled =
                  !triggerControl ||
                  missingBinding ||
                  error !== null ||
                  pending !== null ||
                  trigger.on === "webhook";
                return (
                  <DataRow
                    key={trigger.id}
                    data-trigger-id={trigger.id}
                    className="flex flex-wrap items-start"
                  >
                    <div className="min-w-0 flex-1 basis-full @sm:basis-48">
                      <strong>{trigger.title ?? trigger.id}</strong>
                      <p>
                        {trigger.on === "schedule"
                          ? `Schedule · ${scheduleSummary(trigger.cron)}`
                          : trigger.on === "event"
                            ? `App event · ${apps.find((app) => app.appId === new Map(Object.entries(definition.apps)).get(trigger.app)?.appId)?.displayName ?? trigger.app} · ${eventLabel(trigger.event)}`
                            : "Webhook · unavailable"}
                      </p>
                      <Status
                        label={
                          row?.state === "paused"
                            ? "Paused"
                            : isArmed
                              ? "Armed"
                              : "Not armed"
                        }
                        tone={
                          row?.state === "paused"
                            ? "error"
                            : isArmed
                              ? "success"
                              : "neutral"
                        }
                      />
                      {row?.lastError ? (
                        <p role="alert">{row.lastError}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-xs">
                      {needsRearm ? (
                        <Button
                          variant="outline"
                          disabled={disabled}
                          loading={pending === trigger.id}
                          onClick={() => {
                            void toggle(trigger.id, false);
                          }}
                        >
                          Re-arm
                        </Button>
                      ) : null}
                      {row?.state === "paused" ? (
                        <Button
                          variant="outline"
                          disabled={disabled}
                          onClick={() => {
                            void toggle(trigger.id, true);
                          }}
                        >
                          Disarm
                        </Button>
                      ) : null}
                      <label className="flex items-center gap-xs">
                        <Switch
                          aria-label={`Arm ${trigger.title ?? trigger.id}`}
                          aria-busy={pending === trigger.id}
                          checked={isArmed}
                          disabled={disabled}
                          onCheckedChange={(checked) => {
                            void toggle(trigger.id, !checked);
                          }}
                        />
                        {row?.state === "paused"
                          ? "Paused"
                          : isArmed
                            ? "On"
                            : "Off"}
                      </label>
                    </div>
                  </DataRow>
                );
              })}
            </DataList>
          </Surface>
        </>
      )}
    </main>
  );
}
