import { useEffect, useRef, useState } from "react";
import type { AppAgent } from "@fungi.computer/agar/agents";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { LoadingState } from "@fungi.computer/caps/blocks/loading-state";
import { Button } from "@fungi.computer/caps/components/button";
import {
  DataList,
  DataListHeading,
  DataRow,
} from "@fungi.computer/caps/components/data-list";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { Status } from "@fungi.computer/caps/components/status";
import { Surface } from "@fungi.computer/caps/components/surface";
import type { AgentScheduleRow } from "@fungi.computer/shiitake-extensions/schedules";
import { Sigil } from "@fungi.computer/sigils";
import { Pause, Play, RotateCw, Trash2, X } from "lucide-react";
import type { WorkflowClient } from "../workflow-client.js";
import {
  agentPageRows,
  SchedulePageError,
  scheduleKey,
  scheduleTarget,
  workflowPageRows,
  type WorkflowSchedule,
} from "./page.js";
import {
  presentSchedule,
  type ScheduleAction,
  type ScheduleSubject,
} from "./present.js";
import "./schedules.css";

type Read<T> =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; rows: readonly T[] };
type AgentGroup = { agent: AppAgent; page: Read<AgentScheduleRow> };
type Entry = {
  key: string;
  subject: ScheduleSubject;
  shown: ReturnType<typeof presentSchedule>;
};
type Group = {
  key: string;
  name: string;
  label: string;
  viewOnly: boolean;
  page: Read<unknown>;
  entries: Entry[];
  empty: string;
};
const actionLabels = { pause: "Pause", resume: "Resume", delete: "Delete" };
const acknowledgements = {
  pause: "Paused.",
  resume: "Resumed.",
  delete: "Deleted.",
};
class ReceiptMismatch extends Error {}

function readFailure(cause: unknown, fallback: string): string {
  return cause instanceof SchedulePageError ? cause.message : fallback;
}

async function readAgentPage(
  client: WorkflowClient,
  agent: AppAgent,
): Promise<Read<AgentScheduleRow>> {
  if (!agent.sessionOperations.includes("agent.read"))
    return {
      kind: "unavailable",
      message: "Trellis can't see " + agent.name + "'s schedules.",
    };
  try {
    return {
      kind: "ready",
      rows: agentPageRows(
        agent.agentId,
        await client.listAgentSchedules(agent.agentId),
      ),
    };
  } catch (cause) {
    return {
      kind: "unavailable",
      message: readFailure(
        cause,
        agent.name + "'s schedules aren't available right now.",
      ),
    };
  }
}

