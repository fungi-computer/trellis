import { eventLabel } from "./event-label.js";
import { nextRuns, runWords, scheduleSummary } from "./schedule.js";
import {
  failureWords,
  switchLabel,
  switchOff,
  switchOn,
  switchState,
  switchStatus,
  triggerName,
  type SwitchFailure,
  type Trigger,
} from "./workflow-switch.js";
import { TriggerSettings } from "./trigger-settings.js";
import { useEffect, useRef, useState } from "react";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { Surface } from "@fungi.computer/caps/components/surface";
import { Field, FieldSet } from "@fungi.computer/caps/components/field";
import { Select } from "@fungi.computer/caps/components/select";
import { Switch } from "@fungi.computer/caps/components/switch";
import { Status } from "@fungi.computer/caps/components/status";
import { LoadingState } from "@fungi.computer/caps/blocks/loading-state";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { FailureLine } from "@fungi.computer/caps/components/failure-line";
import type { WorkflowClient } from "../workflow-client.js";
import type {
  RunDelivery,
  WorkflowTriggerTarget,
} from "@fungi.computer/workflows-wire";
import { chatKey } from "../runs/run-workflow.js";
import type { WorkflowDefinition } from "@fungi.computer/braid";
import { useChrome } from "../chrome.js";
import type { DraftStore } from "../editor/draft-store.js";

/** Presentation port for the selected Workflow's currently declared triggers. */
export type TriggerRow = {
  triggerId: string;
  state: "active" | "paused" | "cancelled" | "finished";
  lastError: string | null;
};

