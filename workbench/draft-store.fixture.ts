import {
  paletteFromCatalog,
  type DraftDocument,
  type DraftStore,
} from "../src/editor/draft-store.js";
import { fixtureCatalog, fixtureDraft } from "./editor.fixture.js";

/** Contract fixture only: no network, persistence, publication or App execution. */
export function savedDraftFixture(): DraftStore {
  const published: DraftDocument = structuredClone({
    draft: {
      ...fixtureDraft,
      definition: {
        ...fixtureDraft.definition,
        title: "Panel to plates · published",
      },
    },
    revision: 1,
    catalog: fixtureCatalog,
    appDisplay: {
      Prints: { displayName: "Prints", icon: "prints" },
      Shed: { displayName: "Shed", icon: "computer" },
    },
    palette: paletteFromCatalog(fixtureCatalog),
    durability: "persistent",
  });
  let current: DraftDocument = structuredClone({
    ...published,
    draft: fixtureDraft,
    revision: 3,
  });
  return {
    readCatalog() {
      return Promise.resolve({
        catalog: current.catalog,
        appDisplay: current.appDisplay,
        palette: current.palette,
      });
    },
    load(version) {
      return Promise.resolve(
        structuredClone(
          version === undefined ? current : version === 1 ? published : null,
        ),
      );
    },
    save(draft, expectedRevision) {
      if (current.revision !== expectedRevision)
        return Promise.resolve({
          status: "conflict",
          document: structuredClone(current),
        });
      current = structuredClone({
        ...current,
        draft,
        revision: current.revision + 1,
      });
      return Promise.resolve({
        status: "saved",
        document: structuredClone(current),
      });
    },
    listVersions() {
      return Promise.resolve([
        {
          version: 1,
          commit: "a".repeat(40),
          title: published.draft.definition.title,
          // A fixed day offset, not a calendar date: the editor's version
          // label always reads as elapsed time (versionRelativeTime), so an
          // absolute `createdAt` would drift out of its own expected label
          // every day this fixture is read. The extra half day keeps the
          // truncated day count at 6 even after real time passes between
          // this read and the label's own render.
          createdAt: new Date(Date.now() - 6.5 * 86_400_000).toISOString(),
        },
      ]);
    },
  };
}