/** Prints' non-modal fact table and equal key panel. The list owns return focus. */
function ScheduleInfo({
  entry,
  pending,
  notice,
  error,
  onClose,
  onAction,
}: {
  entry: Entry;
  pending: ScheduleAction | null;
  notice: string | null;
  error: string | null;
  onClose: () => void;
  onAction: (action: ScheduleAction) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const { shown } = entry;
  return (
    <Surface
      ref={panel}
      className="wf-schedule-info"
      role="region"
      aria-label="Schedule info"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="wf-schedule-info-heading">
        <h2>Schedule info</h2>
        <IconButton
          aria-label="Close schedule info"
          icon={<X />}
          onClick={onClose}
        />
      </div>
      <p className="wf-schedule-kind">
        <Sigil name={shown.kindSigil} size={20} />
        {shown.kindLabel}
      </p>
      <DataList density="compact" className="wf-schedule-facts">
        {shown.facts.map((fact) => (
          <DataRow key={fact.label}>
            <span className="wf-fact-label">
              <Sigil name={fact.sigil} size={16} />
              {fact.label}
            </span>
            <span
              className="wf-fact-value"
              role={fact.alert ? "alert" : undefined}
            >
              {fact.dateTime ? (
                <time dateTime={fact.dateTime}>{fact.value}</time>
              ) : (
                fact.value
              )}
            </span>
          </DataRow>
        ))}
      </DataList>
      {shown.keys.length > 0 ? (
        <div
          className="wf-schedule-keys"
          role="group"
          aria-label="Schedule actions"
        >
          {shown.keys.map((action) => (
            <KeycapButton
              key={action}
              label={actionLabels[action]}
              icon={
                action === "pause" ? (
                  <Pause />
                ) : action === "resume" ? (
                  <Play />
                ) : (
                  <Trash2 />
                )
              }
              tone={action === "delete" ? "destructive" : "neutral"}
              title={
                action === "pause"
                  ? "Stop future runs until you resume."
                  : action === "resume"
                    ? "Start again from the next run time."
                    : undefined
              }
              disabled={pending !== null}
              aria-busy={pending === action}
              onClick={() => {
                onAction(action);
              }}
            />
          ))}
        </div>
      ) : shown.viewOnly ? (
        <p className="wf-muted">You can see this schedule but not change it.</p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </Surface>
  );
}

/** One window-local read of native owners, never scheduling or reconstructing work. */
export function Schedules({
  client,
  onOpenWorkflows,
}: {
  client: WorkflowClient;
  onOpenWorkflows: () => void;
}) {
  const [workflow, setWorkflow] = useState<Read<WorkflowSchedule>>({
    kind: "loading",
  });
  const [agents, setAgents] = useState<Read<AgentGroup>>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<ScheduleAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Entry | null>(null);
  // Undefined permits the desktop default; null records an explicit close.
  const [selectedKey, setSelectedKey] = useState<string | null>();
  const [wide, setWide] = useState(false);
  const main = useRef<HTMLElement>(null);
  const generation = useRef(0);
  const busy = pending !== null;
  useEffect(() => {
    const element = main.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const rem = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      // Container queries use the content box, not the padded border box.
      setWide(entry.contentRect.width > 40 * rem);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    const version = ++generation.current;
    const current = () => generation.current === version;
    setWorkflow({ kind: "loading" });
    setAgents({ kind: "loading" });
    setConfirmation(null);
    setPending(null);
    void client
      .listTriggers({ limit: 100 })
      .then((page) => {
        const rows = workflowPageRows(page);
        if (current()) setWorkflow({ kind: "ready", rows });
      })
      .catch((cause: unknown) => {
        if (current())
          setWorkflow({
            kind: "unavailable",
            message: readFailure(
              cause,
              "Workflow schedules aren't available right now.",
            ),
          });
      });
    void (async () => {
      const directory = await client.listScheduleAgents();
      if (!current()) return;
      const seen = new Set<string>();
      for (const agent of directory) {
        if (seen.has(agent.agentId)) throw new SchedulePageError("identity");
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
        setAgents({
          kind: "unavailable",
          message: readFailure(
            cause,
            "Agent schedules aren't available right now.",
          ),
        });
    });
    return () => {
      generation.current++;
    };
  }, [client, attempt]);

  const now = Date.now();
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  function entry(subject: ScheduleSubject): Entry {
    return {
      key:
        subject.kind === "workflow"
          ? JSON.stringify(["workflow", subject.row.scheduleId])
          : scheduleKey(scheduleTarget(subject.row)),
      subject,
      shown: presentSchedule(subject, now, viewerZone),
    };
  }
  const groups: Group[] = [
    {
      key: "workflows",
      name: "Workflows",
      label: "Workflow schedules",
      viewOnly: false,
      page: workflow,
      entries:
        workflow.kind === "ready"
          ? workflow.rows.map((row) => entry({ kind: "workflow", row }))
          : [],
      empty: "No Workflow schedules yet.",
    },
    ...(agents.kind === "ready"
      ? agents.rows.map(({ agent, page }) => {
          const canManage = agent.sessionOperations.includes("agent.manage");
          return {
            key: agent.agentId,
            name: agent.name,
            label: agent.name + " schedules",
            viewOnly: !canManage,
            page,
            entries:
              page.kind === "ready"
                ? page.rows.map((row) =>
                    entry({
                      kind: "agent",
                      row,
                      agentName: agent.name,
                      canManage,
                    }),
                  )
                : [],
            empty: "No schedules yet.",
          };
        })
      : []),
  ];
  const entries = groups.flatMap((group) => group.entries);
  // Nothing is scheduled anywhere and every read succeeded: teach the first step.
  const nothingScheduled =
    workflow.kind === "ready" &&
    agents.kind === "ready" &&
    entries.length === 0 &&
    agents.rows.every(({ page }) => page.kind === "ready");
  const selected =
    selectedKey === undefined
      ? wide
        ? entries[0]
        : undefined
      : entries.find((row) => row.key === selectedKey);

  function closeInfo() {
    const opener = [
      ...(main.current?.querySelectorAll<HTMLButtonElement>(
        ".wf-schedule-open",
      ) ?? []),
    ].find((button) => button.dataset.scheduleKey === selected?.key);
    setSelectedKey(null);
    opener?.focus();
  }

  async function mutate(subject: ScheduleSubject, action: ScheduleAction) {
    if (subject.kind === "agent") {
      const target = scheduleTarget(subject.row);
      const receipt = await (action === "pause"
        ? client.pauseAgentSchedule(target)
        : action === "resume"
          ? client.resumeAgentSchedule(target)
          : client.deleteAgentSchedule(target));
      const expected =
        action === "pause"
          ? "paused"
          : action === "resume"
            ? "active"
            : "cancelled";
      if (
        scheduleKey(receipt) !== scheduleKey(target) ||
        (receipt.state !== expected &&
          !(action === "delete" && receipt.state === "finished"))
      )
        throw new ReceiptMismatch();
      return acknowledgements[action];
    }
    const result = await (action === "pause"
      ? client.pause(subject.row.scheduleId)
      : action === "resume"
        ? client.resume(subject.row.scheduleId)
        : client.disarm(subject.row.scheduleId));
    if ("error" in result) throw new Error(result.error);
    if (result.kind === "refused") throw new Error(result.reason);
    return result.kind === "not_found"
      ? "This schedule is already gone."
      : acknowledgements[action];
  }

  async function change(target: Entry, action: ScheduleAction) {
    // Withdraw all old controls before the call, including while a refresh fails.
    const version = ++generation.current;
    setPending(action);
    setError(null);
    setNotice(null);
    setWorkflow({ kind: "loading" });
    setAgents({ kind: "loading" });
    try {
      const result = await mutate(target.subject, action);
      if (generation.current === version) setNotice(result);
    } catch (cause) {
      if (generation.current === version)
        setError(
          "Couldn't " +
            action +
            " this schedule." +
            (cause instanceof ReceiptMismatch ? " Refresh and try again." : ""),
        );
    } finally {
      if (generation.current === version) {
        setPending(null);
        setConfirmation(null);
        setAttempt((value) => value + 1);
      }
    }
  }

  return (
    <main ref={main} className="wf-page wf-schedules">
      <header className="wf-schedules-heading">
        <div>
          <h1>Schedules</h1>
          {nothingScheduled ? null : (
            <p className="wf-muted">Everything that runs on a timer.</p>
          )}
        </div>
        <IconButton
          aria-label="Refresh schedules"
          title="Refresh"
          icon={<RotateCw />}
          disabled={busy}
          onClick={() => {
            setNotice(null);
            setError(null);
            setAttempt((value) => value + 1);
          }}
        />
      </header>
      {busy ? <p role="status">Updating…</p> : null}
      {!selected && notice ? <p role="status">{notice}</p> : null}
      {!selected && error ? <p role="alert">{error}</p> : null}
      <div className="wf-schedules-body">
        <div className="wf-schedules-list">
          {nothingScheduled ? (
            <EmptyState
              variant="quiet"
              title="Nothing scheduled"
              description="Schedules run a workflow on a timer. Add one from a workflow's trigger."
              actions={
                <Button variant="primary" onClick={onOpenWorkflows}>
                  Open workflows
                </Button>
              }
            />
          ) : (
            groups.map((group) => (
              <section key={group.key} aria-label={group.label}>
                <DataListHeading
                  level={2}
                  aside={group.viewOnly ? "View only" : undefined}
                >
                  {group.name}
                </DataListHeading>
                {group.page.kind === "loading" ? (
                  <LoadingState message="Loading schedules…" />
                ) : group.page.kind === "unavailable" ? (
                  <p role="alert">{group.page.message}</p>
                ) : group.entries.length === 0 ? (
                  <p>{group.empty}</p>
                ) : (
                  <DataList aria-label={group.name + " schedule registrations"}>
                    {group.entries.map((row) => (
                      <DataRow
                        key={row.key}
                        className="wf-schedule-row"
                        aria-current={selected?.key === row.key || undefined}
                      >
                        <button
                          type="button"
                          className="wf-schedule-open"
                          data-schedule-key={row.key}
                          aria-label={row.shown.title}
                          onClick={() => {
                            setSelectedKey(row.key);
                          }}
                        >
                          <span className="wf-schedule-sigil">
                            <Sigil name={row.shown.kindSigil} size={24} />
                          </span>
                          <strong className="wf-schedule-title">
                            {row.shown.title}
                          </strong>
                          <Status
                            glyph="dot"
                            size="compact"
                            label={row.shown.status.label}
                            tone={row.shown.status.tone}
                          />
                          <span className="wf-muted wf-schedule-line">
                            {row.shown.line}
                          </span>
                        </button>
                      </DataRow>
                    ))}
                  </DataList>
                )}
              </section>
            ))
          )}
          {agents.kind === "loading" ? (
            <LoadingState message="Loading schedules…" />
          ) : null}
          {agents.kind === "unavailable" ? (
            <p role="alert">{agents.message}</p>
          ) : null}
        </div>
        {selected ? (
          <ScheduleInfo
            key={selected.key}
            entry={selected}
            pending={pending}
            notice={notice}
            error={error}
            onClose={closeInfo}
            onAction={(action) => {
              if (action === "delete") setConfirmation(selected);
              else void change(selected, action);
            }}
          />
        ) : null}
      </div>
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
              "{confirmation?.shown.title}" won't run again. Runs that already
              started, and their history, stay.
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
              Keep
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (confirmation !== null) void change(confirmation, "delete");
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
