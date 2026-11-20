import { useMemo, useState } from "react";
import { Button } from "@fungi.computer/caps/components/button";
import { SearchInput } from "@fungi.computer/caps/components/input";
import { Status } from "@fungi.computer/caps/components/status";
import { Switch } from "@fungi.computer/caps/components/switch";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@fungi.computer/caps/components/tabs";
import { LoadingState } from "@fungi.computer/caps/blocks/loading-state";
import { Sigil } from "@fungi.computer/sigils";
import { appMarks } from "../templates/app-marks.js";
import {
  homeSummary,
  visibleRow,
  workflowFilters,
  type HomeRow,
  type WorkflowFilter,
} from "./workflow-rows.js";
import type { SwitchOutcome } from "./use-workflow-rows.js";

/** What one row's controls ask of the workspace. */
export type HomeActions = Readonly<{
  /** Open a workflow on its canvas. */
  open: (workflowId: string) => void;
  /** Open one run: "Answer" and "See why" go here. */
  openRun: (workflowId: string, runId: string) => void;
  /** Turn a workflow on or off; the outcome is the caller's to tell the person. */
  setOn: (workflowId: string, on: boolean) => Promise<SwitchOutcome>;
  /** Start a new workflow on the canvas. */
  create: () => void;
  /** Tell the person something went wrong, once, as a toast. */
  fail: (message: string) => void;
}>;

/**
 * Home: every workflow in one table. The switch is the only control that
 * changes anything; a workflow started by hand has no switch, and a draft has
 * nothing to switch on yet.
 */
export function WorkflowsHome({
  rows,
  actions,
  creating,
}: {
  rows: readonly HomeRow[];
  actions: HomeActions;
  creating: boolean;
}) {
  const [filter, setFilter] = useState<WorkflowFilter>("all");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const shown = useMemo(
    () => rows.filter((row) => visibleRow(row, filter, search)),
    [rows, filter, search],
  );
  async function toggle(row: HomeRow, on: boolean) {
    setPending((current) => new Set(current).add(row.workflowId));
    const outcome = await actions.setOn(row.workflowId, on);
    setPending((current) => {
      const next = new Set(current);
      next.delete(row.workflowId);
      return next;
    });
    if (outcome.kind !== "done") actions.fail(outcome.message);
    if (outcome.kind === "needs-setup") actions.open(row.workflowId);
  }
  return (
    <main className="wf-page wf-home" aria-label="Workflows">
      <header className="wf-home-header">
        <div className="wf-home-title">
          <h1>Workflows</h1>
          <p className="wf-muted" data-testid="home-summary">
            {homeSummary(rows)}
          </p>
        </div>
        <SearchInput
          aria-label="Search workflows"
          placeholder="Search workflows"
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
          }}
        />
        <Tabs
          className="wf-home-filters"
          value={filter}
          onValueChange={(id) => {
            const next = workflowFilters.find((item) => item.id === id);
            if (next) setFilter(next.id);
          }}
        >
          <TabsList aria-label="Filter workflows">
            {workflowFilters.map(({ id, label }) => (
              <TabsTrigger key={id} value={id}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button variant="primary" disabled={creating} onClick={actions.create}>
          New workflow
        </Button>
      </header>
      {shown.length === 0 ? (
        <p className="wf-muted wf-home-none" role="status">
          {rows.length === 0 ? "No workflows yet." : "No workflows match."}
        </p>
      ) : (
        <table className="wf-home-table">
          <thead>
            <tr>
              <th scope="col">On</th>
              <th scope="col">Workflow</th>
              <th scope="col" className="wf-home-wide">
                Starts
              </th>
              <th scope="col">Last run</th>
              <th scope="col" className="wf-home-wide">
                Next run
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.workflowId} data-workflow-id={row.workflowId}>
                <td>
                  {row.switch.kind === "by-hand" ? (
                    <span className="wf-muted">By hand</span>
                  ) : (
                    <span
                      className="wf-switch"
                      data-mixed={row.switch.kind === "partly"}
                    >
                      <Switch
                        aria-label={`${row.title} on`}
                        aria-checked={
                          row.switch.kind === "partly" ? "mixed" : undefined
                        }
                        aria-busy={pending.has(row.workflowId)}
                        checked={
                          row.switch.kind === "on" ||
                          row.switch.kind === "partly"
                        }
                        disabled={
                          row.switch.kind === "draft" ||
                          row.switch.kind === "unavailable" ||
                          pending.has(row.workflowId)
                        }
                        onCheckedChange={(checked) => {
                          // A partly-on workflow retries what is off.
                          void toggle(
                            row,
                            row.switch.kind === "partly" ? true : checked,
                          );
                        }}
                      />
                    </span>
                  )}
                </td>
                <th scope="row">
                  <button
                    type="button"
                    className="wf-home-name"
                    onClick={() => {
                      actions.open(row.workflowId);
                    }}
                  >
                    {row.title}
                  </button>
                  <span className="wf-home-marks" aria-hidden="true">
                    {row.apps.flatMap((appId) => {
                      const mark = appMarks.get(appId);
                      return mark
                        ? [<Sigil key={appId} name={mark.icon} size={16} />]
                        : [];
                    })}
                  </span>
                  {row.published ? null : (
                    <span className="wf-muted wf-home-draft">Draft</span>
                  )}
                </th>
                <td className="wf-home-wide">{row.starts}</td>
                <td>
                  {row.last ? (
                    <span className="wf-home-last">
                      <Status
                        tone={row.last.tone}
                        label={
                          <>
                            {row.last.word}
                            <span className="wf-home-ago">
                              {" "}
                              · {row.last.ago}
                            </span>
                          </>
                        }
                      />
                      {row.last.action ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => {
                            if (row.last)
                              actions.openRun(row.workflowId, row.last.runId);
                          }}
                        >
                          {row.last.action}
                        </Button>
                      ) : null}
                    </span>
                  ) : (
                    <span className="wf-muted">—</span>
                  )}
                </td>
                <td className="wf-home-wide">
                  {row.next ?? <span className="wf-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

/** Shown while the library is still arriving; a slow read offers Retry. */
export function WorkflowsHomeLoading({
  slow,
  finding,
  onRetry,
}: {
  slow: boolean;
  /** The library exists but its index is being rebuilt. */
  finding: boolean;
  onRetry: () => void;
}) {
  return (
    <main className="wf-page wf-invitation">
      <LoadingState
        message={
          slow
            ? "Loading is taking longer than usual."
            : finding
              ? "Finding your workflows…"
              : "Opening your workflows…"
        }
      />
      {slow ? (
        <Button variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </main>
  );
}
