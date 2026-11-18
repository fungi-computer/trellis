import {
  NodeResizer,
  type Node as FlowNode,
  type NodeProps,
} from "@xyflow/react";
import { Button } from "@fungi.computer/caps/components/button";
import { useEffect, useRef } from "react";
import { frameTones, type Frames } from "@fungi.computer/workflows-wire";

/** One comment frame behind a group of steps. */
export type Frame = Frames[number];
export type FrameTone = Frame["tone"];
/** A step's or frame's place and size, in flow units. */
export type FrameBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** The wire's own limit; one more is refused rather than silently dropped. */
export const maxFrames = 32;
const margin = 32;
/** Room above the steps for the label. */
const labelRoom = 40;
const emptyFrame = { width: 320, height: 200 } as const;

const idOf = (frames: readonly Frame[]) => {
  let index = 1;
  while (frames.some((frame) => frame.id === `frame${String(index)}`))
    index += 1;
  return `frame${String(index)}`;
};

/**
 * A new frame of `graph` around `boxes` (the selected steps), or, with none
 * selected, a blank one centred on `at`. Undefined once the draft holds the
 * most frames the wire carries.
 */
export function frameAround(
  frames: readonly Frame[],
  graph: string,
  boxes: readonly FrameBox[],
  at: { x: number; y: number },
): Frame | undefined {
  if (frames.length >= maxFrames) return undefined;
  const base = { id: idOf(frames), graph, label: "", tone: "teal" } as const;
  if (!boxes.length)
    return {
      ...base,
      x: at.x - emptyFrame.width / 2,
      y: at.y - emptyFrame.height / 2,
      ...emptyFrame,
    };
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return {
    ...base,
    x: left - margin,
    y: top - margin - labelRoom,
    width: right - left + margin * 2,
    height: bottom - top + margin * 2 + labelRoom,
  };
}

/** The frames with `id` changed; the id and graph of a frame never change. */
export function updateFrame(
  frames: readonly Frame[],
  id: string,
  patch: Partial<Omit<Frame, "id" | "graph">>,
): Frame[] {
  return frames.map((frame) =>
    frame.id === id ? { ...frame, ...patch } : frame,
  );
}

export function removeFrame(frames: readonly Frame[], id: string): Frame[] {
  return frames.filter((frame) => frame.id !== id);
}

/** The steps whose centre lies in the frame: they travel with it when it is dragged. */
export function framedSteps(
  frame: FrameBox,
  steps: Readonly<Record<string, FrameBox>>,
): string[] {
  return Object.entries(steps).flatMap(([id, box]) => {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    return x >= frame.x &&
      x <= frame.x + frame.width &&
      y >= frame.y &&
      y <= frame.y + frame.height
      ? [id]
      : [];
  });
}

/** The id a frame has on the canvas, kept apart from every step's id. */
export const frameNodeId = (id: string) => `frame:${id}`;
export const frameIdOf = (nodeId: string) =>
  nodeId.startsWith("frame:") ? nodeId.slice("frame:".length) : undefined;

export type FrameData = {
  label: string;
  tone: FrameTone;
  /** Absent when the canvas is read-only. */
  edit?: {
    focus: boolean;
    onLabel: (label: string) => void;
    onTone: (tone: FrameTone) => void;
    onRemove: () => void;
  };
};
export type FrameCardNode = FlowNode<FrameData, "frame">;

export function FrameCard({ data, selected }: NodeProps<FrameCardNode>) {
  const input = useRef<HTMLInputElement>(null);
  const { edit } = data;
  const focus = edit?.focus ?? false;
  useEffect(() => {
    if (focus) input.current?.focus();
  }, [focus]);
  return (
    <div className="wf-frame" data-tone={data.tone}>
      {edit ? (
        <>
          <NodeResizer
            isVisible={selected}
            minWidth={120}
            minHeight={80}
            lineClassName="wf-frame-edge"
            handleClassName="wf-frame-handle"
          />
          <input
            ref={input}
            className="wf-frame-label nodrag"
            aria-label="Frame label"
            placeholder="Name this group"
            maxLength={60}
            value={data.label}
            onChange={(event) => {
              edit.onLabel(event.target.value);
            }}
          />
          {selected ? (
            <div
              className="wf-frame-tools nodrag"
              role="toolbar"
              aria-label="Frame"
            >
              {frameTones.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  className="wf-frame-tone"
                  data-tone={tone}
                  aria-label={`Colour ${tone}`}
                  aria-pressed={tone === data.tone}
                  onClick={() => {
                    edit.onTone(tone);
                  }}
                />
              ))}
              <Button size="xs" variant="ghost" onClick={edit.onRemove}>
                Delete frame
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <span className="wf-frame-label">{data.label}</span>
      )}
    </div>
  );
}
