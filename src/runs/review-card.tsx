import * as S from "effect/Schema";
import { reviewAnswerSchema } from "@fungi.computer/braid";
import { Field } from "@fungi.computer/caps/components/field";
import { Textarea } from "@fungi.computer/caps/components/textarea";
import { useState } from "react";
import { Button } from "@fungi.computer/caps/components/button";
import { Surface } from "@fungi.computer/caps/components/surface";
import type { WorkflowClient } from "../workflow-client.js";
import type { Review } from "./run-state.js";
import { OutputPreview } from "./output-preview.js";
export type ReadMedia = (path: string, signal: AbortSignal) => Promise<Blob>;
export function ReviewCard({
  runId,
  review,
  choices,
  format,
  readMedia,
  answerReview,
  onAnswered,
}: {
  runId: string;
  review: Review;
  choices?: readonly { id: string; label: string }[];
  format?: string;
  readMedia?: ReadMedia;
  answerReview: WorkflowClient["answerReview"];
  onAnswered: () => void;
}) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function answer(answer: typeof reviewAnswerSchema.Type) {
    const decoded = S.decodeUnknownOption(reviewAnswerSchema)(answer, {
      onExcessProperty: "error",
    });
    if (decoded._tag === "None") {
      setError(
        new Error(
          "The review answer is invalid. Shorten your note and try again.",
        ),
      );
      return;
    }
    setSending(true);
    setError(null);
    try {
      const result = await answerReview({
        runId,
        nodeId: review.nodeId,
        iteration: review.iteration,
        answer: decoded.value,
      });
      if (result === "accepted") onAnswered();
      else setError(new Error(result));
    } catch (cause) {
      setError(new Error("Could not send your answer. Try again.", { cause }));
    } finally {
      setSending(false);
    }
  }
  return (
    <Surface
      placement="embedded"
      size="sm"
      className="wf-review"
      aria-label="Review"
    >
      <h3>{review.title}</h3>
      {review.show.map((value, index) => (
        <OutputPreview
          key={index}
          value={value}
          format={index === 0 ? format : undefined}
          readMedia={readMedia}
        />
      ))}
      {review.choices?.length ? (
        <Field label="Note" optional>
          <Textarea
            value={note}
            disabled={sending}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </Field>
      ) : null}
      <div className="wf-actions">
        {review.choices?.length ? (
          review.choices.map((id) => (
            <Button
              key={id}
              variant="outline"
              disabled={sending}
              onClick={() => {
                let response: typeof reviewAnswerSchema.Type = { choice: id };
                if (note.length) response = { choice: id, note };
                void answer(response);
              }}
            >
              {choices?.find((choice) => choice.id === id)?.label ?? id}
            </Button>
          ))
        ) : (
          <>
            <Button
              disabled={sending}
              onClick={() => void answer({ approved: true })}
            >
              Approve
            </Button>
            <Button
              variant="outline"
              disabled={sending}
              onClick={() => void answer({ approved: false })}
            >
              Reject
            </Button>
          </>
        )}
      </div>
      {error ? <p role="alert">{error.message}</p> : null}
    </Surface>
  );
}
