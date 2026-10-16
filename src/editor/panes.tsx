import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  MaosaicoRoot,
  useMaosaicoItem,
  useMaosaicoLayout,
} from "@fungi.computer/maosaico";
import { Button } from "@fungi.computer/caps/components/button";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { ResizeHandle } from "@fungi.computer/caps/components/resize-handle";
import {
  WindowFrame,
  WindowHeader,
  WindowActions,
  WindowBody,
} from "@fungi.computer/caps/components/window";
import { Minus } from "lucide-react";

export type EditorPane = "palette" | "node" | "run";

type PaneId = "palette" | "canvas" | "node";
const titles = {
  palette: "Palette",
  canvas: "Canvas",
  node: "Inspector",
} satisfies Record<PaneId, string>;

/** Layout lifetime is independent of the draft, selection and run form. */
export function EditorPanes({
  palette,
  canvas,
  inspector,
  pane,
  reveal,
}: {
  palette: ReactNode;
  canvas: ReactNode;
  inspector: ReactNode;
  pane: EditorPane;
  reveal: number;
}) {
  const navigation = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState<PaneId[]>([]);
  const [zoomed, setZoomed] = useState<PaneId | null>(null);
  const [selected, setSelected] = useState<PaneId>("palette");
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => {
      setNarrow(query.matches);
    };
    update();
    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
    };
  }, []);
  useEffect(() => {
    const id = pane === "palette" ? "palette" : "node";
    setSelected(id);
    setCollapsed((current) => current.filter((item) => item !== id));
    setZoomed((current) => (current && current !== id ? null : current));
  }, [pane, reveal]);
  const open = (id: PaneId) => {
    const trigger = document.activeElement;
    setSelected(id);
    setCollapsed((current) => current.filter((item) => item !== id));
    setZoomed(null);
    if (!narrow)
      requestAnimationFrame(() => {
        if (
          document.activeElement !== trigger &&
          document.activeElement !== document.body
        )
          return;
        navigation.current?.parentElement
          ?.querySelector<HTMLButtonElement>(`[data-tile="${id}"] button`)
          ?.focus();
      });
  };
  const participates = (id: PaneId) =>
    !collapsed.includes(id) && (!narrow || selected === id);
  const controls = (id: PaneId) => ({
    id,
    title: id === "node" && pane === "run" ? "Run workflow" : titles[id],
    participating: participates(id),
    zoomed: zoomed === id,
    onZoom: () => {
      setZoomed(zoomed === id ? null : id);
    },
    onCollapse: () => {
      setCollapsed((current) => [...current, id]);
      setZoomed(null);
      const next = (["palette", "canvas", "node"] satisfies PaneId[]).find(
        (item) => item !== id && !collapsed.includes(item),
      );
      if (next) setSelected(next);
      requestAnimationFrame(() =>
        navigation.current
          ?.querySelector<HTMLButtonElement>(`[data-pane-choice="${id}"]`)
          ?.focus(),
      );
    },
  });
  return (
    <div className="wf-layout">
      <nav
        ref={navigation}
        className="wf-pane-switch"
        aria-label="Editor panes"
        hidden={!narrow && collapsed.length === 0}
      >
        {(["palette", "canvas", "node"] satisfies PaneId[])
          .filter((id) => narrow || collapsed.includes(id))
          .map((id) => (
            <Button
              key={id}
              data-pane-choice={id}
              size="xs"
              variant={
                narrow && selected === id && !collapsed.includes(id)
                  ? "outline"
                  : "ghost"
              }
              aria-label={
                collapsed.includes(id) ? `Expand ${titles[id]}` : titles[id]
              }
              aria-pressed={
                narrow
                  ? selected === id && !collapsed.includes(id)
                  : !collapsed.includes(id)
              }
              onClick={() => {
                open(id);
              }}
            >
              {titles[id]}
            </Button>
          ))}
      </nav>
      <Split
        main="palette"
        size={232}
        label="Palette width"
        zoomed={zoomed === "palette" ? "palette" : zoomed ? "work" : null}
      >
        <Pane {...controls("palette")}>{palette}</Pane>
        <Work
          participating={participates("canvas") || participates("node")}
          minimumWidth={
            participates("canvas") && participates("node") ? 568 : 280
          }
        >
          <Split
            main="canvas"
            size="remaining"
            label="Canvas width"
            zoomed={zoomed === "palette" ? null : zoomed}
          >
            <Pane {...controls("canvas")}>{canvas}</Pane>
            <Pane {...controls("node")}>{inspector}</Pane>
          </Split>
        </Work>
      </Split>
    </div>
  );
}

