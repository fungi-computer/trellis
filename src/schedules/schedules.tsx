import { useEffect, useRef, useState } from "react";
import type { AppAgent } from "@fungi.computer/agar/agents";
import { Button } from "@fungi.computer/caps/components/button";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import type { AgentScheduleRow } from "@fungi.computer/shiitake-extensions/schedules";
import type { WorkflowClient } from "../workflow-client.js";
import {
  agentPageRows,
  scheduleKey,
  scheduleTarget,
  workflowPageRows,
  type WorkflowSchedule,
} from "./page.js";
import "./schedules.css";

type Read<T> =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; rows: readonly T[] };
type AgentGroup = { agent: AppAgent; page: Read<AgentScheduleRow> };

function failure(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : "The schedule owner is unavailable.";
}

async function readAgentPage(
  client: WorkflowClient,
  agent: AppAgent,
): Promise<Read<AgentScheduleRow>> {
  try {
    if (!agent.sessionOperations.includes("agent.read"))
      throw new Error("Schedule read access is not granted for this Agent.");
    return {
      kind: "ready",
      rows: agentPageRows(
        agent.agentId,
        await client.listAgentSchedules(agent.agentId),
      ),
    };
  } catch (cause) {
    return { kind: "unavailable", message: failure(cause) };
  }
}

function Due({ value }: { value: number | null }) {
  if (value === null) return <span>No occurrence scheduled</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span>Time unavailable</span>;
  return (
    <time dateTime={date.toISOString()}>
      {date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })}
    </time>
  );
}

function Actions({
  disabled,
  active,
  onPause,
  onDelete,
}: {
  disabled: boolean;
  active: boolean;
  onPause: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="wf-actions">
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled || !active}
        onClick={onPause}
      >
        Pause
      </Button>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={onDelete}>
        Delete
      </Button>
    </div>
  );
}

