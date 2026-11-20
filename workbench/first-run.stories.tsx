import { useMemo, useState } from "react";
import { WorkflowView } from "../src/app.js";
import { WorkflowWorkspace } from "../src/workspace.js";
import { workflowClient } from "../src/workflow-client.js";
import { createScheduleFixture } from "../test/schedules.fixture.js";
import { ChromeFrame } from "./chrome-frame.js";
import "@xyflow/react/dist/style.css";
import "@fungi.computer/caps/fonts.css";
import "../src/trellis.css";

export default { title: "Trellis first run" };

/** The window before the host connects: the blob loader, never a dead sentence. */
export const Opening = () => <WorkflowView app={null} />;

/** Nothing is scheduled anywhere: the page teaches the first step. */
export const SchedulesEmpty = () => {
  const source = createScheduleFixture();
  const client: ReturnType<typeof workflowClient> = {
    ...source.client,
    listTriggers: async (...input) => {
      const page = await source.client.listTriggers(...input);
      return "error" in page ? page : { ...page, schedules: [] };
    },
    listScheduleAgents: () => Promise.resolve([]),
  };
  return (
    <div className="trellis">
      <ChromeFrame>
        <WorkflowWorkspace
          client={client}
          initialScope={{ kind: "schedules" }}
        />
      </ChromeFrame>
    </div>
  );
};

const denied = Object.assign(new Error("not granted"), {
  code: "CAPABILITY_DENIED",
});

/** A Team with no workflows, and Git access that is (or is not yet) approved. */
function EmptyTeam({
  approved,
  scope = "all-workflows",
}: {
  approved: boolean;
  scope?: "all-workflows" | "templates";
}) {
  const [granted, setGranted] = useState(approved);
  const client = useMemo(
    () =>
      workflowClient({
        call: (method) => {
          if (method === "listWorkflows")
            return granted
              ? Promise.resolve({ items: [] })
              : Promise.reject(denied);
          if (method === "listRuns") return Promise.resolve([]);
          if (method === "viewerId")
            return Promise.resolve({ error: "not_granted" });
          return Promise.reject(denied);
        },
      }),
    [granted],
  );
  return (
    <div className="trellis">
      <ChromeFrame>
        <WorkflowWorkspace
          client={client}
          initialScope={{ kind: scope }}
          permissions={{
            requestAppPermissions: () => {
              setGranted(true);
              return Promise.resolve("granted" as const);
            },
          }}
        />
      </ChromeFrame>
    </div>
  );
}

/** Git access not approved yet: one panel, one primary action. */
export const NeedsGitAccess = () => <EmptyTeam approved={false} />;
/** A Team with no workflows: an empty canvas with a dashed Start node. */
export const FirstRun = () => <EmptyTeam approved />;
/** Templates before the grant: Use is off, with the reason beside it. */
export const TemplatesBlocked = () => (
  <EmptyTeam approved={false} scope="templates" />
);
/** Templates after Approve: choosing one that cannot save toasts its cause. */
export const TemplateCannotSave = () => (
  <EmptyTeam approved scope="templates" />
);