export type TriggerControl = {
  list(): Promise<readonly TriggerRow[]>;
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

/** The one On switch for a workflow, what starts it, and the draft's triggers to change. */
export function Triggers({
  client,
  workflowId,
  control,
  store,
  onOpenCanvas,
  onChanged,
}: {
  client: WorkflowClient;
  workflowId: string | null;
  control?: TriggerControl;
  /** The workflow's draft store: with it, triggers can be added and changed here. */
  store?: DraftStore | null;
  onOpenCanvas?: () => void;
  /** The draft or its published versions changed from this tab. */
  onChanged?: () => void;
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
  const [failures, setFailures] = useState<readonly SwitchFailure[]>([]);
  const [failedVerb, setFailedVerb] = useState<"on" | "off">("on");
  const [apps, setApps] = useState<
    Awaited<ReturnType<WorkflowClient["catalog"]>>["apps"]
  >([]);
  const [appBindings, setAppBindings] = useState<Record<string, string>>({});
  const [chats, setChats] = useState<
    Awaited<ReturnType<WorkflowClient["listChats"]>>
  >([]);
  const [chatsUnavailable, setChatsUnavailable] = useState(false);
  const [reportTo, setReportTo] = useState("");
  const [pending, setPending] = useState(false);
  const [ahead, setAhead] = useState(false);
  const [now, setNow] = useState(Date.now);
  const generation = useRef(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    generation.current++;
    setDefinition(null);
    setLoadedControl(null);
    setError(null);
    setFailures([]);
    setUnpublished(false);
    setArmed([]);
    setPending(false);
    setApps([]);
    setAppBindings({});
    setChats([]);
    setChatsUnavailable(false);
    setReportTo("");
    setNow(Date.now());
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
  const triggers = definition?.triggers ?? [];
  const state = switchState(triggers, armed);
  const status = definition ? switchStatus(triggers, armed, now) : undefined;
  useChrome(
    "triggers",
    status === undefined
      ? null
      : {
          status: [
            {
              id: "switch",
              label: status,
              tone: state.kind === "on" ? "success" : "neutral",
            },
          ],
        },
  );
  /** Turn every trigger on or off, then read the real state back. */
  async function setOn(on: boolean) {
    if (!triggerControl || !definition || pending) return;
    const current = generation.current;
    const chat = chats.find((item) => chatKey(item) === reportTo);
    const delivery =
      chat === undefined
        ? undefined
        : { agentId: chat.agentId, sessionId: chat.sessionId };
    setPending(true);
    setError(null);
    setFailures([]);
    try {
      const missed = on
        ? await switchOn(triggerControl, triggers, armed, appBindings, delivery)
        : await switchOff(triggerControl, triggers, armed);
      const rows = await triggerControl.list();
      if (current !== generation.current) return;
      setArmed(rows);
      setFailures(missed);
      setFailedVerb(on ? "on" : "off");
      setNow(Date.now());
    } catch {
      if (current === generation.current)
        setError(
          "Trigger could not be updated. Retry to read its current state.",
        );
    } finally {
      if (current === generation.current) setPending(false);
    }
  }
  const bindingsByAlias = new Map(Object.entries(appBindings));
  const missingBinding = definition
    ? Object.keys(definition.apps).some((alias) => !bindingsByAlias.get(alias))
    : false;
  const appName = (trigger: Trigger & { on: "event" }) =>
    apps.find(
      (app) =>
        app.appId ===
        new Map(Object.entries(definition?.apps ?? {})).get(trigger.app)?.appId,
    )?.displayName ?? trigger.app;
  // Only schedules that are on will fire; with none on, show what would run.
  const onIds = new Set(
    armed.filter((row) => row.state === "active").map((row) => row.triggerId),
  );
  const anyOn = triggers.some(
    (trigger) => trigger.on === "schedule" && onIds.has(trigger.id),
  );
  const upcoming = triggers
    .flatMap((trigger) =>
      trigger.on === "schedule" && (!anyOn || onIds.has(trigger.id))
        ? nextRuns(trigger.cron, 3, now).map((at) => ({ at, trigger }))
        : [],
    )
    .sort((a, b) => a.at - b.at)
    .slice(0, 3);
  const settings = store ? (
    <TriggerSettings
      store={store}
      published={definition ? triggers : null}
      onAhead={setAhead}
      onChanged={() => {
        onChanged?.();
      }}
      onPublished={() => {
        onChanged?.();
        setAttempt((value) => value + 1);
      }}
    />
  ) : null;
  const switchDisabled =
    !triggerControl ||
    missingBinding ||
    error !== null ||
    pending ||
    ahead ||
    state.kind === "unavailable";
  return (
    <main className="wf-page flex flex-col gap-md">
      {error ? (
        <FailureLine
          message={error}
          onRetry={() => {
            setAttempt((value) => value + 1);
          }}
        />
      ) : null}
      {!workflowId ? (
        <p>Choose a workflow to see its triggers.</p>
      ) : unpublished ? (
        <>
          <EmptyState
            title="Not published yet"
            description="Publish this workflow, then switch it on here to run on a schedule or when an App event happens."
            primaryAction={
              onOpenCanvas
                ? { label: "Open canvas", onSelect: onOpenCanvas }
                : undefined
            }
          />
          {settings}
        </>
      ) : !definition ? (
        !error && <LoadingState message="Loading published triggers…" />
      ) : (
        <>
          <Surface
            placement="embedded"
            size="sm"
            className="p-md"
            data-workflow-switch
          >
            <div className="flex items-start gap-md">
              <span className="wf-switch" data-mixed={state.kind === "partly"}>
                <Switch
                  aria-label="Workflow on"
                  aria-busy={pending}
                  aria-checked={state.kind === "partly" ? "mixed" : undefined}
                  checked={state.kind === "on" || state.kind === "partly"}
                  disabled={switchDisabled}
                  onCheckedChange={(checked) => {
                    // A partly-on workflow retries what is off, never turns the rest off.
                    void setOn(state.kind === "partly" ? true : checked);
                  }}
                />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2xs">
                <h2 className="flex flex-wrap items-center gap-xs">
                  <span>{switchLabel(state)}</span>
                  {state.kind === "partly" ? (
                    <Status label="Some triggers off" tone="warning" />
                  ) : null}
                </h2>
                <p className="text-sm text-(--stipe-fg-muted)">
                  {state.kind === "on"
                    ? "Every trigger below starts this workflow by itself."
                    : state.kind === "partly"
                      ? `${state.notOn.join(", ")} ${state.notOn.length === 1 ? "is" : "are"} not on yet. Switch it on again to retry.`
                      : state.kind === "unavailable"
                        ? "Add a schedule or an App event below to switch this workflow on."
                        : "Nothing starts this workflow by itself. You can still run it by hand."}
                </p>
                {ahead ? (
                  <p role="status" className="text-sm text-(--stipe-fg-muted)">
                    Publish your trigger changes first; the switch uses the
                    published version.
                  </p>
                ) : null}
                {failures.length ? (
                  <p role="alert" className="text-sm">
                    {failureWords(failures, failedVerb)}
                  </p>
                ) : null}
              </div>
            </div>
          </Surface>
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
                      disabled={pending}
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
              Chats could not be loaded, so triggers switched on now will not
              report to a chat.
            </p>
          ) : null}
          {chats.length ? (
            <Field
              label="Report to chat"
              description="Post each triggered run's result to a chat when it ends. Applies when you switch it on."
            >
              <Select
                value={reportTo}
                disabled={pending}
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
          <FieldSet legend="Starts when">
            <Surface placement="embedded" size="sm">
              <DataList className="@container">
                <DataRow className="flex flex-wrap items-start">
                  <div className="min-w-0 flex-1 basis-full @sm:basis-48">
                    <strong>Manual</strong>
                    <p>Run the published workflow with its inputs.</p>
                  </div>
                  <Status label="Always available" tone="neutral" />
                </DataRow>
                {triggers.map((trigger) => {
                  const row = armed.find(
                    (item) => item.triggerId === trigger.id,
                  );
                  return (
                    <DataRow
                      key={trigger.id}
                      data-trigger-id={trigger.id}
                      className="flex flex-wrap items-start"
                    >
                      <div className="min-w-0 flex-1 basis-full @sm:basis-48">
                        <strong>{triggerName(trigger)}</strong>
                        <p>
                          {trigger.on === "schedule"
                            ? `Schedule · ${scheduleSummary(trigger.cron)}`
                            : trigger.on === "event"
                              ? `App event · ${appName(trigger)} · ${eventLabel(trigger.event)}`
                              : "Webhook · unavailable"}
                        </p>
                        {row?.lastError ? (
                          <p role="alert">{row.lastError}</p>
                        ) : null}
                      </div>
                      <Status
                        label={
                          trigger.on === "webhook"
                            ? "Unavailable"
                            : row?.state === "paused"
                              ? "Paused"
                              : row?.state === "active"
                                ? "On"
                                : "Off"
                        }
                        tone={
                          row?.state === "paused"
                            ? "error"
                            : row?.state === "active"
                              ? "success"
                              : "neutral"
                        }
                      />
                    </DataRow>
                  );
                })}
              </DataList>
            </Surface>
          </FieldSet>
          {upcoming.length ? (
            <FieldSet
              legend={anyOn ? "Next 3 runs" : "Would run once it is on"}
            >
              <ol
                aria-label={anyOn ? "Next 3 runs" : "Would run once it is on"}
                className="text-sm"
              >
                {upcoming.map(({ at, trigger }) => (
                  <li key={`${trigger.id}-${String(at)}`}>
                    {runWords(at, trigger.cron.timeZone)} ·{" "}
                    {triggerName(trigger)}
                  </li>
                ))}
              </ol>
            </FieldSet>
          ) : null}
          {settings}
        </>
      )}
    </main>
  );
}