function Split({
  main,
  size,
  label,
  zoomed,
  children,
}: {
  main: string;
  size: number | "remaining";
  label: string;
  zoomed: string | null;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setBounds({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <div ref={ref} className="wf-split">
      <MaosaicoRoot
        bounds={bounds}
        tiling={{
          mainSize:
            size === "remaining" ? Math.max(320, bounds.width - 312) : size,
          gap: 8,
        }}
      >
        {children}
        <Divider main={main} label={label} zoomed={zoomed} />
      </MaosaicoRoot>
    </div>
  );
}

function Divider({
  main,
  label,
  zoomed,
}: {
  main: string;
  label: string;
  zoomed: string | null;
}) {
  const layout = useMaosaicoLayout();
  useEffect(() => {
    layout.zoom(zoomed);
  }, [layout.zoom, zoomed]);
  const first = layout.order[0];
  const hasMain = layout.order.includes(main);
  useEffect(() => {
    // Rejoining a tile appends it; this editor keeps palette–canvas–inspector order.
    if (hasMain && first && first !== main) layout.swap(main, first);
  }, [first, hasMain, main, layout.swap]);
  const divider = layout.divider;
  return divider ? (
    <ResizeHandle
      {...divider.props}
      className="wf-divider"
      aria-label={label}
      orientation="vertical"
      value={divider.position}
      min={divider.min}
      max={divider.max}
      onValueChange={layout.resizeMain}
      style={{
        left: divider.position,
        width: 8,
        height: "100%",
        ...layout.stackingStyle,
      }}
    />
  ) : null;
}

function Work({
  participating,
  minimumWidth,
  children,
}: {
  participating: boolean;
  minimumWidth: number;
  children: ReactNode;
}) {
  const binding = useMaosaicoItem(
    {
      id: "work",
      frame: { x: 0, y: 0, width: 800, height: 600 },
      minima: { width: minimumWidth, height: 160 },
    },
    { participating },
  );
  return (
    <div
      hidden={!binding.visible}
      className="wf-tile-group"
      style={{
        left: binding.frame.x,
        top: binding.frame.y,
        width: binding.frame.width,
        height: binding.frame.height,
      }}
    >
      {children}
    </div>
  );
}

function Pane({
  id,
  title,
  participating,
  zoomed,
  onZoom,
  onCollapse,
  children,
}: {
  id: PaneId;
  title: string;
  participating: boolean;
  zoomed: boolean;
  onZoom: () => void;
  onCollapse: () => void;
  children: ReactNode;
}) {
  const binding = useMaosaicoItem(
    {
      id,
      frame: { x: 0, y: 0, width: 320, height: 600 },
      minima: { width: id === "palette" ? 200 : 280, height: 160 },
    },
    { participating },
  );
  return (
    <WindowFrame
      className="wf-tile"
      data-tile={id}
      hidden={!binding.visible}
      aria-label={title}
      active={binding.active}
      onFocusCapture={binding.focus}
      onPointerDownCapture={binding.focus}
      style={{
        left: binding.frame.x,
        top: binding.frame.y,
        width: binding.frame.width,
        height: binding.frame.height,
        ...binding.stackingStyle,
      }}
    >
      <WindowHeader
        title={title}
        density="compact"
        actions={
          <>
            <IconButton
              aria-label={`Collapse ${titles[id]}`}
              icon={<Minus />}
              onClick={onCollapse}
            />
            <WindowActions
              title={titles[id]}
              maximized={zoomed}
              onToggleMaximize={onZoom}
            />
          </>
        }
      />
      <WindowBody className="wf-tile-body">{children}</WindowBody>
    </WindowFrame>
  );
}
