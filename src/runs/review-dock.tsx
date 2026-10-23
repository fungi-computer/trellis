import * as S from "effect/Schema";
import { fillReviewText, reviewAnswerSchema } from "@fungi.computer/braid";
import { Input } from "@fungi.computer/caps/components/input";
import { useState } from "react";
import { Button } from "@fungi.computer/caps/components/button";
import type { WorkflowClient } from "../workflow-client.js";
import { stepPosition, type Review } from "./run-state.js";
import { OutputPreview, type ReadMedia } from "./output-preview.js";
import { NodeStatus } from "./node-status.js";
/** The question a run is waiting on, docked where a composer sits. */
export function ReviewDock({
  runId,
  review,
  detail,
  choices,
  format,
  readMedia,
  answerReview,
  onAnswered,
}: {
  runId: string;
  review: Review;
  /** The review node's line about where the run is, before its placeholders are filled. */
  detail?: string | undefined;
  choices?: readonly { id: string; label: string; description?: string }[];
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
  const position = stepPosition(review);
  const fill = (text: string | undefined) =>
    text === undefined ? undefined : fillReviewText(text, position);
  const where = fill(detail);
  const choiceFor = (id: string) => choices?.find((choice) => choice.id === id);
  const options = review.choices?.length
    ? review.choices.map((id) => ({
        id,
        label: choiceFor(id)?.label ?? id,
        description: fill(choiceFor(id)?.description),
        answer: (): typeof reviewAnswerSchema.Type =>
          note.length ? { choice: id, note } : { choice: id },
      }))
    : [
        {
          id: "approved",
          label: "Approve",
          description: undefined,
          answer: (): typeof reviewAnswerSchema.Type => ({ approved: true }),
        },
        {
          id: "rejected",
          label: "Reject",
          description: undefined,
          answer: (): typeof reviewAnswerSchema.Type => ({ approved: false }),
        },
      ];
  return (
    <section className="wf-dock" aria-label="Review">
      {review.show.length > 0 ? (
        <div className="wf-dock-media">
          {review.show.map((value, index) => (
            <OutputPreview
              key={index}
              value={value}
              format={index === 0 ? format : undefined}
              readMedia={readMedia}
            />
          ))}
        </div>
      ) : null}
      <div className="wf-dock-body">
        <div className="wf-dock-waiting">
          <NodeStatus state="waiting" label="Waiting on you" />
        </div>
        <h3>{review.title}</h3>
        {where === undefined ? null : (
          <p className="wf-dock-where wf-muted">{where}</p>
        )}
        <ul className="wf-dock-choices">
          {options.map((option, index) => (
            <li key={option.id}>
              <Button
                className="wf-dock-key"
                variant={index === 0 ? "primary" : "outline"}
                disabled={sending}
                onClick={() => {
                  void answer(option.answer());
                }}
              >
                {option.label}
              </Button>
              {option.description === undefined ? null : (
                <span className="wf-muted">{option.description}</span>
              )}
            </li>
          ))}
        </ul>
        {review.choices?.length ? (
          <Input
            className="wf-dock-note"
            aria-label="Note"
            placeholder="Add a note (optional)"
            value={note}
            disabled={sending}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        ) : null}
        {error ? <p role="alert">{error.message}</p> : null}
      </div>
    </section>
  );
}
