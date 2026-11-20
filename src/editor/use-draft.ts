import * as z from "zod";
import { canonicalJson, validate } from "@fungi.computer/braid";
import { useEffect, useRef, useState } from "react";
import type {
  Draft,
  DraftDocument,
  DraftCatalog,
  DraftHead,
  DraftStore,
  WorkflowVersion,
} from "./draft-store.js";
import { diffDrafts } from "./draft-diff.js";

const AUTOSAVE_IDLE_MS = 800;
/** The canvas asks who saved the draft this often while it is on screen. */
const HEAD_POLL_MS = 2000;

/** One in-flight write; idle edits stay local until the last change settles. */
export function useDraft(store: DraftStore) {
  const [document, setDocument] = useState<DraftDocument | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [debouncedDraft, setDebouncedDraft] = useState<Draft | null>(null);
  const [versions, setVersions] = useState<readonly WorkflowVersion[]>([]);
  const [latestPublished, setLatestPublished] = useState<{
    version: number;
    draft: Draft;
  } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<unknown>(null);
  const [historyError, setHistoryError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [version, setVersion] = useState<number | undefined>();
  const [published, setPublished] = useState<DraftDocument | null>(null);
  const [versionError, setVersionError] = useState<unknown>(null);
  const discovery = useRef<Readonly<{
    store: DraftStore;
    value: DraftCatalog;
  }> | null>(null);
  const [head, setHead] = useState<DraftHead>(null);
  const [keptRevision, setKeptRevision] = useState<number | null>(null);
  const live = useRef(false);
  // What the adoption effect compares when a read of the newer draft returns.
  const latest = useRef<{
    document: DraftDocument | null;
    draft: Draft | null;
  }>({ document: null, draft: null });
  latest.current = { document, draft };
  const adopting = useRef<number | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setError(null);
    void store.load().then(
      (loaded) => {
        if (!active) return;
        if (!loaded) {
          setError(new Error("Workflow was not found"));
          return;
        }
        const known = discovery.current;
        setDocument(
          known?.store === store ? { ...loaded, ...known.value } : loaded,
        );
        setDraft(loaded.draft);
        setConflict(false);
      },
      (cause: unknown) => {
        if (active) setError(cause);
      },
    );
    return () => {
      active = false;
    };
  }, [store, loadAttempt]);
  useEffect(() => {
    let active = true;
    setHistoryError(null);
    void store.listVersions().then(
      (history) => {
        if (active) setVersions(history);
      },
      (cause: unknown) => {
        if (active) setHistoryError(cause);
      },
    );
    return () => {
      active = false;
    };
  }, [store, historyAttempt]);
  const latestVersion = versions.at(0)?.version;
  useEffect(() => {
    let active = true;
    setLatestPublished(null);
    if (latestVersion !== undefined)
      void store.load(latestVersion).then(
        (loaded) => {
          if (active && loaded)
            setLatestPublished({ version: latestVersion, draft: loaded.draft });
        },
        () => {
          // History can still be opened/retried; never claim an unread version matches.
        },
      );
    return () => {
      active = false;
    };
  }, [store, latestVersion]);
  useEffect(() => {
    let active = true;
    setPublished(null);
    setVersionError(null);
    if (version !== undefined)
      void store.load(version).then(
        (loaded) => {
          if (!active) return;
          if (loaded) setPublished(loaded);
          else setVersionError(new Error("Published version was not found"));
        },
        (cause: unknown) => {
          if (active) setVersionError(cause);
        },
      );
    return () => {
      active = false;
    };
  }, [store, version]);
  const following = store.head !== undefined && document !== null;
  useEffect(() => {
    // Settle, then schedule: one read at a time, none while the tab is hidden.
    if (!following) return;
    let active = true;
    let timer: number | undefined;
    const schedule = () => {
      timer = window.setTimeout(tick, HEAD_POLL_MS);
    };
    function tick() {
      if (globalThis.document.hidden || !store.head) {
        schedule();
        return;
      }
      void store
        .head()
        .then(
          (next) => {
            if (active) setHead(next);
          },
          () => {
            // A missed read is retried on the next turn; the draft stays as it is.
          },
        )
        .finally(() => {
          if (active) schedule();
        });
    }
    tick();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [store, following]);
  useEffect(() => {
    // Something else saved a newer draft: adopt it only while this window has
    // no edit of its own, so the person's work is never replaced.
    if (!head || !document) return;
    if (
      draft !== document.draft ||
      saving ||
      restoring ||
      head.revision <= document.revision ||
      adopting.current === head.revision
    )
      return;
    const revision = head.revision;
    adopting.current = revision;
    void store.load().then(
      (loaded) => {
        const now = latest.current;
        if (!live.current || !loaded || loaded.revision < revision) {
          adopting.current = null;
          return;
        }
        // The window changed while the read was out: edits stay, nothing adopts.
        const { document: current, draft: currentDraft } = now;
        if (current === null) {
          adopting.current = null;
          return;
        }
        if (
          currentDraft !== current.draft ||
          loaded.revision <= current.revision
        ) {
          adopting.current = null;
          return;
        }
        const known = discovery.current;
        const next =
          known?.store === store ? { ...loaded, ...known.value } : loaded;
        setDocument(next);
        setDraft(next.draft);
        setDebouncedDraft(next.draft);
        setConflict(false);
      },
      () => {
        adopting.current = null;
      },
    );
  }, [store, head, document, draft, saving, restoring]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedDraft(draft);
    }, AUTOSAVE_IDLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [draft]);
  useEffect(() => {
    if (
      !document ||
      !draft ||
      draft !== debouncedDraft ||
      document.draft === draft ||
      saving ||
      restoring ||
      conflict ||
      error ||
      (document.durability === "persistent" &&
        validate(draft.definition, document.catalog).length > 0)
    )
      return;
    setSaving(true);
    void store
      .save(draft, document.revision)
      .then(
        (result) => {
          if (!live.current) return;
          if (result.status === "conflict") setConflict(true);
          else {
            setDocument((current) => ({
              ...result.document,
              catalog: current?.catalog ?? result.document.catalog,
              appDisplay: current?.appDisplay ?? result.document.appDisplay,
              palette: current?.palette ?? result.document.palette,
              draft,
            }));
          }
        },
        (cause: unknown) => {
          if (live.current) setError(cause);
        },
      )
      .finally(() => {
        if (live.current) setSaving(false);
      });
  }, [
    store,
    document,
    draft,
    debouncedDraft,
    saving,
    restoring,
    conflict,
    error,
  ]);
  useEffect(() => {
    const refresh = () => {
      setCatalogAttempt((attempt) => attempt + 1);
      setHistoryAttempt((attempt) => attempt + 1);
    };
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
    };
  }, []);
  // Full ports are fetched only for the Apps this open draft actually names;
  // adding or removing an App node changes this stable key, which re-fetches.
  // (The first read waits for the draft, so a fresh mount reads once.)
  const neededAppIdsKey = draft
    ? [...new Set(Object.values(draft.definition.apps).map((app) => app.appId))]
        .sort()
        .join(",")
    : "";
  const draftLoaded = draft !== null;
  const catalogRetry = useRef<string | null>(null);
  useEffect(() => {
    // Wait for the draft: it names the Apps whose ports are needed, so one
    // catalog read (the index, then each named App's ports in parallel)
    // replaces an index-only read followed by the same read again.
    if (!draftLoaded) return;
    let active = true;
    setCatalogError(null);
    setCatalogLoading(true);
    const neededAppIds =
      neededAppIdsKey === "" ? [] : neededAppIdsKey.split(",");
    void store.readCatalog(neededAppIds).then(
      (loaded) => {
        if (!active) return;
        catalogRetry.current = null;
        setCatalogLoading(false);
        discovery.current = { store, value: loaded };
        // Discovery refresh never replaces local edits or their revision.
        setDocument((current) =>
          current
            ? {
                ...current,
                catalog: loaded.catalog,
                appDisplay: loaded.appDisplay,
                palette: loaded.palette,
              }
            : current,
        );
      },
      (cause: unknown) => {
        if (!active) return;
        // A dropped connection often clears on its own: read once more
        // before telling the person the catalog is unavailable.
        if (catalogRetry.current !== neededAppIdsKey) {
          catalogRetry.current = neededAppIdsKey;
          setCatalogAttempt((attempt) => attempt + 1);
          return;
        }
        setCatalogError(cause);
        setCatalogLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [store, catalogAttempt, neededAppIdsKey, draftLoaded]);
  const newestAgentRevision =
    head?.changedSince.find((change) => change.actor.kind === "agent")
      ?.revision ?? null;
  const liveDraft =
    head?.liveVersion != null && latestPublished?.version === head.liveVersion
      ? latestPublished.draft
      : null;
  // The diff only counts when an Agent saved since the live version, and it
  // stays hidden after Keep until an Agent saves again.
  const agentChange =
    draft !== null &&
    liveDraft !== null &&
    newestAgentRevision !== null &&
    (keptRevision === null || newestAgentRevision > keptRevision)
      ? (() => {
          const diff = diffDrafts(liveDraft, draft);
          return Object.keys(diff.marks).length + diff.removed.length > 0
            ? { diff, live: liveDraft, revision: newestAgentRevision }
            : null;
        })()
      : null;
  // Newer on the server while this window has edits of its own: they will be
  // refused as a conflict, and the person is told who changed it.
  const remoteChange =
    head !== null &&
    document !== null &&
    draft !== document.draft &&
    !saving &&
    head.revision > document.revision
      ? {
          by: head.changedSince.at(0)?.actor.kind ?? ("member" as const),
        }
      : null;
  async function restoreTo(target: number, notice: string, failed = "") {
    if (!store.restore || !document || saving || restoring) return;
    setRestoring(true);
    setRestoreError(null);
    setRestoreNotice(null);
    try {
      const result = await store.restore(target, document.revision);
      if (!live.current) return;
      if (result.status === "conflict") {
        setConflict(true);
        setRestoreError(
          "This draft changed elsewhere. Reload the draft before restoring.",
        );
        return;
      }
      const known = discovery.current;
      const restored =
        known?.store === store
          ? { ...result.document, ...known.value }
          : result.document;
      setDocument(restored);
      setDraft(restored.draft);
      setDebouncedDraft(restored.draft);
      setConflict(false);
      setError(null);
      setVersion(undefined);
      setRestoreNotice(notice);
    } catch (cause) {
      if (live.current)
        setRestoreError(
          failed +
            (cause instanceof Error
              ? cause.message
              : "The version could not be restored."),
        );
    } finally {
      if (live.current) setRestoring(false);
    }
  }
  return {
    document,
    draft,
    setDraft,
    matchingPublishedVersion:
      draft &&
      latestPublished &&
      canonicalJson(z.json().parse(draft)) ===
        canonicalJson(z.json().parse(latestPublished.draft))
        ? latestPublished.version
        : undefined,
    confirmPublication: (version: number, publishedDraft: Draft) => {
      setLatestPublished({ version, draft: publishedDraft });
    },
    versions,
    error,
    conflict,
    saving,
    catalogError,
    catalogLoading,
    historyError,
    version,
    setVersion: (next: number | undefined) => {
      setVersion(next);
      setRestoreError(null);
      setRestoreNotice(null);
    },
    restoring,
    restoreError,
    restoreNotice,
    restoreVersion: async () => {
      if (version === undefined) return;
      await restoreTo(version, `Restored v${String(version)} as a draft`);
    },
    agentChange,
    remoteChange,
    keepAgentChanges: () => {
      if (newestAgentRevision !== null) setKeptRevision(newestAgentRevision);
    },
    undoAgentChanges: async () => {
      if (head?.liveVersion == null) return;
      await restoreTo(
        head.liveVersion,
        `Undid the Agent's changes, back to v${String(head.liveVersion)}`,
        "Couldn't undo the Agent's changes: ",
      );
    },
    published,
    versionError,
    retrySave: () => {
      setError(null);
    },
    refreshCatalog: () => {
      setCatalogAttempt((attempt) => attempt + 1);
    },
    refreshHistory: () => {
      setHistoryAttempt((attempt) => attempt + 1);
    },
    reload: () => {
      setVersion(undefined);
      setRestoreError(null);
      setRestoreNotice(null);
      setLoadAttempt((attempt) => attempt + 1);
    },
  };
}
