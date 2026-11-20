import { WorkflowWorkspace } from "../src/workspace.js";
import { createHomeFixture } from "../test/workflows-home.fixture.js";
import { ChromeFrame } from "./chrome-frame.js";
import "@xyflow/react/dist/style.css";
import "@fungi.computer/caps/fonts.css";
import "../src/trellis.css";

export default { title: "Trellis workflows home" };

const frame = (
  client: ReturnType<typeof createHomeFixture>["client"],
  scope: "all-workflows" | "templates",
) => (
  <div className="trellis">
    <ChromeFrame>
      <WorkflowWorkspace client={client} initialScope={{ kind: scope }} />
    </ChromeFrame>
  </div>
);

/** Home: six workflows, one 32px row each (mockup 02-A). */
export const Workflows = () =>
  frame(createHomeFixture().client, "all-workflows");

/** A Team with no workflows opens on a blank canvas with a dashed Start node (01-A). */
export const FirstRunCanvas = () =>
  frame(createHomeFixture([]).client, "all-workflows");

/** Templates, each drawn as a read-only mini canvas (17). */
export const TemplateGrid = () =>
  frame(createHomeFixture().client, "templates");
