import { createContext, useContext } from "react";

/** True until the first App catalog answer: steps read as loading, never unavailable. */
const CatalogLoading = createContext(false);
export const CatalogLoadingProvider = CatalogLoading.Provider;
export const useCatalogLoading = () => useContext(CatalogLoading);
