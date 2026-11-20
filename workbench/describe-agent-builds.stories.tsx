import { useMemo, useState } from "react";
import { seededAvatar } from "@fungi.computer/sprite/avatar";
import { AskAgent, type AskTarget } from "../src/agent/ask-agent.js";
import { workflowClient } from "../src/workflow-client.js";
import { ChromeFrame } from "./chrome-frame.js";
import "@fungi.computer/caps/fonts.css";
import "../src/trellis.css";

export default { title: "Trellis describe it to an Agent" };

const mossId = "agent-moss";
const chats = [
  { agentId: mossId, sessionId: "garden", title: "Garden helper" },
  { agentId: "agent-fern", sessionId: "reports", title: "Weekly reports" },
];

/** The Ask panel over a fixed set of chats, an Agent directory and saves. */
function client(options: { chats: typeof chats; saves: number }) {
  return workflowClient(
    {
      call: (method) => {
        if (method === "listChats")
          return Promise.resolve({ chats: options.chats });
        if (method === "draftHead")
          return Promise.resolve({
            revision: 4,
            liveVersion: 1,
            changedSince: Array.from({ length: options.saves }, (_, index) => ({
              actor: { kind: "agent", agentId: mossId },
              revision: index + 2,
              at: 1,
            })),
          });
        if (method === "askAgent")
          return Promise.resolve({ status: "accepted", commandId: "c" });
        return Promise.reject(new Error(`Unexpected App method: ${method}`));
      },
    },
    {
      list: () =>
        Promise.resolve(
          ["agent-moss", "agent-fern"].map((agentId, index) => ({
            agentId,
            name: index === 0 ? "Moss" : "Fern",
            avatar: seededAvatar(agentId),
            sessionOperations: ["agent.send" as const],
          })),
        ),
    },
  );
}

function Panel({
  building,
  chosen = chats,
  saves = 0,
}: {
  building: AskTarget | null;
  chosen?: typeof chats;
  saves?: number;
}) {
  const source = useMemo(
    () => client({ chats: chosen, saves }),
    [chosen, saves],
  );
  const [now, setNow] = useState(building);
  return (
    <div className="trellis" style={{ maxWidth: "40rem", padding: "1rem" }}>
      <ChromeFrame>
        <AskAgent
          client={source}
          workflowId="garden"
          building={now}
          onBuilding={(target) => {
            setNow(target);
          }}
          notify={() => undefined}
        />
      </ChromeFrame>
    </div>
  );
}

/** Pick a chat, describe the workflow, send. */
export const DescribeAgentBuilds = () => <Panel building={null} />;

/** The Agent is building: its name, its saves so far, and Stop. */
export const MossBuilds = () => (
  <Panel building={{ agentId: mossId, sessionId: "garden" }} saves={2} />
);

/** No chat to ask: the panel says so instead of offering a dead Send. */
export const NoChats = () => <Panel building={null} chosen={[]} />;
