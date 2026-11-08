import { useState } from "react";
import * as S from "effect/Schema";
import * as z from "zod";
import { describeAppError } from "@fungi.computer/agar/errors";
import { FailureLine } from "@fungi.computer/caps/components/failure-line";
import { workflowDefinitionSchema } from "@fungi.computer/braid";
import { Button } from "@fungi.computer/caps/components/button";
import { Card, CardContent } from "@fungi.computer/caps/components/card";
import { Monogram } from "@fungi.computer/caps/components/monogram";
import { Sigil, type SigilName } from "@fungi.computer/sigils";
import review from "../../templates/review.json";
import storyboard from "../../templates/storyboard.json";
import storyboardSave from "../../templates/storyboard-save.json";
import bonsaiChecks from "../../templates/bonsai-checks.json";
import bonsaiBuildOnMerge from "../../templates/bonsai-build-on-merge.json";
import { templateDefinition } from "./template-draft.js";
import { definitionAppIds } from "../../backend/catalog.js";
import type { WorkflowClient } from "../workflow-client.js";
// Presentation for the Apps required by these bundled templates, independent
// of whether the current Team has installed or granted them yet.
const requiredApps = new Map<string, { name: string; icon: SigilName }>([
  ["app_prints", { name: "Prints", icon: "prints" }],
  ["app_bonsai", { name: "Bonsai", icon: "bonsai" }],
  ["app_shed", { name: "Shed", icon: "computer" }],
  ["app_inkcap", { name: "Inkcap", icon: "inkcap" }],
]);
const templates = [
  review,
  storyboard,
  storyboardSave,
  bonsaiChecks,
  bonsaiBuildOnMerge,
].map((item) => ({
  ...item,
  definition: S.decodeUnknownSync(workflowDefinitionSchema)(item.definition),
}));
export type BundledTemplate = (typeof templates)[number];

/** The three friendliest templates, offered one click away on the welcome. */
export const starterTemplates = ["review", "storyboard", "bonsai-checks"]
  .flatMap((id) => templates.filter((template) => template.id === id))
  .slice(0, 3);

const capabilityDenied = z.object({ code: z.literal("CAPABILITY_DENIED") });

/** Why a template could not become a draft, in the words of its real cause. */
export function templateFailure(cause: unknown): string {
  if (capabilityDenied.safeParse(cause).success)
    return "Trellis needs Git access to save this workflow. Approve it first.";
  // template-draft names the missing App in its own sentence.
  if (cause instanceof Error && cause.message.startsWith("Install the App"))
    return cause.message;
  return `Couldn’t create this workflow: ${describeAppError(cause).message}`;
}

/** Turn one bundled template into a draft against the Apps installed now. */
export async function createFromTemplate(
  client: WorkflowClient,
  template: BundledTemplate,
): Promise<string> {
  const definition = Object.keys(template.definition.apps).length
    ? templateDefinition(
        template.definition,
        (await client.catalog(definitionAppIds(template.definition))).catalog,
      )
    : template.definition;
  return client.createDraft(template.id, {
    definition,
    layout: template.layout,
  });
}

export function Templates({
  client,
  onUse,
  blockedReason,
}: {
  client: WorkflowClient;
  onUse: (id: string) => void;
  /** Why no template can be used yet, such as a missing Git grant. */
  blockedReason?: string | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ id: string; error: Error } | null>(
    null,
  );
  async function useTemplate(template: BundledTemplate) {
    setBusy(true);
    setFailure(null);
    try {
      onUse(await createFromTemplate(client, template));
    } catch (cause) {
      setFailure({
        id: template.id,
        error: new Error(templateFailure(cause), { cause }),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="wf-page">
      <div className="wf-templates">
        {templates.map((template) => (
          <Card key={template.id}>
            <CardContent className="flex flex-col gap-sm">
              <h2>{template.definition.title}</h2>
              <p>{template.definition.description}</p>
              <div className="wf-actions">
                {Object.entries(template.definition.apps).map(
                  ([alias, app]) => {
                    const details = requiredApps.get(app.appId);
                    return (
                      <span
                        key={app.appId}
                        className="inline-flex items-center gap-sm"
                      >
                        {details ? (
                          <Sigil name={details.icon} size={32} />
                        ) : (
                          <Monogram name={alias} subject="app" />
                        )}
                        {details?.name ?? alias}
                      </span>
                    );
                  },
                )}
              </div>
              {!Object.keys(template.definition.apps).length ? (
                <p className="wf-muted">No Apps required.</p>
              ) : null}
              <Button
                variant="outline"
                className="mt-auto self-start"
                disabled={busy || blockedReason !== undefined}
                onClick={() => void useTemplate(template)}
              >
                Use template
              </Button>
              {blockedReason !== undefined ? (
                <p className="wf-muted">{blockedReason}</p>
              ) : null}
              {failure?.id === template.id ? (
                <FailureLine message={failure.error.message} />
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
