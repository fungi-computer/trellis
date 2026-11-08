import { WorkflowView } from "../src/app.js";
import { WorkflowWorkspace } from "../src/workspace.js";
import { workflowClient } from "../src/workflow-client.js";
import { createScheduleFixture } from "../test/schedules.fixture.js";
import { ChromeFrame } from "./chrome-frame.js";
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
