import { useState } from "react";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { FailureLine } from "@fungi.computer/caps/components/failure-line";
import {
  type BundledTemplate,
  createFromTemplate,
  starterTemplates,
  templateFailure,
} from "./templates/templates.js";
import type { WorkflowClient } from "./workflow-client.js";

/** The first view of a Team with no workflows: what Trellis is for and one click to a draft. */
export function Welcome({
  client,
  onUse,
  onBlank,
  creating,
}: {
  client: WorkflowClient;
  onUse: (id: string) => void;
  onBlank: () => void;
  creating: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [first, ...others] = starterTemplates;
  const use = (template: BundledTemplate) => {
    setBusy(true);
    setFailure(null);
    createFromTemplate(client, template).then(
      (id) => {
        setBusy(false);
        onUse(id);
      },
      (cause: unknown) => {
        setBusy(false);
        setFailure(templateFailure(cause));
      },
    );
  };
  return (
    <section className="wf-page wf-invitation" aria-label="Start a workflow">
      <EmptyState
        title="Make your first workflow"
        visual="blobs"
        description="Chain your Apps into steps that run on a schedule, a push or a click. Try a ready-made example first; it needs no setup."
        primaryAction={{
          label: `Try “${first.definition.title}”`,
          onSelect: () => {
            use(first);
          },
          pending: busy,
          disabled: creating,
        }}
        suggestions={[
          {
            label: "Start blank",
            onSelect: onBlank,
            pending: creating,
            disabled: busy,
          },
          ...others.map((template) => ({
            label: template.definition.title,
            disabled: busy || creating,
            onSelect: () => {
              use(template);
            },
          })),
        ]}
      />
      {failure === null ? null : (
        <FailureLine
          message={failure}
          onDismiss={() => {
            setFailure(null);
          }}
        />
      )}
    </section>
  );
}
