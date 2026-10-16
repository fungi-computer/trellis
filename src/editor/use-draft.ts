import { validate } from "@fungi.computer/braid";
import { useEffect, useRef, useState } from "react";
import type {
  Draft,
  DraftDocument,
  DraftCatalog,
  DraftStore,
  WorkflowVersion,
} from "./draft-store.js";

const AUTOSAVE_IDLE_MS = 800;

/** One in-flight write; idle edits stay local until the last change settles. */
export function useDraft(store: DraftStore) {
  const [document, setDocument] = useState<DraftDocument | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [debouncedDraft, setDebouncedDraft] = useState<Draft | null>(null);
  const [versions, setVersions] = useState<readonly WorkflowVersion[]>([]);
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
  const live = useRef(false);
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
  // (A fresh mount still fetches once with no apps known, then again once
  // the draft itself loads and the real app set becomes known.)
  const neededAppIdsKey = draft
    ? [...new Set(Object.values(draft.definition.apps).map((app) => app.appId))]
        .sort()
        .join(",")
    : "";
  useEffect(() => {
    let active = true;
    setCatalogError(null);
    setCatalogLoading(true);
    const neededAppIds =
      neededAppIdsKey === "" ? [] : neededAppIdsKey.split(",");
    void store.readCatalog(neededAppIds).then(
      (loaded) => {
        if (!active) return;
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
        if (active) {
          setCatalogError(cause);
          setCatalogLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [store, catalogAttempt, neededAppIdsKey]);
  return {
    document,
    draft,
    setDraft,
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
      if (
        !store.restore ||
        version === undefined ||
        !document ||
        saving ||
        restoring
      )
        return;
      const selectedVersion = version;
      setRestoring(true);
      setRestoreError(null);
      setRestoreNotice(null);
      try {
        const result = await store.restore(selectedVersion, document.revision);
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
        setRestoreNotice(`Restored v${String(selectedVersion)} as a draft`);
      } catch (cause) {
        if (live.current)
          setRestoreError(
            cause instanceof Error
              ? cause.message
              : "The version could not be restored.",
          );
      } finally {
        if (live.current) setRestoring(false);
      }
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
