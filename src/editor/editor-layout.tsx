import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@fungi.computer/caps/components/tabs";
import { ResizeHandle } from "@fungi.computer/caps/components/resize-handle";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Which of the two things the editor draws a phone shows. */
export type EditorView = "canvas" | "panel";

const defaultPanel = 360;
const narrowest = 280;
const widest = 560;
/** Below this a phone shows the canvas or the panel, one at a time. */
const phone = "(max-width: 900px)";

function usePhone() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(phone).matches);
  useEffect(() => {
    const query = window.matchMedia(phone);
    const update = () => {
      setNarrow(query.matches);
    };
    update();
    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
    };
  }, []);
  return narrow;
}

/**
 * The canvas with one panel at its right: a hairline between them and a
 * handle to widen the panel, no frame, header, collapse or zoom of its own.
 * A phone shows the canvas or the panel, by tab.
 */
export function EditorLayout({
  canvas,
  panel,
  panelLabel,
  view,
  onView,
}: {
  canvas: ReactNode;
  panel: ReactNode;
  panelLabel: string;
  view: EditorView;
  onView: (view: EditorView) => void;
}) {
  const narrow = usePhone();
  const stage = useRef<HTMLDivElement>(null);
  const [total, setTotal] = useState(0);
  const [panelWidth, setPanelWidth] = useState(defaultPanel);
  const drag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setTotal(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [narrow]);
  const clamp = (width: number) => Math.min(widest, Math.max(narrowest, width));
  if (narrow)
    return (
      <Tabs
        className="wf-stage wf-stage-phone"
        value={view}
        onValueChange={(value) => {
          onView(value === "panel" ? "panel" : "canvas");
        }}
      >
        <TabsList variant="segmented" aria-label="Editor view">
          <TabsTrigger value="canvas">Canvas</TabsTrigger>
          <TabsTrigger value="panel">{panelLabel}</TabsTrigger>
        </TabsList>
        <TabsContent forceMount value="canvas" className="wf-stage-body">
          {canvas}
        </TabsContent>
        <TabsContent
          forceMount
          value="panel"
          className="wf-stage-body wf-panel"
          aria-label={panelLabel}
        >
          {panel}
        </TabsContent>
      </Tabs>
    );
  return (
    <div className="wf-stage" ref={stage}>
      <div className="wf-stage-body">{canvas}</div>
      <ResizeHandle
        className="wf-panel-handle"
        aria-label="Panel width"
        orientation="vertical"
        value={total - panelWidth}
        min={total - widest}
        max={total - narrowest}
        style={{ insetInlineEnd: panelWidth }}
        onValueChange={(position) => {
          setPanelWidth(clamp(total - position));
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, width: panelWidth };
        }}
        onPointerMove={(event) => {
          if (drag.current)
            setPanelWidth(
              clamp(drag.current.width + drag.current.x - event.clientX),
            );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      />
      <aside
        className="wf-panel"
        aria-label={panelLabel}
        style={{ width: panelWidth }}
      >
        {panel}
      </aside>
    </div>
  );
}
