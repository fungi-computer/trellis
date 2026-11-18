import { useEffect, useState } from "react";
import type { WorkflowClient } from "../workflow-client.js";
import { terminal, type RunStatus } from "./run-state.js";
/**
 * Schedule the next read after this one settles; never overlap reads. A null
 * `runId` or no client reads nothing: the editor has no test run until one starts.
 */
export function useRun(
  client: WorkflowClient | undefined,
  runId: string | null,
) {
  const [run, setRun] = useState<RunStatus | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setRun(null);
    setError(false);
    if (client === undefined || runId === null) return;
    const reader = client;
    const id = runId;
    async function read() {
      try {
        const next = await reader.runStatus(id);
        if (!active) return;
        setRun(next);
        setError(false);
        if (next.outcome === "active" && !terminal(next.status))
          timer = setTimeout(() => void read(), 2000);
      } catch {
        if (active) setError(true);
      }
    }
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, runId, attempt]);
  return {
    run,
    error,
    refresh: () => {
      setAttempt((value) => value + 1);
    },
  };
}
