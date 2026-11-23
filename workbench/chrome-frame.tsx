import { useAppHeaderRef } from "@fungi.computer/caps/components/app-header";
import { useState, type ReactNode } from "react";
import { ChromeProvider } from "../src/chrome.js";
import { createProofHost } from "./proof-host.js";

/** The window header the host draws, around an App part that publishes to it. */
export function ChromeFrame({
  children,
  host: given,
  pinned = false,
  headerless = false,
}: {
  children: ReactNode;
  /** A host the test reads or drives; otherwise the frame makes its own. */
  host?: ReturnType<typeof createProofHost>;
  /** The frame is a maximised window: its header is the App's top header. */
  pinned?: boolean;
  /** The host draws its header elsewhere, so the App is the top of the page. */
  headerless?: boolean;
}) {
  const headerRef = useAppHeaderRef();
  const [own] = useState(createProofHost);
  const host = given ?? own;
  return (
    <ChromeProvider navigation={host.navigation}>
      {headerless ? null : pinned ? (
        <div ref={headerRef}>
          <host.ProofHeader />
        </div>
      ) : (
        <host.ProofHeader />
      )}
      {children}
    </ChromeProvider>
  );
}
