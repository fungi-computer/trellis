import { useEffect, useState } from "react";
import type { WorkflowClient } from "../workflow-client.js";
import { terminal, type RunStatus } from "./run-state.js";
/** Schedule the next read after this one settles; never overlap reads. */
export function useRun(client: WorkflowClient, runId: string) {
  const [run, setRun] = useState<RunStatus | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setRun(null);
    setError(false);
    async function read() {
      try {
        const next = await client.runStatus(runId);
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
