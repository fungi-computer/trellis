import * as S from "effect/Schema";
import * as z from "zod";
import {
  agentScheduleListInputSchema,
  agentScheduleTargetSchema,
  agentSchedulePageSchema,
  agentScheduleControlReceiptSchema,
} from "@fungi.computer/shiitake-extensions/schedules";

/** App-method arguments retain the native owner's page and identity grammar. */
export const listAgentSchedulesInputSchema =
  agentScheduleListInputSchema.extend({
    agentId: agentScheduleTargetSchema.options[0].shape.agentId,
  });
export { agentScheduleTargetSchema };

export const agentSchedulesReplySchema = z.fromJSONSchema(
  S.toJsonSchemaDocument(agentSchedulePageSchema).schema,
);
export const agentScheduleControlReplySchema = z.fromJSONSchema(
  S.toJsonSchemaDocument(agentScheduleControlReceiptSchema).schema,
);
export const decodeAgentSchedulePage = S.decodeUnknownSync(
  agentSchedulePageSchema,
  { onExcessProperty: "error" },
);
export const decodeAgentScheduleControl = S.decodeUnknownSync(
  agentScheduleControlReceiptSchema,
  { onExcessProperty: "error" },
);
