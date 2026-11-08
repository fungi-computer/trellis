import { useState } from "react";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { FailureLine } from "@fungi.computer/caps/components/failure-line";
import {
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
  return (
    <main className="wf-page">
      <EmptyState
        variant="panel"
        title="Make your first workflow"
        description="Chain your Apps into steps that run on a schedule, a push or a click."
        primaryAction={{
          label: "Start blank",
          onSelect: onBlank,
          pending: creating,
          disabled: busy,
        }}
        suggestions={starterTemplates.map((template) => ({
          label: template.definition.title,
          disabled: busy || creating,
          onSelect: () => {
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
          },
        }))}
      />
      {failure === null ? null : <FailureLine message={failure} />}
    </main>
  );
}
