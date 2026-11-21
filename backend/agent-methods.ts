import type * as z from "zod";
import { defineAppMethod } from "@fungi.computer/agar/backend-definition";
import { askInputSchema, askReplySchema } from "../shared/ask-agent.js";
import { readChats } from "./chats.js";
import type { WorkflowMethodContext } from "./methods.js";

/** The words an Agent is sent: the draft, the tools, and what is left to the person. */
function message(input: z.output<typeof askInputSchema>): string {
  if (input.intent === "stop")
    return `Stop. Please stop building workflow ${input.workflowId} now: make no more saves or tests to it.`;
  return [
    `Please build a Trellis workflow with me. The draft is workflow ${input.workflowId}, and I am watching its canvas follow your saves.`,
    "Use only Trellis's own tools: loadWorkflow to read the draft and its revision, saveDraft to change it (send the whole draft with the revision you loaded), and testDraft to try it before I publish. Do not publish it; that stays with me.",
    "What I want:",
    input.text,
  ].join("\n\n");
}

/**
 * Ask an Agent, in a chat the person already has, to build into one draft. It
 * only sends a message: the Agent changes the draft with the same methods the
 * canvas uses, so there is no Agent-only write path.
 */
export const agentMethods = {
  askAgent: defineAppMethod({
    description:
      "Send a follow-up into one of your chats asking its Agent to build into a Workflow draft with loadWorkflow, saveDraft and testDraft, or to stop. The chat must be one of yours.",
    effect: "write",
    label: "Ask an Agent to build a workflow",
    requires: ["agent.send"],
    input: askInputSchema,
    output: askReplySchema,
    handler: async (input, context: WorkflowMethodContext) => {
      const chats = await readChats(context);
      if (chats === null || !context.env.AGENTS)
        return { error: "not_granted" as const };
      if (
        !chats.some(
          (chat) =>
            chat.agentId === input.agentId &&
            chat.sessionId === input.sessionId,
        )
      )
        return { error: "no_chat" as const };
      return askReplySchema.parse(
        await context.env.AGENTS.send({
          agentId: input.agentId,
          sessionId: input.sessionId,
          requestId: input.requestId,
          text: message(input),
          delivery: "followUp",
        }),
      );
    },
  }),
};
