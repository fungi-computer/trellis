import * as Schema from "effect/Schema";
import * as z from "zod";
import { memberInboxItemSchema } from "@fungi.computer/agar/inbox";
import type { WorkflowMethodContext } from "./methods.js";

const inboxPage = z.object({ items: z.array(z.json()).max(200) });

/** One chat the person has: an Agent Session with its title. */
export type Chat = { agentId: string; sessionId: string; title: string };

/**
 * The chats in this member's Inbox that a run, trigger or build request may
 * name, or `null` when the Inbox is not granted. One owner for the picker and
 * for the check that a request names a chat the person really has.
 */
export async function readChats(
  context: WorkflowMethodContext,
): Promise<Chat[] | null> {
  if (!context.env.INBOX) return null;
  const page = inboxPage.parse(await context.env.INBOX.page({ after: null }));
  return page.items.flatMap((raw) => {
    const item = Schema.decodeUnknownSync(memberInboxItemSchema)(raw);
    return "kind" in item || !("title" in item)
      ? []
      : [
          {
            agentId: item.agentId,
            sessionId: item.sessionId,
            title: item.title,
          },
        ];
  });
}
