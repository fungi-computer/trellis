import * as z from "zod";
import { appSendBudgetRefusalSchema } from "@fungi.computer/agar/backend-definition";
import { workflowIdSchema } from "@fungi.computer/braid";

const identity = z.string().min(1).max(256);
const target = {
  agentId: identity,
  sessionId: identity,
  workflowId: workflowIdSchema,
  requestId: identity.refine(
    (value) => new TextEncoder().encode(value).byteLength <= 256,
  ),
};

/** Ask an Agent to build into a draft, or to stop. */
export const askInputSchema = z.discriminatedUnion("intent", [
  z.strictObject({
    intent: z.literal("build"),
    ...target,
    text: z.string().trim().min(1).max(8_000),
  }),
  z.strictObject({ intent: z.literal("stop"), ...target }),
]);
export type AskInput = z.output<typeof askInputSchema>;

/** What the host said to the send, or why it was refused. */
export const askReplySchema = z.union([
  z.strictObject({ status: z.literal("accepted"), commandId: identity }),
  appSendBudgetRefusalSchema,
  z.strictObject({ error: z.enum(["no_chat", "not_granted"]) }),
]);
export type AskReply = z.output<typeof askReplySchema>;
