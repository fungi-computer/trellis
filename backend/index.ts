import type { AppGitPushFact } from "@fungi.computer/agar/git";
import { DurableObject } from "cloudflare:workers";
import { appBackend, type WorkflowMethodContext } from "./methods.js";
import { readWorkflowCatalog } from "./catalog.js";
import { onWorkflowGitPush } from "./push.js";
import { createWorkflowIndexes } from "./indexes.js";
import {
  backgroundSyncRefusalSchema,
  type BackgroundSyncRefusal,
} from "@fungi.computer/puffball/background-replay";

class WorkflowFacet extends DurableObject<WorkflowMethodContext["env"]> {
  declare public readonly env: WorkflowMethodContext["env"];
  readonly indexes;
  constructor(ctx: DurableObjectState, env: WorkflowMethodContext["env"]) {
    super(ctx, env);
    this.indexes = createWorkflowIndexes(ctx.storage);
  }
  async onGitPush(fact: AppGitPushFact): Promise<void> {
    if (!this.env.GIT) throw new Error("Git access is not granted");
    await onWorkflowGitPush(
      {
        git: this.env.GIT,
        indexes: this.indexes,
        catalog: (appIds) => readWorkflowCatalog(this.env.WORKFLOWS, appIds),
      },
      fact,
    );
  }
  async syncRefused(input: BackgroundSyncRefusal): Promise<void> {
    await this.indexes.publicationJobs.refused(
      backgroundSyncRefusalSchema.parse(input),
    );
  }
  override fetch(): Promise<Response> {
    return Promise.resolve(new Response(null, { status: 405 }));
  }
}

export const Trellis = appBackend.implement(WorkflowFacet);
