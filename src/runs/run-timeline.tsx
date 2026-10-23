import "./run-timeline.css";
import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@fungi.computer/caps/components/button";
import { Disclosure } from "@fungi.computer/caps/components/disclosure";
import { Monogram } from "@fungi.computer/caps/components/monogram";
import { isSigilName, Sigil } from "@fungi.computer/sigils";
import { NodeStatus } from "./node-status.js";
import { MediaThumb, StepOutput, type ReadMedia } from "./output-preview.js";
import { formatDuration, type TimelineItem } from "./timeline-items.js";

/** Open another App at what a step produced. */
export type OpenInApp = (
  appId: string,
  params: readonly Readonly<{ key: string; value: string }>[],
) => Promise<void>;

/** Steps beyond this many are folded until asked for, like a tool group. */
const RECENT = 8;

function Mark({ item }: { item: TimelineItem }) {
  if (item.app === undefined)
    return <Check size={20} aria-hidden="true" className="wf-control-mark" />;
  return item.app.icon !== undefined && isSigilName(item.app.icon) ? (
    <Sigil name={item.app.icon} size={20} />
  ) : (
    <Monogram name={item.app.displayName} subject="app" />
  );
}

function Step({
  item,
  open,
  onToggle,
  readMedia,
  openIn,
}: {
  item: TimelineItem;
  open: boolean;
  onToggle: () => void;
  readMedia?: ReadMedia | undefined;
  openIn?: OpenInApp | undefined;
}) {
  const [openError, setOpenError] = useState<Error | null>(null);
  const target = item.open;
  return (
    <li className="wf-step" data-state={item.state}>
      <div className="wf-step-row" data-open={open ? "" : undefined}>
        <Disclosure
          size="group"
          tone={item.state === "failed" ? "error" : "neutral"}
          open={open}
          onOpenChange={onToggle}
          leading={
            <>
              <Mark item={item} />
              {item.media === undefined ? null : (
                <MediaThumb media={item.media} readMedia={readMedia} />
              )}
            </>
          }
          summary={
            <>
              <span className="text-base-content">{item.title}</span>
              {item.detail === undefined ? null : (
                <span className="wf-muted"> · {item.detail}</span>
              )}
            </>
          }
          trailing={
            <>
              {item.durationMs === undefined || item.durationMs === 0 ? null : (
                <span className="text-xs">
                  {formatDuration(item.durationMs)}
                </span>
              )}
              <NodeStatus state={item.state} bare />
            </>
          }
        >
          <StepOutput step={item.step} readMedia={readMedia} />
        </Disclosure>
        {target === undefined || item.app === undefined ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="wf-step-open"
            disabled={openIn === undefined}
            onClick={() => {
              setOpenError(null);
              openIn?.(target.appId, target.params).catch((cause: unknown) => {
                setOpenError(
                  new Error(
                    `Could not open ${item.app?.displayName ?? "the App"}.`,
                    { cause },
                  ),
                );
              });
            }}
          >
            Open in {item.app.displayName}
          </Button>
        )}
      </div>
      {openError === null ? null : <p role="alert">{openError.message}</p>}
    </li>
  );
}

/** What happened in a run, newest last: App rows with a raw view behind each. */
export function RunTimeline({
  items,
  readMedia,
  openIn,
}: {
  items: readonly TimelineItem[];
  readMedia?: ReadMedia | undefined;
  openIn?: OpenInApp | undefined;
}) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(-RECENT);
  return (
    <>
      {items.length > RECENT && !all ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setAll(true);
          }}
        >
          Show {String(items.length - RECENT)} earlier steps
        </Button>
      ) : null}
      <ol className="wf-timeline" aria-label="Steps">
        {shown.map((item) => (
          <Step
            key={item.key}
            item={item}
            open={opened.has(item.key)}
            onToggle={() => {
              setOpened((previous) => {
                const next = new Set(previous);
                if (!next.delete(item.key)) next.add(item.key);
                return next;
              });
            }}
            readMedia={readMedia}
            openIn={openIn}
          />
        ))}
      </ol>
    </>
  );
}
