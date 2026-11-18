import "./run-view-layout.css";
import type { ReactNode } from "react";

/**
 * One run, laid out: its title and actions across the top, the run drawn on
 * the canvas beside a right panel (the question it waits on, what happened,
 * the steps). A phone has no room for the graph, so the canvas gives way to
 * the step strip and the panel takes the full width.
 */
export function RunViewLayout({
  runId,
  waiting,
  header,
  canvas,
  strip,
  panel,
}: {
  runId: string;
  /** True while the run waits on a person: the panel widens for the question. */
  waiting: boolean;
  header: ReactNode;
  /** The graph; absent on a phone. */
  canvas?: ReactNode;
  /** The phone's one row of steps; absent on a larger screen. */
  strip?: ReactNode;
  panel: ReactNode;
}) {
  return (
    <section
      className="wf-run-view"
      aria-label="Selected run"
      data-run-id={runId}
      data-waiting={waiting ? "" : undefined}
    >
      <header className="wf-run-view-head wf-actions">{header}</header>
      {canvas === undefined ? null : (
        <div className="wf-run-view-canvas">{canvas}</div>
      )}
      {strip === undefined ? null : (
        <div className="wf-run-view-strip">{strip}</div>
      )}
      <aside className="wf-run-view-panel" aria-label="Run details">
        {panel}
      </aside>
    </section>
  );
}
