import * as z from "zod";
import { useEffect, useState } from "react";
import type { Json } from "@fungi.computer/braid";
import type { ReadMedia } from "./review-dock.js";
import type { RunStep } from "./run-state.js";
import { versionRelativeTime } from "../history/relative-time.js";

const mediaSchema = z.object({
  destination: z.object({ path: z.string().startsWith("/").min(2).max(4096) }),
  format: z.enum(["png", "jpeg", "gif", "webp", "mp4"]),
});
const messageSchema = z.object({ message: z.string() });

/** Read one Computer file through the admitted reader into an object URL while mounted. */
function useMediaPreview(path: string | undefined, readMedia?: ReadMedia) {
  const [preview, setPreview] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setPreview(null);
    setFailed(false);
    if (!path || !readMedia) return;
    const controller = new AbortController();
    let url: string | undefined;
    void readMedia(path, controller.signal).then(
      (blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, readMedia]);
  return { preview, failed };
}

/** A small still of what a step made, for the leading edge of its timeline row. */
export function MediaThumb({
  media,
  readMedia,
}: {
  media: Readonly<{ path: string; format: "fungi:image" | "fungi:video" }>;
  readMedia?: ReadMedia;
}) {
  const { preview } = useMediaPreview(media.path, readMedia);
  return (
    <span className="wf-thumb" aria-hidden="true">
      {preview === null ? null : media.format === "fungi:video" ? (
        <video src={preview} muted preload="metadata" />
      ) : (
        <img src={preview} alt="" />
      )}
    </span>
  );
}

/** Only the existing admitted Computer reader resolves media; result strings are never URLs. */
export function OutputPreview({
  value,
  format,
  readMedia,
}: {
  value: Json;
  format?: string;
  readMedia?: ReadMedia;
}) {
  const media = mediaSchema.safeParse(value);
  const text = z.string().safeParse(value);
  const path = media.success
    ? media.data.destination.path
    : text.success && ["fungi:image", "fungi:video"].includes(format ?? "")
      ? text.data
      : undefined;
  const video = media.success
    ? media.data.format === "mp4"
    : format === "fungi:video";
  const { preview, failed } = useMediaPreview(path, readMedia);
  return (
    <div className="wf-output-preview">
      {preview ? (
        video ? (
          <video src={preview} controls aria-label="Step video output" />
        ) : (
          <img src={preview} alt="Step image output" />
        )
      ) : (
        <pre>{text.success ? text.data : JSON.stringify(value, null, 2)}</pre>
      )}
      {path && !preview ? (
        <p className="wf-muted">
          {failed || !readMedia ? "Preview unavailable." : "Loading preview…"}
        </p>
      ) : null}
    </div>
  );
}
export function OutputError({ error }: { error: Json }) {
  const message = messageSchema.safeParse(error);
  const text = z.string().safeParse(error);
  return (
    <p role="alert">
      {message.success
        ? message.data.message
        : text.success
          ? text.data
          : JSON.stringify(error, null, 2)}
    </p>
  );
}

/** Shared result presentation for graph cards and the step list. */
export function StepOutput({
  step,
  formats,
  readMedia,
}: {
  step: RunStep;
  formats?: Readonly<Record<string, string | undefined>>;
  readMedia?: ReadMedia;
}) {
  const review = "reviewOutput" in step ? step.reviewOutput : undefined;
  const recordedAt =
    review && "recordedAt" in review ? review.recordedAt : undefined;
  const decision =
    review?.choice === "approved"
      ? "Approved"
      : review?.choice === "rejected"
        ? "Rejected"
        : review?.choice;
  return (
    <div className="wf-step-output">
      {review ? (
        <div>
          <strong>
            {decision}
            {review.note ? `: ${review.note}` : ""}
          </strong>
          {recordedAt !== undefined ? (
            <>
              {" · "}
              <time dateTime={new Date(recordedAt).toISOString()}>
                {versionRelativeTime(new Date(recordedAt).toISOString())}
              </time>
            </>
          ) : null}
          <OutputPreview
            value={review.value}
            format={formats?.[review.choice]}
            readMedia={readMedia}
          />
        </div>
      ) : null}
      {step.output !== undefined && review === undefined
        ? Object.entries(step.output).map(([port, value]) => (
            <div key={port}>
              <strong>{port}</strong>
              <OutputPreview
                value={value}
                format={formats?.[port]}
                readMedia={readMedia}
              />
            </div>
          ))
        : null}
      {step.state === "failed" ? (
        <OutputError
          error={step.errorMessage ?? step.refusal ?? "This step failed."}
        />
      ) : null}
      {step.state === "complete" && step.output === undefined ? (
        <p className="wf-muted">No output was recorded for this step.</p>
      ) : null}
    </div>
  );
}
