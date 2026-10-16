import * as S from "effect/Schema";
import { catalogSchema, type Catalog } from "@fungi.computer/braid";
import type { WorkflowMethodContext } from "./methods.js";
import { catalogReplySchema } from "@fungi.computer/workflows-wire";
export { catalogReplySchema } from "@fungi.computer/workflows-wire";

/** The unique App ids a definition's node bindings actually name. */
export function definitionAppIds(definition: {
  readonly apps: Readonly<Record<string, { readonly appId: string }>>;
}): string[] {
  return [...new Set(Object.values(definition.apps).map((app) => app.appId))];
}

/**
 * The host selects member or lifecycle authority; the App never invents
 * grants. Reads the palette index once to resolve installations, then reads
 * each named App's full ports only -- never the whole installed set -- so a
 * large installed-App count never grows this reply with ports no caller asked
 * for.
 */
export async function readWorkflowCatalog(
  workflows: WorkflowMethodContext["env"]["WORKFLOWS"],
  appIds: readonly string[],
): Promise<Catalog | null> {
  const needed = new Set(appIds);
  // No App is named: skip the read entirely, not just the port detail --
  // never requiring the WORKFLOWS binding just to save an App-free draft.
  if (needed.size === 0) return {};
  if (!workflows) return null;
  const index = catalogReplySchema.parse(await workflows.catalog({}));
  if (!("apps" in index)) return null;
  const matches = index.apps.filter((app) => needed.has(app.appId));
  const entries = await Promise.all(
    matches.map(async (match) => {
      const full = catalogReplySchema.parse(
        await workflows.catalog({ installationId: match.installationId }),
      );
      return "app" in full ? full.app : null;
    }),
  );
  return S.decodeUnknownSync(catalogSchema)(
    Object.fromEntries(
      entries.flatMap((app) =>
        app === null
          ? []
          : [
              [
                app.appId,
                app.events === undefined
                  ? { methods: app.methods }
                  : { methods: app.methods, events: app.events },
              ] as const,
            ],
      ),
    ),
    { onExcessProperty: "error" },
  );
}
