import * as z from "zod";
import { catalogInputSchema } from "@fungi.computer/workflows-wire";
import { workflowClient } from "../src/workflow-client.js";
import type { Draft } from "../src/editor/draft-store.js";
import { redesignCatalog, weeklyCover } from "./redesign-fixtures.js";

/**
 * A fake workflow service behind the real client, for the Triggers proof:
 * "Weekly cover image" is published as v3 and the story drives publish and
 * the On switch through the real tab, the real trigger control and the real
 * draft store. UI proof only: nothing runs and nothing is stored.
 */
const workflowId = "weekly-cover";
const commitOf = (version: number) => String(version).repeat(40);
const scheduledAt = { from: { node: "$input", port: "scheduledAt" } };

type Trigger = NonNullable<Draft["definition"]["triggers"]>[number];
const monday = (
  title: string,
  expression: string,
): Extract<Trigger, { on: "schedule" }> => ({
  id: "monday",
  on: "schedule",
  title,
  cron: { expression, timeZone: "Europe/London" },
  input: { scheduledAt },
});
const midweek: Trigger = {
  id: "midweek",
  on: "schedule",
  title: "Midweek touch-up",
  cron: { expression: "0 9 * * 3", timeZone: "Europe/London" },
  input: { scheduledAt },
};
const withTriggers = (triggers: readonly Trigger[]): Draft => ({
  ...weeklyCover,
  definition: { ...weeklyCover.definition, triggers: [...triggers] },
});

export type SwitchWorld = Readonly<{
  /** The draft changed a trigger that the latest published version does not have. */
  draftAhead?: boolean;
  /** Two schedules are published; the second one cannot be turned on. */
  refuseMidweek?: boolean;
}>;

export function switchClient(world: SwitchWorld) {
  const publishedTriggers = world.refuseMidweek
    ? [monday("Monday cover", "0 9 * * 1"), midweek]
    : [monday("Monday cover", "0 9 * * 1")];
  let published = [{ version: 3, draft: withTriggers(publishedTriggers) }];
  let draft = world.draftAhead
    ? withTriggers([monday("Weekday cover", "0 9 * * 1-5")])
    : withTriggers(publishedTriggers);
  let revision = 7;
  let registrations: {
    scheduleId: string;
    triggerId: string;
    cron: { expression: string; timeZone: string };
  }[] = [];
  const version = (item: (typeof published)[number]) => ({
    version: item.version,
    commit: commitOf(item.version),
    message: `Published v${String(item.version)}`,
    committedAt: 1_794_000_000,
  });
  const installation = (appId: string) => `fixture-${appId}`;
  const reply = (method: string, text: string) => {
    const input: unknown = JSON.parse(text);
    switch (method) {
      case "listWorkflows":
        return Promise.resolve({
          items: [
            {
              workflowId,
              title: draft.definition.title,
              draftRevision: revision,
              published: {
                commit: commitOf(published[0].version),
                version: published[0].version,
              },
            },
          ],
        });
      case "listRuns":
      case "listChats":
        return Promise.resolve(method === "listChats" ? { chats: [] } : []);
      case "viewerId":
        return Promise.resolve({ error: "not_granted" });
      case "listVersions":
        return Promise.resolve(published.map(version));
      case "loadWorkflow": {
        const { at } = z
          .object({
            at: z.union([z.literal("draft"), z.object({ commit: z.string() })]),
          })
          .parse(input);
        if (at === "draft")
          return Promise.resolve(z.json().parse({ ...draft, revision }));
        const found = published.find(
          (item) => commitOf(item.version) === at.commit,
        );
        return Promise.resolve(
          found ? z.json().parse({ ...found.draft, commit: at.commit }) : null,
        );
      }
      case "saveDraft": {
        const saved = z
          .object({ draft: z.json(), expectedRevision: z.number() })
          .parse(input);
        if (saved.expectedRevision !== revision)
          return Promise.resolve({
            kind: "conflict",
            current: z.json().parse({ ...draft, revision }),
          });
        revision++;
        draft = z.custom<Draft>().parse(saved.draft);
        return Promise.resolve({ kind: "saved", revision });
      }
      case "publishWorkflow": {
        const next = published[0].version + 1;
        published = [{ version: next, draft }, ...published];
        return Promise.resolve({
          kind: "published",
          version: next,
          commit: commitOf(next),
        });
      }
      case "catalog": {
        const { installationId } = catalogInputSchema.parse(input);
        if (installationId === undefined)
          return Promise.resolve(
            z.json().parse({
              apps: Object.entries(redesignCatalog).map(([appId, app]) => ({
                installationId: installation(appId),
                appId,
                displayName: appId,
                methods: Object.fromEntries(
                  Object.entries(app.methods).map(([name, method]) => [
                    name,
                    {
                      description: method.description,
                      effect: method.effect,
                      approval: method.approval,
                      requires: method.requires,
                      digest: method.digest,
                    },
                  ]),
                ),
              })),
            }),
          );
        const appId = Object.keys(redesignCatalog).find(
          (candidate) => installation(candidate) === installationId,
        );
        const app = appId === undefined ? undefined : redesignCatalog[appId];
        return Promise.resolve(
          appId === undefined || app === undefined
            ? { error: "not_found" }
            : z.json().parse({
                app: { installationId, appId, displayName: appId, ...app },
              }),
        );
      }
      case "listTriggers":
        return Promise.resolve({
          schedules: registrations.map((row) => ({
            scheduleId: row.scheduleId,
            installationId: "trellis-installation",
            workflowId,
            triggerId: row.triggerId,
            cron: row.cron,
            nextDueAt: Date.now() + 86_400_000,
            state: "active",
            lastError: null,
          })),
          nextCursor: null,
        });
      case "eventTriggers":
        return Promise.resolve({ eventTriggers: [] });
      case "arm": {
        const { triggerId, commit } = z
          .object({ triggerId: z.string(), commit: z.string() })
          .parse(input);
        if (world.refuseMidweek && triggerId === "midweek")
          return Promise.resolve({
            kind: "refused",
            reason: "Prints has no installation to run it with.",
          });
        const trigger = published
          .find((item) => commitOf(item.version) === commit)
          ?.draft.definition.triggers?.find((item) => item.id === triggerId);
        if (trigger?.on !== "schedule")
          return Promise.resolve({
            kind: "refused",
            reason: "Not a schedule.",
          });
        registrations = [
          ...registrations.filter((row) => row.triggerId !== triggerId),
          {
            scheduleId: `registration-${triggerId}`,
            triggerId,
            cron: trigger.cron,
          },
        ];
        return Promise.resolve({
          kind: "armed",
          scheduleId: `registration-${triggerId}`,
        });
      }
      case "disarm": {
        const { scheduleId } = z
          .object({ scheduleId: z.string() })
          .parse(input);
        registrations = registrations.filter(
          (row) => row.scheduleId !== scheduleId,
        );
        return Promise.resolve({ kind: "disarmed" });
      }
      default:
        return Promise.reject(new Error(`Unexpected fixture method ${method}`));
    }
  };
  return {
    client: workflowClient({
      call: (method, text) =>
        reply(method, text).then((value) => z.json().parse(value)),
    }),
    workflowId,
  };
}
