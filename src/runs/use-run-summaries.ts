import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowRunListItem } from "@fungi.computer/workflows-wire";
import type { WorkflowClient } from "../workflow-client.js";
import { terminal, type RunStatus } from "./run-state.js";

const READS_AT_ONCE = 4;
const POLL_MS = 3000;

/**
 * The status of every listed run, so the list can say which ones need you.
 * Finished runs are read once; active ones are read again until they end.
 * A run that cannot be read stays unsorted, with its read error for the list.
 */
export function useRunSummaries(
  client: WorkflowClient,
  items: readonly WorkflowRunListItem[] | null,
) {
  const [runs, setRuns] = useState<Readonly<Record<string, RunStatus>>>({});
  // A run whose status could not be read says so in the list, not silently unsorted.
  const [readErrors, setReadErrors] = useState<ReadonlyMap<string, Error>>(
    new Map(),
  );
  const setReadError = useCallback((runId: string, error: Error | null) => {
    setReadErrors((previous) => {
      if (error === null && !previous.has(runId)) return previous;
      const next = new Map(previous);
      if (error === null) next.delete(runId);
      else next.set(runId, error);
      return next;
    });
  }, []);
  // The open run reports its own reads here too, so a run that ended there is not read again.
  const known = useRef(new Map<string, RunStatus>());
  const record = useCallback((run: RunStatus) => {
    known.current.set(run.runId, run);
    setRuns((previous) => ({ ...previous, [run.runId]: run }));
  }, []);
  // A refreshed list of the same runs keeps its reads, so depend on the ids.
  const ids = items?.map((item) => item.runId).join("\n") ?? "";
  useEffect(() => {
    const listed = ids === "" ? [] : ids.split("\n");
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function readAll(due: readonly string[]) {
      const queue = [...due];
      await Promise.all(
        Array.from({ length: READS_AT_ONCE }, async () => {
          for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
            try {
              const run = await client.runStatus(id);
              if (!active) return;
              record(run);
              setReadError(id, null);
            } catch (cause) {
              if (active)
                setReadError(
                  id,
                  new Error("This run could not be read.", { cause }),
                );
            }
          }
        }),
      );
    }
    async function cycle() {
      const due = listed.filter((runId) => {
        const run = known.current.get(runId);
        return (
          run === undefined ||
          (run.outcome === "active" && !terminal(run.status))
        );
      });
      if (due.length === 0) return;
      await readAll(due);
      if (active) timer = setTimeout(() => void cycle(), POLL_MS);
    }
    void cycle();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, ids, record, setReadError]);
  return { runs, record, readErrors };
}
