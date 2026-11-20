import { Badge } from "@fungi.computer/caps/components/badge";
import { Button } from "@fungi.computer/caps/components/button";
import { Surface } from "@fungi.computer/caps/components/surface";
import type { DraftDiff } from "./draft-diff.js";
import { humanTitle } from "./human-title.js";

const maxLines = 4;

/** One line per changed step: what it is called and which parts moved. */
function lines(diff: DraftDiff, title: (id: string) => string) {
  return diff.changed.map(
    (step) =>
      `${title(step.id)}: ${step.fields.map((field) => humanTitle(field.field).toLowerCase()).join(", ")}`,
  );
}

/**
 * What an Agent did to the draft since the live version: the counts in the
 * marks' own colours, which steps changed and how, and the two ways out. Keep
 * accepts the change as the draft; Undo puts the live version back.
 */
export function DraftDiffOverlay({
  diff,
  title,
  by,
  busy,
  onKeep,
  onUndo,
}: {
  diff: DraftDiff;
  /** A step's name as the canvas shows it. */
  title: (id: string) => string;
  /** The Agent's name, when it is known: "Moss changed this draft". */
  by?: string | undefined;
  /** An undo is running. */
  busy: boolean;
  onKeep: () => void;
  /** Absent when there is no live version to go back to. */
  onUndo?: (() => void) | undefined;
}) {
  const detail = lines(diff, title);
  return (
    <Surface
      role="region"
      aria-label="Changes by an Agent"
      placement="embedded"
      size="sm"
      className="wf-diff"
    >
      <p className="wf-diff-summary">
        <strong>{`${by ?? "An Agent"} changed this draft`}</strong>
        <span className="wf-diff-counts">
          {diff.changed.length > 0 ? (
            <Badge size="sm" tone="warning">
              {String(diff.changed.length)} changed
            </Badge>
          ) : null}
          {diff.added.length > 0 ? (
            <Badge size="sm" tone="success">
              {String(diff.added.length)} added
            </Badge>
          ) : null}
          {diff.removed.length > 0 ? (
            <Badge size="sm" tone="error">
              {String(diff.removed.length)} removed
            </Badge>
          ) : null}
        </span>
      </p>
      {detail.length > 0 ? (
        <p className="wf-diff-lines">
          {[
            ...detail.slice(0, maxLines),
            ...(detail.length > maxLines
              ? [`and ${String(detail.length - maxLines)} more`]
              : []),
          ].join(" · ")}
        </p>
      ) : null}
      <span className="wf-diff-actions">
        <Button size="sm" variant="primary" disabled={busy} onClick={onKeep}>
          Keep
        </Button>
        {onUndo === undefined ? null : (
          <Button size="sm" variant="outline" disabled={busy} onClick={onUndo}>
            {busy ? "Undoing…" : "Undo"}
          </Button>
        )}
      </span>
    </Surface>
  );
}
