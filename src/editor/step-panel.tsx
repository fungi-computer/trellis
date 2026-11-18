import { useRef, type ReactNode } from "react";
import { Button } from "@fungi.computer/caps/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@fungi.computer/caps/components/dropdown-menu";
import { Field, FieldSet } from "@fungi.computer/caps/components/field";
import { Input } from "@fungi.computer/caps/components/input";
import { Textarea } from "@fungi.computer/caps/components/textarea";
import type { Issue, Node } from "@fungi.computer/braid";

/** The retry choices the schema allows: how many tries in all. */
const tries = [1, 2, 3, 4, 5] as const;

/** A step with its display text set, or cleared when the text is empty. */
function withText(node: Node, key: "title" | "note", value: string): Node {
  if (node.kind === "review" && key === "title")
    return { ...node, title: value };
  const next = { ...node };
  if (key === "title") {
    if (value) next.title = value;
    else delete next.title;
  } else if (value) next.note = value;
  else delete next.note;
  return next;
}

/** One attempt is the default, so choosing it leaves the step without a `retry`. */
function withTries(
  node: Extract<Node, { kind: "app" }>,
  attempts: number,
): Node {
  if (attempts === 1) {
    const next = { ...node };
    delete next.retry;
    return next;
  }
  return { ...node, retry: { attempts } };
}

/**
 * The panel for one selected step: its name and where it comes from, a slot
 * for testing it, its fields, what happens when it fails, and a note. A
 * problem sits on the field that has it (a field marks itself with
 * `data-problem`); the header only counts them and takes you to the first.
 */
export function StepPanel({
  node,
  defaultTitle,
  meta,
  problemCount,
  loose,
  onChange,
  onRemove,
  children,
}: {
  node: Node;
  /** What the step is called until it has a name of its own. */
  defaultTitle: string;
  /** Where the step comes from, such as `Prints · Generate image`. */
  meta: string;
  /** Every problem the step has, fields and all. */
  problemCount: number;
  /** The problems no field carries, shown under the header. */
  loose: readonly Issue[];
  onChange: (node: Node) => void;
  onRemove: () => void;
  /** The step's own fields. */
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const jump = () => {
    const mark = root.current?.querySelector<HTMLElement>("[data-problem]");
    if (!mark) return;
    // The value to fix, not the source picker above it.
    const control = mark.matches("[tabindex]")
      ? mark
      : (mark.querySelector<HTMLElement>("input, textarea") ??
        mark.querySelector<HTMLElement>("select, button:not([disabled])"));
    (control ?? mark).focus();
  };
  const review = node.kind === "review";
  return (
    <div className="wf-pane-body wf-step-panel" ref={root}>
      <header className="wf-step-head">
        {review ? (
          <Field label="Question">
            <Input
              value={node.title}
              maxLength={120}
              onChange={(event) => {
                onChange(withText(node, "title", event.currentTarget.value));
              }}
            />
          </Field>
        ) : (
          <Input
            className="wf-step-name"
            aria-label="Step name"
            placeholder={defaultTitle}
            maxLength={120}
            value={node.title ?? ""}
            onChange={(event) => {
              onChange(withText(node, "title", event.currentTarget.value));
            }}
          />
        )}
        <div className="wf-step-bar">
          <p className="wf-muted wf-step-meta">{meta}</p>
          {problemCount > 0 ? (
            <Button size="xs" variant="ghost-destructive" onClick={jump}>
              {String(problemCount)}{" "}
              {problemCount === 1 ? "problem" : "problems"}
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="outline"
            disabled
            title="Testing one step is not here yet."
          >
            Test step
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Step options"
              render={<Button size="xs" variant="ghost" />}
            >
              …
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={onRemove}>
                Remove step
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {loose.map((issue, index) => (
        <p
          key={index}
          role="alert"
          tabIndex={-1}
          className="wf-step-problem"
          data-problem
        >
          {issue.message}
        </p>
      ))}
      {children}
      {node.kind === "app" ? (
        <FieldSet
          legend="If it fails"
          description="How many times in all to try this step before it stops the run."
        >
          <div className="wf-retry" role="radiogroup" aria-label="Tries">
            {tries.map((attempts) => {
              const on = (node.retry?.attempts ?? 1) === attempts;
              return (
                <Button
                  key={attempts}
                  size="xs"
                  variant={on ? "primary" : "outline"}
                  role="radio"
                  aria-checked={on}
                  aria-label={`${String(attempts)} ${attempts === 1 ? "try" : "tries"}`}
                  onClick={() => {
                    onChange(withTries(node, attempts));
                  }}
                >
                  {attempts}
                </Button>
              );
            })}
          </div>
        </FieldSet>
      ) : null}
      <Field label="Note" description="Only you and your team see this.">
        <Textarea
          aria-label="Note"
          value={node.note ?? ""}
          maxLength={500}
          onChange={(event) => {
            onChange(withText(node, "note", event.currentTarget.value));
          }}
        />
      </Field>
    </div>
  );
}