/** One window-local read of native owners, never scheduling or reconstructing work. */
export function Schedules({ client }: { client: WorkflowClient }) {
  const [workflow, setWorkflow] = useState<Read<WorkflowSchedule>>({
    kind: "loading",
  });
  const [agents, setAgents] = useState<Read<AgentGroup>>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    run: () => Promise<string>;
  } | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const version = ++generation.current;
    const current = () => generation.current === version;
    setWorkflow({ kind: "loading" });
    setAgents({ kind: "loading" });
    setConfirmation(null);
    setBusy(false);
    void client
      .listTriggers({ limit: 100 })
      .then((page) => {
        const rows = workflowPageRows(page);
        if (current()) setWorkflow({ kind: "ready", rows });
      })
      .catch((cause: unknown) => {
        if (current())
          setWorkflow({ kind: "unavailable", message: failure(cause) });
      });
    void (async () => {
      const directory = await client.listScheduleAgents();
      if (!current()) return;
      const seen = new Set<string>();
      for (const agent of directory) {
        if (seen.has(agent.agentId))
          throw new Error(
            "Duplicate Agent identity; schedules are unavailable.",
          );
        seen.add(agent.agentId);
      }
      setAgents({
        kind: "ready",
        rows: directory.map((agent) => ({ agent, page: { kind: "loading" } })),
      });
      // One outstanding Agent page at a time; no parallel scrape or page draining.
      for (const agent of directory) {
        if (!current()) return;
        const page = await readAgentPage(client, agent);
        if (!current()) return;
        setAgents((state) =>
          state.kind !== "ready"
            ? state
            : {
                kind: "ready",
                rows: state.rows.map((group) =>
                  group.agent.agentId === agent.agentId
                    ? { agent, page }
                    : group,
                ),
              },
        );
      }
    })().catch((cause: unknown) => {
      if (current())
        setAgents({ kind: "unavailable", message: failure(cause) });
    });
    return () => {
      generation.current++;
    };
  }, [client, attempt]);

  async function change(run: () => Promise<string>) {
    // Withdraw all old controls before the call, including while a refresh fails.
    const version = ++generation.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    setWorkflow({ kind: "loading" });
    setAgents({ kind: "loading" });
    try {
      const result = await run();
      if (generation.current === version) setNotice(result);
    } catch (cause) {
      if (generation.current === version) setError(failure(cause));
    } finally {
      if (generation.current === version) {
        setBusy(false);
        setConfirmation(null);
        setAttempt((value) => value + 1);
      }
    }
  }

  async function agentChange(
    row: AgentScheduleRow,
    action: "pause" | "delete",
  ) {
    const target = scheduleTarget(row);
    const receipt = await (action === "pause"
      ? client.pauseAgentSchedule(target)
      : client.deleteAgentSchedule(target));
    if (scheduleKey(receipt) !== scheduleKey(target))
      throw new Error(
        "The owner returned another schedule identity. Refresh before trying again.",
      );
    return `Owner state: ${receipt.state}.`;
  }

  async function workflowChange(
    row: WorkflowSchedule,
    action: "pause" | "delete",
  ) {
    const result = await (action === "pause"
      ? client.pause(row.scheduleId)
      : client.disarm(row.scheduleId));
    if ("error" in result) throw new Error(result.error);
    return result.kind === "not_found"
      ? "The registration is no longer available."
      : "The owner accepted the change.";
  }

  return (
    <main className="wf-page wf-schedules">
      <header className="wf-schedules-heading">
        <div>
          <h1>Schedules</h1>
          <p className="wf-muted">
            Agent reminders, Session Loops and this installation’s Workflow
            schedules.
          </p>
        </div>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setAttempt((value) => value + 1);
          }}
        >
          Refresh
        </Button>
      </header>
      <p className="wf-muted">
        Pause or Delete stops future occurrences. Already accepted work and
        history are kept.
      </p>
      {busy ? <p role="status">Waiting for the schedule owner…</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? (
        <p role="alert">The change could not be confirmed: {error}</p>
      ) : null}
      <section aria-label="Workflow schedules">
        <h2>Workflows</h2>
        {workflow.kind === "loading" ? (
          <p role="status">Loading Workflow schedules…</p>
        ) : null}
        {workflow.kind === "unavailable" ? (
          <p role="alert">Workflow schedules unavailable: {workflow.message}</p>
        ) : null}
        {workflow.kind === "ready" ? (
          <>
            {workflow.rows.length === 0 ? (
              <p>No Workflow schedules in this installation.</p>
            ) : null}
            <DataList aria-label="Workflow schedule registrations">
              {workflow.rows.map((row) => (
                <DataRow key={row.scheduleId} className="wf-schedule-row">
                  <div className="wf-schedule-subject">
                    <h3>
                      {row.workflowId}{" "}
                      <span className="wf-muted">/ {row.triggerId}</span>
                    </h3>
                    <p className="wf-muted">
                      Workflow · Installation {row.installationId}
                    </p>
                    <p>
                      <Due value={row.nextDueAt} /> · {row.state}
                    </p>
                    <details>
                      <summary>Registration details</summary>
                      <p>Schedule {row.scheduleId}</p>
                      <p>
                        Cadence, armer and grantor attribution are unavailable
                        in this owner’s listing.
                      </p>
                    </details>
                    {row.lastError ? <p role="alert">{row.lastError}</p> : null}
                  </div>
                  <Actions
                    disabled={
                      busy ||
                      row.state === "cancelled" ||
                      row.state === "finished"
                    }
                    active={row.state === "active"}
                    onPause={() =>
                      void change(() => workflowChange(row, "pause"))
                    }
                    onDelete={() => {
                      setConfirmation({
                        title: `${row.workflowId} / ${row.triggerId}`,
                        run: () => workflowChange(row, "delete"),
                      });
                    }}
                  />
                </DataRow>
              ))}
            </DataList>
          </>
        ) : null}
      </section>
      <section aria-label="Agent schedules">
        <h2>Agents</h2>
        {agents.kind === "loading" ? (
          <p role="status">Loading Agent schedules…</p>
        ) : null}
        {agents.kind === "unavailable" ? (
          <p role="alert">Agent schedules unavailable: {agents.message}</p>
        ) : null}
        {agents.kind === "ready" && agents.rows.length === 0 ? (
          <p>No Agents are visible to Trellis.</p>
        ) : null}
        {agents.kind === "ready"
          ? agents.rows.map(({ agent, page }) => (
              <section
                key={agent.agentId}
                aria-label={`${agent.name} schedules`}
                className="wf-schedule-agent"
              >
                <h3>{agent.name}</h3>
                <p className="wf-muted">Agent {agent.agentId}</p>
                {page.kind === "loading" ? (
                  <p role="status">Loading schedules…</p>
                ) : null}
                {page.kind === "unavailable" ? (
                  <p role="alert">Unavailable: {page.message}</p>
                ) : null}
                {page.kind === "ready" ? (
                  <>
                    {page.rows.length === 0 ? (
                      <p>No schedules for this Agent.</p>
                    ) : null}
                    {!agent.sessionOperations.includes("agent.manage") ? (
                      <p className="wf-muted">
                        Read only. Schedule management is not granted for this
                        Agent.
                      </p>
                    ) : null}
                    <DataList
                      aria-label={`${agent.name} schedule registrations`}
                    >
                      {page.rows.map((row) => (
                        <DataRow
                          key={scheduleKey(scheduleTarget(row))}
                          className="wf-schedule-row"
                        >
                          <div className="wf-schedule-subject">
                            <h4>
                              {row.kind === "almanac"
                                ? "Reminder"
                                : "Session Loop"}
                            </h4>
                            <p className="wf-schedule-prompt">
                              {row.schedule.prompt}
                            </p>
                            <p>
                              <Due value={row.schedule.nextDueAt} /> ·{" "}
                              {row.schedule.state}
                            </p>
                            <p className="wf-muted">
                              {row.schedule.cron
                                ? `${row.schedule.cron.expression} · ${row.schedule.cron.timeZone}`
                                : row.kind === "loop"
                                  ? row.schedule.mode === "self_paced"
                                    ? "Self-paced"
                                    : "Cadence unavailable"
                                  : "One-time"}{" "}
                              · Session {row.schedule.sessionId}
                            </p>
                            {row.kind === "loop" ? (
                              <p className="wf-muted">
                                Started by{" "}
                                {row.schedule.origin === "human"
                                  ? "a person"
                                  : "the model"}
                              </p>
                            ) : null}
                            {row.schedule.lastError ? (
                              <p role="alert">{row.schedule.lastError}</p>
                            ) : null}
                          </div>
                          <Actions
                            disabled={
                              busy ||
                              !agent.sessionOperations.includes(
                                "agent.manage",
                              ) ||
                              row.schedule.state === "cancelled" ||
                              row.schedule.state === "finished"
                            }
                            active={row.schedule.state === "active"}
                            onPause={() =>
                              void change(() => agentChange(row, "pause"))
                            }
                            onDelete={() => {
                              setConfirmation({
                                title: `${agent.name} · ${row.kind === "almanac" ? "Reminder" : "Session Loop"}`,
                                run: () => agentChange(row, "delete"),
                              });
                            }}
                          />
                        </DataRow>
                      ))}
                    </DataList>
                  </>
                ) : null}
              </section>
            ))
          : null}
      </section>
      <aside className="wf-muted">
        Private Local schedules are unavailable through this App connection.
        Unjoined Local Agents require the person’s private Local-owner
        capability; they are not represented by an empty Agent list.
      </aside>
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open, details) => {
          if (busy) {
            details.cancel();
            return;
          }
          if (!open) setConfirmation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this schedule?</DialogTitle>
            <DialogDescription>
              {confirmation?.title}. Future occurrences stop; accepted work and
              history stay.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setConfirmation(null);
              }}
            >
              Keep schedule
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (confirmation !== null) void change(confirmation.run);
              }}
            >
              Delete schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
