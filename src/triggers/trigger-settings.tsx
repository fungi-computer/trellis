import { useEffect, useRef, useState } from "react";
import * as z from "zod";
import { Button } from "@fungi.computer/caps/components/button";
import { LoadingState } from "@fungi.computer/caps/blocks/loading-state";
import { canonicalJson, validate } from "@fungi.computer/braid";
import { TriggerFields } from "../editor/trigger-fields.js";
import {
  publicationFailureCopy,
  type DraftStore,
} from "../editor/draft-store.js";
import { useDraft } from "../editor/use-draft.js";
import type { Triggers } from "./workflow-switch.js";

const same = (left: Triggers, right: Triggers) =>
  canonicalJson(z.json().parse(left)) === canonicalJson(z.json().parse(right));

/**
 * Add and change a workflow's triggers where they are switched on. It edits
 * the same draft the canvas edits, through the same store, and never arms
 * anything: publishing, then the On switch, does that.
 */
export function TriggerSettings({
  store,
  published,
  onAhead,
  onChanged,
  onPublished,
}: {
  store: DraftStore;
  /** The latest published version's triggers; null when nothing is published. */
  published: Triggers | null;
  /** Whether the draft's triggers differ from the published ones. */
  onAhead: (ahead: boolean) => void;
  /** The saved draft changed, so the canvas must read it again. */
  onChanged: () => void;
  onPublished: () => void;
}) {
  const state = useDraft(store);
  const { draft, document } = state;
  const touched = useRef(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const triggers = draft?.definition.triggers ?? [];
  const ahead =
    published === null ? triggers.length > 0 : !same(triggers, published);
  const saved = draft !== null && document !== null && draft === document.draft;
  useEffect(() => {
    onAhead(ahead);
  }, [ahead, onAhead]);
  useEffect(() => {
    if (touched.current && saved) {
      touched.current = false;
      changed.current();
    }
  }, [saved]);
  useEffect(
    () => () => {
      onAhead(false);
      // The canvas must read what this tab changed, saved or not yet.
      if (touched.current) changed.current();
    },
    [onAhead],
  );
  if (!draft || !document)
    return state.error ? (
      <p role="alert">The draft triggers could not be loaded.</p>
    ) : (
      <LoadingState message="Loading the draft's triggers…" />
    );
  const next = (state.versions.at(0)?.version ?? 0) + 1;
  const problems = validate(draft.definition, document.catalog).length;
  const blocked =
    publishing ||
    !saved ||
    state.saving ||
    state.conflict ||
    state.error !== null ||
    state.catalogLoading ||
    state.catalogError !== null ||
    problems > 0;
  function publish() {
    if (!store.publish || !document) return;
    setPublishing(true);
    setPublishError(null);
    store
      .publish(document.revision)
      .then(
        (version) => {
          state.confirmPublication(version, document.draft);
          state.refreshHistory();
          onPublished();
        },
        (cause: unknown) => {
          setPublishError(
            publicationFailureCopy(cause) ??
              "Couldn't publish: the service couldn't complete this request.",
          );
        },
      )
      .finally(() => {
        setPublishing(false);
      });
  }
  return (
    <section
      aria-label="Add or change triggers"
      className="flex flex-col gap-sm"
      data-trigger-settings
    >
      <TriggerFields
        definition={draft.definition}
        catalog={document.catalog}
        appDisplay={document.appDisplay}
        onChange={(definition) => {
          touched.current = true;
          state.setDraft({ ...draft, definition });
        }}
      />
      {ahead ? (
        <p role="status" className="text-sm text-(--stipe-fg-muted)">
          {published === null
            ? "This workflow is not published yet."
            : "Your trigger changes are not published yet."}{" "}
          Publish as v{String(next)}, then switch it on.
        </p>
      ) : null}
      {ahead && store.publish ? (
        <Button
          variant="primary"
          className="self-start"
          disabled={blocked}
          loading={publishing}
          onClick={publish}
        >
          Publish as v{String(next)}
        </Button>
      ) : null}
      {publishError ? (
        <p role="alert" className="text-sm">
          {publishError}
        </p>
      ) : null}
    </section>
  );
}
