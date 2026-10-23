import { applyTheme, getTheme } from "@fungi.computer/stipe/theme";
import { AppError, connectApp, type AppRoot } from "@fungi.computer/agar";
import { useAppContext, type AppMountState } from "@fungi.computer/agar/react";
import { useEffect, useMemo, useState } from "react";
import { ChromeProvider } from "./chrome.js";
import { WorkflowWorkspace } from "./workspace.js";
import { openWorkflows } from "./workflow-client.js";
import { appMethods } from "@fungi.computer/agar/backend";
import { readComputerFile } from "@fungi.computer/agar/computer";
import { openApp } from "@fungi.computer/agar/apps";
import type { ReadMedia } from "./runs/output-preview.js";
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
  const [connection, setConnection] = useState<AppMountState>(() => ({
    app: null,
    status: window.parent === window ? "standalone" : "connecting",
  }));
  useEffect(() => {
    if (window.parent === window) return;
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
      host: "parent",
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
          setConnection({ app: null, status: "ended" });
        });
        setConnection({ app: connected, status: "live" });
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Workflow App host connection failed", cause);
        setConnection({
          app: null,
          status: "not-hosted",
          error:
            cause instanceof AppError
              ? cause
              : new AppError("The Workflow App host is unavailable", {
                  cause,
                  code: "HOST_FAILURE",
                  retryable: true,
                }),
        });
      },
    );
    return () => {
      controller.abort();
      releaseSubscriptions();
      mounted?.dispose();
      restoreTheme();
    };
  }, [connect]);
  return (
    <>
      {connection.status === "not-hosted" && (
        <p role="alert">
          The App host did not connect. Reopen Trellis through your Team.
        </p>
      )}
      <WorkflowView app={connection.app} />
    </>
  );
}

/** The connected App surface, also used by the local method-transport proof. */
export function WorkflowView({ app }: { app: AppRoot | null }) {
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
