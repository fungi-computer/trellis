import {
  validate,
  type Catalog,
  type WorkflowDefinition,
  type Graph,
} from "@fungi.computer/braid";

/** Templates become drafts against the installed method and event declarations, before publication freezes their pins. */
export function templateDefinition(
  definition: WorkflowDefinition,
  catalog: Catalog,
): WorkflowDefinition {
  const pin = (graph: Graph): Graph => ({
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.kind !== "app") return node;
      const app = Object.hasOwn(definition.apps, node.app)
        ? definition.apps[node.app]
        : undefined;
      const methods =
        app && Object.hasOwn(catalog, app.appId)
          ? catalog[app.appId].methods
          : undefined;
      const method =
        methods && Object.hasOwn(methods, node.method)
          ? methods[node.method]
          : undefined;
      if (!method)
        throw new Error(
          `Install the App providing ${node.method} before using this template.`,
        );
      return { ...node, methodDigest: method.digest };
    }),
  });
  type Trigger = NonNullable<WorkflowDefinition["triggers"]>[number];
  const pinEvent = (trigger: Trigger): Trigger => {
    if (trigger.on !== "event") return trigger;
    const app = Object.hasOwn(definition.apps, trigger.app)
      ? definition.apps[trigger.app]
      : undefined;
    const events =
      app && Object.hasOwn(catalog, app.appId)
        ? catalog[app.appId].events
        : undefined;
    const event =
      events && Object.hasOwn(events, trigger.event)
        ? events[trigger.event]
        : undefined;
    if (!event)
      throw new Error(
        `Install the App emitting ${trigger.event} before using this template.`,
      );
    return { ...trigger, eventDigest: event.digest };
  };
  let pinned: WorkflowDefinition = {
    ...definition,
    ...pin(definition),
    subgraphs: Object.fromEntries(
      Object.entries(definition.subgraphs ?? {}).map(([id, graph]) => [
        id,
        pin(graph),
      ]),
    ),
  };
  if (definition.triggers !== undefined)
    pinned = { ...pinned, triggers: definition.triggers.map(pinEvent) };
  const issues = validate(pinned, catalog);
  if (issues.length)
    throw new Error(issues.map((issue) => issue.message).join("; "));
  return pinned;
}
