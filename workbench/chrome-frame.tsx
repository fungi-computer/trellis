import { useState, type ReactNode } from "react";
import { ChromeProvider } from "../src/chrome.js";
import { createProofHost } from "./proof-host.js";

/** The window header the host draws, around an App part that publishes to it. */
export function ChromeFrame({
  children,
  host: given,
}: {
  children: ReactNode;
  /** A host the test reads or drives; otherwise the frame makes its own. */
  host?: ReturnType<typeof createProofHost>;
}) {
  const [own] = useState(createProofHost);
  const host = given ?? own;
  return (
    <ChromeProvider navigation={host.navigation}>
      <host.ProofHeader />
      {children}
    </ChromeProvider>
  );
}
