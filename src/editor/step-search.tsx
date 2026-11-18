import { Button } from "@fungi.computer/caps/components/button";
import { SearchInput } from "@fungi.computer/caps/components/input";
import { useOverlayRoot } from "@fungi.computer/caps/components/overlay-root";
import {
  Popover,
  PopoverAnchor,
} from "@fungi.computer/caps/components/popover";
import {
  CommandMenu,
  type CommandMenuItem,
} from "@fungi.computer/caps/blocks/command-menu";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { DraftDocument } from "./draft-store.js";
import { portPresentation } from "./graph-presentation.js";
import { WorkflowMark } from "./mark.js";
import { pinWords, type PinToken } from "./pins.js";
import {
  searchSteps,
  type MismatchOffer,
  type PinFit,
  type StepEntry,
} from "./step-catalog.js";

/*
 * The 04-A choice: a search at the pointer with a ghost of the step it would
 * add. Presentation only; what matches and what fits is step-catalog.ts.
 */

/** A place on screen, in pixels. */
export type ScreenPoint = Readonly<{ x: number; y: number }>;

const width = 352;
const reach = 420;

/** A box fixed at a point, kept on screen, that a click away or Esc closes. */
function Anchored({
  at,
  onClose,
  children,
  ghost,
}: {
  at: ScreenPoint;
  onClose: () => void;
  children: ReactNode;
  ghost?: ReactNode;
}) {
  const root = useOverlayRoot("popover");
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        !box.current?.contains(event.target)
      )
        close.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close.current();
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, []);
  if (!root) return null;
  const style: CSSProperties = {
    position: "fixed",
    zIndex: 50,
    width,
    left: Math.max(8, Math.min(at.x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(at.y, window.innerHeight - reach)),
  };
  return createPortal(
    <PopoverAnchor ref={box} className="wf-anchored" style={style}>
      {ghost}
      {children}
    </PopoverAnchor>,
    root,
  );
}

function describe(
  entry: StepEntry,
  display: DraftDocument["appDisplay"],
  fit: PinFit | undefined,
) {
  const app = display[entry.group]?.displayName ?? entry.group;
  const kind = entry.method === null ? entry.description : app;
  return fit
    ? `${kind} → ${portPresentation(fit.port, {}).label} · ${pinWords[fit.pin]}`
    : kind;
}

/**
 * Search for a step to add at a point. With `fits` (a wire dragged off a pin)
 * only the steps that take the pin are listed, each with the input it lands
 * on. Up and down move, Enter adds, Esc closes; the field keeps the focus.
 */
export function StepSearch({
  at,
  entries,
  display,
  fits,
  status,
  onChoose,
  onClose,
}: {
  at: ScreenPoint;
  entries: readonly StepEntry[];
  display: DraftDocument["appDisplay"];
  fits?: readonly PinFit[];
  /** A line above the list: loading, a limit reached, an unavailable catalog. */
  status?: string | undefined;
  onChoose: (entry: StepEntry) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const rows = useMemo(
    () =>
      searchSteps(
        fits ? fits.map((fit) => fit.entry) : entries,
        query,
        display,
      ),
    [entries, fits, query, display],
  );
  const items = useMemo<readonly CommandMenuItem[]>(
    () =>
      rows.map((entry) => ({
        id: entry.key,
        label: entry.name,
        description: describe(
          entry,
          display,
          fits?.find((fit) => fit.entry.key === entry.key),
        ),
        media: (
          <WorkflowMark
            appIcon={entry.appId ? display[entry.appId]?.icon : undefined}
            appName={display[entry.group]?.displayName ?? entry.group}
            kind={entry.appId ? "app" : entry.key}
          />
        ),
      })),
    [rows, display, fits],
  );
  // The menu owns which row is lit; the ghost follows it.
  useEffect(() => {
    const menu = list.current;
    if (!menu) return;
    const read = () => {
      setActive(
        menu
          .querySelector("[data-active]")
          ?.getAttribute("data-search-option") ?? null,
      );
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(menu, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-active"],
    });
    return () => {
      observer.disconnect();
    };
  }, []);
  const lit = rows.find((entry) => entry.key === active) ?? rows.at(0);
  const empty = query.trim() !== "" || fits !== undefined;
  return (
    <Anchored
      at={at}
      onClose={onClose}
      ghost={
        <div className="wf-ghost" aria-hidden="true" data-ghost>
          <WorkflowMark
            appIcon={lit?.appId ? display[lit.appId]?.icon : undefined}
            appName={
              lit ? (display[lit.group]?.displayName ?? lit.group) : "App"
            }
            kind={lit?.appId ? "app" : (lit?.key ?? "input")}
          />
          <span>{lit?.name ?? "New step"}</span>
        </div>
      }
    >
      <Popover
        open
        side="bottom"
        className="wf-search"
        role="dialog"
        aria-label="Add a step"
      >
        <SearchInput
          autoFocus
          aria-label="Search steps"
          placeholder={
            fits ? "Search steps that take this pin…" : "Search steps…"
          }
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (
              event.key !== "ArrowDown" &&
              event.key !== "ArrowUp" &&
              event.key !== "Enter"
            )
              return;
            // The field keeps the focus; the menu does the moving and choosing.
            event.preventDefault();
            list.current?.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: event.key,
                bubbles: true,
                cancelable: true,
              }),
            );
          }}
        />
        {status ? (
          <p role="status" className="wf-muted">
            {status}
          </p>
        ) : null}
        {items.length === 0 && empty && !status ? (
          <p role="status" className="wf-muted">
            {query.trim() === ""
              ? "No step has an input that takes this pin."
              : `No steps match “${query.trim()}”.`}
          </p>
        ) : null}
        <CommandMenu
          ref={list}
          aria-label="Steps"
          items={items}
          descriptionPlacement="inline"
          hidden={items.length === 0}
          onSelect={(key) => {
            const entry = rows.find((row) => row.key === key);
            if (entry) onChoose(entry);
          }}
        />
      </Popover>
    </Anchored>
  );
}

const legend = [
  "text",
  "number",
  "yes-no",
  "list",
  "fields",
  "image",
  "file-path",
  "any",
  "flow",
] as const satisfies readonly PinToken[];

/**
 * A wire the types refuse: what did not fit what, a way to mend it where a
 * Transform step can, and what each pin colour stands for.
 */
export function PinMismatch({
  at,
  message,
  offers,
  onOffer,
  onClose,
}: {
  at: ScreenPoint;
  message: string;
  offers: readonly MismatchOffer[];
  onOffer: (offer: MismatchOffer) => void;
  onClose: () => void;
}) {
  return (
    <Anchored at={at} onClose={onClose}>
      <Popover
        open
        side="bottom"
        className="wf-mismatch"
        role="alertdialog"
        aria-label="This wire does not fit"
      >
        <p role="alert" className="wf-mismatch-message">
          {message}
        </p>
        {offers.map((offer) => (
          <Button
            key={offer.kind}
            variant="outline"
            size="sm"
            autoFocus={offer === offers[0]}
            onClick={() => {
              onOffer(offer);
            }}
          >
            {offer.label}
          </Button>
        ))}
        <ul className="wf-legend" aria-label="Pin colours">
          {legend.map((token) => (
            <li key={token}>
              <span
                className="wf-legend-dot"
                data-pin={token}
                aria-hidden="true"
              />
              {pinWords[token]}
            </li>
          ))}
        </ul>
      </Popover>
    </Anchored>
  );
}
