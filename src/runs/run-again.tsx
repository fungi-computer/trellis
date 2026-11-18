import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@fungi.computer/caps/components/dialog";
import { Button } from "@fungi.computer/caps/components/button";
import type { WorkflowRunListItem } from "@fungi.computer/workflows-wire";
import type { WorkflowClient } from "../workflow-client.js";
import { RunWorkflow } from "./run-workflow.js";
import type { RunStatus } from "./run-state.js";

/**
 * Start the same run again. Nothing replays on its own: the run's own input
 * fills the ordinary run form, and the person looks it over and starts it. A
 * published run uses its own version; a test runs the draft as saved now. The
 * Apps are chosen again at the start, as they are for any run.
 */
export function RunAgain({
  client,
  item,
  input,
  draftRevision,
  onRun,
}: {
  client: WorkflowClient;
  item: WorkflowRunListItem;
  input: RunStatus["input"];
  /** The saved draft's revision, which a test of it is made against. */
  draftRevision: number | undefined;
  onRun: (runId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const version = "version" in item ? item.version : null;
  const isTest = !("commit" in item);
  if (isTest ? draftRevision === undefined : version === null) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Run again
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run again</DialogTitle>
          <DialogDescription>
            {isTest
              ? "Tests the draft as it is saved now, with the same inputs."
              : `Starts a new run of v${String(version)} with the same inputs.`}{" "}
            Check them, then start it.
          </DialogDescription>
        </DialogHeader>
        <RunWorkflow
          client={client}
          workflowId={item.workflowId}
          version={version ?? undefined}
          testRevision={isTest ? draftRevision : undefined}
          input={input}
          onRun={(runId) => {
            setOpen(false);
            onRun(runId);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
