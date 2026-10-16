import { defineAppGill, type AppBackendGill } from "@fungi.computer/agar/gills";
import { libraryListing } from "@fungi.computer/workflows-wire";

type GillRow = ReturnType<AppBackendGill["rows"]>["rows"][number];

/** The installation's saved library supplies one page, without a Git rebuild. */
export const workflowLibraryGill = defineAppGill({
  id: "workflow-library",
  title: "Workflow Library",
  source: "listWorkflows",
  limit: 20,
  sizes: ["M", "L"],
  input: ({ limit, after }): ReturnType<AppBackendGill["input"]> =>
    after === undefined ? { limit } : { limit, after },
  rows: (output) => {
    const identity = { viewId: "workflow-library", title: "Workflow Library" };
    const page = libraryListing.parse(output);
    if ("kind" in page)
      return {
        ...identity,
        state: "error",
        rows: [],
        error:
          "The saved Workflow library isn't ready. Open Trellis to update it.",
        recovery: { kind: "open" },
      };
    if (page.items.length === 0)
      return { ...identity, state: "empty", rows: [] };
    const rows = page.items.map((item): GillRow => {
      const row: GillRow = {
        id: item.workflowId,
        title: item.title.trim() || "Untitled Workflow",
        status:
          item.published === null
            ? {
                label: item.draftRevision === null ? "Not published" : "Draft",
                tone: "neutral",
              }
            : {
                label:
                  item.published.version === null
                    ? "Published"
                    : `Published v${String(item.published.version)}`,
                tone: "success",
              },
        open: { params: [{ key: "workflow", value: item.workflowId }] },
      };
      return item.draftRevision === null
        ? row
        : { ...row, detail: "Draft available" };
    });
    return page.next === undefined
      ? { ...identity, state: "full", rows }
      : { ...identity, state: "full", rows, next: page.next };
  },
});
