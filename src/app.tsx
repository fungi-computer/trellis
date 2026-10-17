import { applyTheme, getTheme } from "@fungi.computer/stipe/theme";
import { connectApp, type AppRoot } from "@fungi.computer/agar";
import { useAppContext } from "@fungi.computer/agar/react";
import { useEffect, useMemo, useState } from "react";
import { ChromeProvider } from "./chrome.js";
import { WorkflowWorkspace } from "./workspace.js";
import { openWorkflows } from "./workflow-client.js";
import { appMethods } from "@fungi.computer/agar/backend";
import { readComputerFile } from "@fungi.computer/agar/computer";
import { openApp } from "@fungi.computer/agar/apps";
import type { ReadMedia } from "./runs/review-dock.js";
import type { OpenInApp } from "./runs/run-timeline.js";

const ENDED: ReadonlySet<string> = new Set([
  "disposing",
  "disconnected",
  "disposed",
]);

/** Connect to the parent host; standalone the App shows its signed-out state. */
export function WorkflowApp({
  connect = connectApp,
}: {
  connect?: typeof connectApp;
}) {
  const [app, setApp] = useState<AppRoot | null>(null);
  useEffect(() => {
    if (window.parent === window || !document.referrer) return;
    const controller = new AbortController();
    const standaloneTheme = getTheme();
    const restoreTheme = () => {
      if (standaloneTheme) applyTheme(standaloneTheme);
    };
    let mounted: AppRoot | undefined;
    let releaseTheme: (() => void) | undefined;
    let releaseLifecycle: (() => void) | undefined;
    const releaseSubscriptions = () => {
      releaseTheme?.();
      releaseLifecycle?.();
      releaseTheme = undefined;
      releaseLifecycle = undefined;
    };
    connect({
      expectedHostOrigin: new URL(document.referrer).origin,
      signal: controller.signal,
    }).then(
      (connected) => {
        if (controller.signal.aborted) {
          connected.dispose();
          return;
        }
        mounted = connected;
        applyTheme(connected.theme.get());
        releaseTheme = connected.theme.subscribe(applyTheme);
        releaseLifecycle = connected.lifecycle.subscribe((state) => {
          if (!ENDED.has(state)) return;
          releaseSubscriptions();
          restoreTheme();
          setApp(null);
        });
        setApp(connected);
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          console.error("Workflow App host connection failed", cause);
        setApp(null);
      },
    );
    return () => {
      controller.abort();
      releaseSubscriptions();
      mounted?.dispose();
      restoreTheme();
    };
  }, [connect]);
  return <WorkflowView app={app} />;
}

/** The connected App surface, also used by the local method-transport proof. */
export function WorkflowView({ app }: { app: AppRoot | null }) {
  const [view, setView] = useState("runs");
  const openRequest = useAppContext(app)?.openRequest;
  const client = useMemo(
    () =>
      app?.capabilities.has(appMethods)
        ? openWorkflows(app.capabilities)
        : null,
    [app],
  );
  const readMedia = useMemo<ReadMedia | undefined>(
    () =>
      app
        ? (path, signal) =>
            readComputerFile(app.capabilities, { path }, { signal })
        : undefined,
    [app],
  );
  const openIn = useMemo<OpenInApp | undefined>(
    () =>
      app
        ? (appId, params) =>
            openApp(app.capabilities, {
              appId,
              intent: { kind: "navigate", params },
            })
        : undefined,
    [app],
  );
  return (
    <div className="trellis">
      <ChromeProvider navigation={app?.window.navigation}>
        <div className="wf-workspace">
          {client && app ? (
            <WorkflowWorkspace
              client={client}
              view={view}
              onView={setView}
              readMedia={readMedia}
              openIn={openIn}
              browserActions={app.ui}
              openRequest={openRequest}
            />
          ) : (
            <main className="wf-page">
              <h1>Trellis</h1>
              <p>Open Trellis from your Team to edit and run workflows.</p>
            </main>
          )}
        </div>
      </ChromeProvider>
    </div>
  );
}
