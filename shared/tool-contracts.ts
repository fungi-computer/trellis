import * as z from "zod";
import { gitSha1Schema } from "@fungi.computer/puffball/git-representation";
import { workflowIdSchema } from "@fungi.computer/workflows-wire";

/** Published inventory describes discovery, never grants authority to start a run. */
export const workflowToolListing = z.union([
  z.strictObject({ kind: z.literal("unindexed") }),
  z.strictObject({
    kind: z.literal("ready"),
    tools: z
      .array(
        z.strictObject({
          workflowId: workflowIdSchema,
          tool: z
            .string()
            .min(1)
            .max(80)
            .regex(/^[A-Za-z][A-Za-z0-9_]*$/),
          title: z.string().max(120),
          description: z.string().max(1000),
          version: z.number().int().positive(),
          commit: gitSha1Schema,
          input: z.record(z.string(), z.json()),
          output: z.record(z.string(), z.json()),
          // Opaque to every generic tool-family host: the exact extra
          // arguments this App wants merged with the caller's `input` when
          // it dispatches to `runWorkflow` (its pinned workflowId, version
          // and the App bindings resolved for this published version). A
          // host spreads this verbatim; it never invents or defaults it.
          call: z.record(z.string(), z.json()),
        }),
      )
      .max(100),
  }),
]);
