import * as z from "zod";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkflowRunListItem } from "@fungi.computer/workflows-wire";
import { useRunSummaries } from "../runs/use-run-summaries.js";
import { createTriggerControl, type TriggerRow } from "../triggers/triggers.js";
import {
  switchOff,
  switchOn,
  failureWords,
} from "../triggers/workflow-switch.js";
import type { WorkflowClient } from "../workflow-client.js";
import {
  homeRow,
  latestRuns,
  type HomeRow,
  type PublishedFacts,
} from "./workflow-rows.js";

const READS_AT_ONCE = 4;
/** `[workflowId, commit]` of every published workflow, serialized as the effect's key. */
const pairs = z.array(z.tuple([z.string(), z.string()]));

/** What turning a workflow on or off from its row came to. */
export type SwitchOutcome =
  | Readonly<{ kind: "done" }>
  /** More than one installed App could serve it: the Triggers tab chooses. */
  | Readonly<{ kind: "needs-setup"; message: string }>
  | Readonly<{ kind: "failed"; message: string }>;

/**
 * Everything the Workflows table shows: each published definition's triggers,
 * which of them are armed, and the newest run of every workflow. The table
 * draws as soon as the library is known and fills the rest in as it arrives.
 */
export function useWorkflowRows(
  client: WorkflowClient,
  entries: readonly Extract<
    Awaited<ReturnType<WorkflowClient["listWorkflows"]>>,
    readonly unknown[]
  >[number][],
  refresh: number,
) {
  const [facts, setFacts] = useState<ReadonlyMap<string, PublishedFacts>>(
    new Map(),
  );
  const [registrations, setRegistrations] = useState<
    readonly {
      workflowId: string;
      row: TriggerRow;
    }[]
  >([]);
  const [runs, setRuns] = useState<readonly WorkflowRunListItem[]>([]);
  const [now, setNow] = useState(Date.now);
  const [reload, setReload] = useState(0);
  /** A read that failed names itself; the table keeps what it already knows. */
  const [failure, setFailure] = useState<string | null>(null);
  const latest = useMemo(() => [...latestRuns(runs).values()], [runs]);
  const { runs: statuses } = useRunSummaries(client, latest);
  // The published commit identifies a definition, so one is read once.
  const published = JSON.stringify(
    entries.flatMap((entry) =>
      entry.published ? [[entry.workflowId, entry.published.commit]] : [],
    ),
  );
  const any = entries.length > 0;
  useEffect(() => {
    if (!any) return;
    let active = true;
    setNow(Date.now());
    Promise.all([
      client.listTriggers({ limit: 100 }),
      client.eventTriggers(),
      client.listRuns(),
    ]).then(
      ([schedules, events, listed]) => {
        if (!active) return;
        if ("error" in schedules || "error" in events) {
          setFailure("Which workflows are on could not be read.");
        } else {
          setFailure(null);
          setRegistrations([
            ...schedules.schedules.map((row) => ({
              workflowId: row.workflowId,
              row: {
                triggerId: row.triggerId,
                state: row.state,
                lastError: row.lastError,
              },
            })),
            ...events.eventTriggers.map((row) => ({
              workflowId: row.workflowId,
              row: {
                triggerId: row.triggerId,
                state: row.state,
                lastError: row.lastError,
              },
            })),
          ]);
        }
        setRuns(listed);
      },
      (cause: unknown) => {
        console.error("The Workflows table could not read its runs", cause);
        if (active) setFailure("Which workflows are on could not be read.");
      },
    );
    return () => {
      active = false;
    };
  }, [client, refresh, reload, any]);
  useEffect(() => {
    let active = true;
    const queue = pairs.parse(JSON.parse(published));
    const read = async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        const [workflowId, commit] = item;
        const doc = await client.loadWorkflow(workflowId, { commit }).then(
          (value) => value,
          (cause: unknown) => {
            console.error(`${workflowId} could not be read`, cause);
            if (active)
              setFailure("Some workflows could not be read completely.");
            return null;
          },
        );
        if (!active || doc === null) continue;
        const read: PublishedFacts = {
          triggers: doc.definition.triggers ?? [],
          apps: Object.values(doc.definition.apps).map((app) => app.appId),
        };
        setFacts((previous) =>
          new Map(previous).set(`${workflowId}@${commit}`, read),
        );
      }
    };
    void Promise.all(Array.from({ length: READS_AT_ONCE }, read));
    return () => {
      active = false;
    };
  }, [client, published]);
  const rows: readonly HomeRow[] = useMemo(() => {
    const newest = latestRuns(runs);
    return entries.map((entry) => {
      const run = newest.get(entry.workflowId);
      return homeRow({
        workflowId: entry.workflowId,
        title: entry.title,
        published: entry.published !== null,
        facts: entry.published
          ? (facts.get(`${entry.workflowId}@${entry.published.commit}`) ?? null)
          : null,
        registrations: registrations
          .filter((item) => item.workflowId === entry.workflowId)
          .map((item) => item.row),
        run,
        status: run ? statuses[run.runId] : undefined,
        now,
      });
    });
  }, [entries, facts, registrations, runs, statuses, now]);
  /** Switch one workflow on or off, then read the real state back. */
  const setOn = useCallback(
    async (workflowId: string, on: boolean): Promise<SwitchOutcome> => {
      const entry = entries.find((item) => item.workflowId === workflowId);
      if (!entry?.published)
        return { kind: "failed", message: "Publish this workflow first." };
      try {
        const doc = await client.loadWorkflow(workflowId, {
          commit: entry.published.commit,
        });
        if (doc === null)
          return { kind: "failed", message: "This workflow is missing." };
        const triggers = doc.definition.triggers ?? [];
        const control = createTriggerControl(client, doc.definition, {
          workflowId,
          commit: entry.published.commit,
        });
        const armed = await control.list();
        let missed;
        if (on) {
          const catalog = Object.keys(doc.definition.apps).length
            ? await client.catalog()
            : { apps: [] };
          const bindings: Record<string, string> = {};
          for (const [alias, spec] of Object.entries(doc.definition.apps)) {
            const matches = catalog.apps.filter(
              (app) => app.appId === spec.appId,
            );
            if (matches.length !== 1)
              return {
                kind: "needs-setup",
                message: `Choose which ${alias} to use on ${entry.title}’s Triggers tab, then switch it on.`,
              };
            bindings[alias] = matches[0].installationId;
          }
          missed = await switchOn(control, triggers, armed, bindings);
        } else missed = await switchOff(control, triggers, armed);
        setReload((value) => value + 1);
        return missed.length === 0
          ? { kind: "done" }
          : {
              kind: "failed",
              message: failureWords(missed, on ? "on" : "off"),
            };
      } catch (cause) {
        console.error(`${workflowId} could not be switched`, cause);
        return {
          kind: "failed",
          message: `${entry.title} could not be turned ${on ? "on" : "off"}.`,
        };
      }
    },
    [client, entries],
  );
  return { rows, failure, setOn };
}
