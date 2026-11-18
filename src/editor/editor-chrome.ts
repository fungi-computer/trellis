import type { ChromeCommand, ChromeParts } from "../chrome.js";

/*
 * What the editor puts in the window header: the commands, and the status in
 * words. A saved draft says "Saved"; a draft with something wrong says how many
 * problems, in words, never a bare bead.
 */

export type EditorChromeState = Readonly<{
  /** A published version is open, read only. */
  version: number | undefined;
  /** The commit of the open version, when known. */
  commit: string | undefined;
  /** The newest published version, when there is one: the next publish is the one after it. */
  latestVersion: number | undefined;
  /** This draft is identical to a published version. */
  unchangedPublished: boolean;
  durability: "memory" | "persistent";
  /** The draft differs from what is saved. */
  unsaved: boolean;
  saving: boolean;
  conflict: boolean;
  saveFailed: boolean;
  catalogLoading: boolean;
  catalogFailed: boolean;
  problems: number;
  publishing: boolean;
  publicationPaused: boolean;
  publishFailed: boolean;
  restoring: boolean;
  /** The workflow can run: something has been published. */
  runnable: boolean;
  hasRunPanel: boolean;
  canPublish: boolean;
  canRestore: boolean;
  /** This host can test a draft; where it cannot, there is no Test command. */
  testable: boolean;
  /** A test is starting. */
  testStarting: boolean;
}>;

export type EditorChromeActions = Readonly<{
  run: () => void;
  restore: () => void;
  testWorkflow: () => void;
  publish: (runAfter: boolean) => void;
}>;

/** Words for how the draft stands against what is saved. */
function savedWords(state: EditorChromeState) {
  if (state.version !== undefined)
    return `Version ${String(state.version)} · read only${state.commit ? ` · ${state.commit.slice(0, 7)}` : ""}`;
  if (state.durability === "memory") return "Unsaved · this window only";
  if (state.problems > 0 && state.unsaved) return "Not saved · fix issues";
  if (state.saving) return "Saving…";
  if (state.saveFailed || state.conflict || state.unsaved) return "Not saved";
  return "Saved";
}

/** Words for what is wrong with the draft, or nothing when nothing is. */
function problemWords(state: EditorChromeState) {
  if (state.catalogLoading) return "Loading Apps…";
  if (state.catalogFailed) return "Not checked";
  if (state.problems === 0) return null;
  return `${String(state.problems)} ${state.problems === 1 ? "problem" : "problems"}`;
}

function publishBlocked(state: EditorChromeState) {
  return (
    state.publishing ||
    (!state.publicationPaused &&
      (state.saving ||
        state.conflict ||
        state.saveFailed ||
        state.catalogLoading ||
        state.catalogFailed ||
        state.problems > 0 ||
        state.unsaved))
  );
}

/** The header's commands, with the one a person most likely wants first. */
export function editorChrome(
  state: EditorChromeState,
  actions: EditorChromeActions,
): Pick<ChromeParts, "primary" | "menu" | "status"> {
  const readOnly = state.version !== undefined;
  const blocked = publishBlocked(state);
  const commands: ChromeCommand[] = [
    ...(state.hasRunPanel
      ? [
          {
            id: "run",
            label: "Run",
            variant: !state.runnable
              ? ("ghost" as const)
              : state.unchangedPublished || readOnly
                ? ("primary" as const)
                : ("outline" as const),
            disabled: !state.runnable,
            run: actions.run,
          },
        ]
      : []),
    ...(state.testable && !readOnly
      ? [
          {
            id: "test",
            label: state.testStarting ? "Testing…" : "Test workflow",
            variant: "outline" as const,
            // A test runs the saved draft: wait for what is on screen to be saved.
            disabled:
              state.testStarting ||
              state.unsaved ||
              state.saving ||
              state.conflict ||
              state.saveFailed ||
              state.catalogLoading ||
              state.catalogFailed ||
              state.problems > 0,
            run: actions.testWorkflow,
          },
        ]
      : []),
    ...(readOnly && state.canRestore
      ? [
          {
            id: "restore",
            label: "Restore as draft",
            variant: "primary" as const,
            disabled: state.saving || state.restoring || state.conflict,
            run: actions.restore,
          },
        ]
      : state.canPublish && !readOnly
        ? [
            {
              id: "publish",
              label: state.publishing
                ? "Publishing…"
                : state.publicationPaused
                  ? "Check status"
                  : state.publishFailed
                    ? "Try again"
                    : state.latestVersion === undefined
                      ? "Publish"
                      : `Publish as v${String(state.latestVersion + 1)}`,
              variant: state.unchangedPublished
                ? ("ghost" as const)
                : state.hasRunPanel
                  ? ("outline" as const)
                  : ("primary" as const),
              disabled: blocked,
              run: () => {
                actions.publish(false);
              },
            },
            ...(state.hasRunPanel && !state.unchangedPublished
              ? [
                  {
                    id: "publish-run",
                    label: state.publishing
                      ? "Publishing & running…"
                      : "Publish & run",
                    variant: "primary" as const,
                    disabled: blocked,
                    run: () => {
                      actions.publish(true);
                    },
                  },
                ]
              : []),
          ]
        : []),
  ];
  const primaryId = readOnly
    ? state.hasRunPanel
      ? "run"
      : "restore"
    : state.hasRunPanel
      ? state.unchangedPublished || !state.canPublish
        ? "run"
        : "publish-run"
      : "publish";
  const saved = savedWords(state);
  const problems = problemWords(state);
  return {
    primary: commands.filter((command) => command.id === primaryId),
    menu: commands.filter((command) => command.id !== primaryId),
    status: [
      {
        id: "saved",
        label: saved,
        tone: saved === "Saved" ? ("success" as const) : ("neutral" as const),
      },
      ...(problems === null
        ? []
        : [
            {
              id: "problems",
              label: problems,
              tone:
                state.catalogLoading || state.catalogFailed
                  ? ("neutral" as const)
                  : ("error" as const),
            },
          ]),
    ],
  };
}
