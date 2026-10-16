import { useState } from "react";
import * as S from "effect/Schema";
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
export function Templates({
  client,
  onUse,
}: {
  client: WorkflowClient;
  onUse: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function useTemplate(template: (typeof templates)[number]) {
    setBusy(true);
    setError(null);
    try {
      const definition = Object.keys(template.definition.apps).length
        ? templateDefinition(
            template.definition,
            (await client.catalog(definitionAppIds(template.definition)))
              .catalog,
          )
        : template.definition;
      onUse(
        await client.createDraft(template.id, {
          definition,
          layout: template.layout,
        }),
      );
    } catch (cause) {
      setError(
        new Error(
          "Could not create the draft. Check the required Apps and try again.",
          { cause },
        ),
      );
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
                disabled={busy}
                onClick={() => void useTemplate(template)}
              >
                Use template
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {error ? <p role="alert">{error.message}</p> : null}
    </main>
  );
}
