import { useEffect, useState } from "react";
import * as S from "effect/Schema";
import * as z from "zod";
import { describeAppError } from "@fungi.computer/agar/errors";
import { workflowDefinitionSchema } from "@fungi.computer/braid";
import { Button } from "@fungi.computer/caps/components/button";
import { Card, CardContent } from "@fungi.computer/caps/components/card";
import { Monogram } from "@fungi.computer/caps/components/monogram";
import { Sigil } from "@fungi.computer/sigils";
import { appMarks } from "./app-marks.js";
import review from "../../templates/review.json";
import storyboard from "../../templates/storyboard.json";
import storyboardSave from "../../templates/storyboard-save.json";
import bonsaiChecks from "../../templates/bonsai-checks.json";
import bonsaiBuildOnMerge from "../../templates/bonsai-build-on-merge.json";
import { templateDefinition } from "./template-draft.js";
import { MiniCanvas } from "./mini-canvas.js";
import { definitionAppIds } from "../../backend/catalog.js";
import type { WorkflowClient } from "../workflow-client.js";
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
type BundledTemplate = (typeof templates)[number];

const capabilityDenied = z.object({ code: z.literal("CAPABILITY_DENIED") });

/** Why a template could not become a draft, in the words of its real cause. */
function templateFailure(cause: unknown): string {
  if (capabilityDenied.safeParse(cause).success)
    return "Trellis needs Git access to save this workflow. Approve it first.";
  // template-draft names the missing App in its own sentence.
  if (cause instanceof Error && cause.message.startsWith("Install the App"))
    return cause.message;
  return `Couldn’t create this workflow: ${describeAppError(cause).message}`;
}

/** Turn one bundled template into a draft against the Apps installed now. */
async function createFromTemplate(
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
  onFail,
  blockedReason,
}: {
  client: WorkflowClient;
  onUse: (id: string) => void;
  /** Tell the person why a template could not be used: one toast. */
  onFail: (message: string) => void;
  /** Why no template can be used yet, such as a missing Git grant. */
  blockedReason?: string | undefined;
}) {
  const [busy, setBusy] = useState(false);
  // The installed Apps decide which templates are offered; until the answer
  // arrives, or if it cannot be read, every template shows and Use says why not.
  const [installed, setInstalled] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    let active = true;
    client.catalog().then(
      ({ apps }) => {
        if (active) setInstalled(new Set(apps.map((app) => app.appId)));
      },
      (cause: unknown) => {
        console.error("The installed Apps could not be read", cause);
      },
    );
    return () => {
      active = false;
    };
  }, [client]);
  const offered = templates.filter(
    (template) =>
      installed === null ||
      Object.values(template.definition.apps).every((app) =>
        installed.has(app.appId),
      ),
  );
  const hidden = templates.length - offered.length;
  async function useTemplate(template: BundledTemplate) {
    setBusy(true);
    await createFromTemplate(client, template)
      .then(onUse, (cause: unknown) => {
        onFail(templateFailure(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  }
  return (
    <main className="wf-page">
      <h1>Start from a template</h1>
      <p className="wf-muted">
        Each one opens on the canvas as a draft. Nothing runs until you switch
        it on.
      </p>
      <div className="wf-templates">
        {offered.map((template) => (
          <Card key={template.id}>
            <CardContent className="wf-template-card">
              <MiniCanvas
                graph={template.definition}
                layout={template.layout}
                label={`${template.definition.title} as a canvas`}
              />
              <h2>{template.definition.title}</h2>
              <p
                className="wf-template-description"
                title={template.definition.description}
              >
                {template.definition.description}
              </p>
              <div className="wf-actions">
                {Object.entries(template.definition.apps).map(
                  ([alias, app]) => {
                    const details = appMarks.get(app.appId);
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
            </CardContent>
          </Card>
        ))}
      </div>
      {hidden > 0 ? (
        <p className="wf-muted">
          {hidden === 1
            ? "1 more template needs an App this Team has not installed."
            : `${String(hidden)} more templates need Apps this Team has not installed.`}
        </p>
      ) : null}
    </main>
  );
}
