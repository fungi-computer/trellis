import { useSyncExternalStore } from "react";
import {
  type AppBackHandler,
  type AppNavigationActivationHandler,
  type AppNavigationState,
  type HostNavigation,
} from "@fungi.computer/agar";
import { WindowHeader } from "@fungi.computer/caps/components/window";

/**
 * The window header a host draws for Trellis, for browser proofs that mount
 * the App without a shell: the same Caps WindowHeader the Tourtois pane uses,
 * fed by what the App publishes and relaying crumb and command activations.
 */
export function createProofHost() {
  let state: AppNavigationState = { canGoBack: false };
  let back: AppBackHandler | undefined;
  let activate: AppNavigationActivationHandler | undefined;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const navigation: HostNavigation = {
    publish: (next) => {
      state = next;
      for (const listener of listeners) listener();
      return Promise.resolve();
    },
    onBack: (handler) => {
      back = handler;
      return () => {
        back = undefined;
      };
    },
    onActivate: (handler) => {
      activate = handler;
      return () => {
        activate = undefined;
      };
    },
  };
  function ProofHeader() {
    const current = useSyncExternalStore(subscribe, () => state);
    return (
      <WindowHeader
        title="Trellis"
        popover={document.body}
        {...(current.crumbs === undefined ? {} : { crumbs: current.crumbs })}
        {...(current.primary === undefined ? {} : { primary: current.primary })}
        {...(current.menu === undefined ? {} : { menu: current.menu })}
        {...(current.status === undefined ? {} : { status: current.status })}
        {...(current.canGoBack
          ? {
              back: {
                label: "Back in Trellis",
                onBack: () => {
                  void back?.();
                },
              },
            }
          : {})}
        onCrumb={(crumbId, siblingId) => {
          void activate?.(
            siblingId === undefined
              ? { kind: "crumb", crumbId }
              : { kind: "crumb", crumbId, siblingId },
          );
        }}
        onAction={(actionId) => {
          void activate?.({ kind: "action", actionId });
        }}
      />
    );
  }
  return {
    navigation,
    ProofHeader,
    /** What the App last published to the header. */
    published: () => state,
    /** Press the header's Back, as the person does. */
    goBack: () => back?.(),
    /** Do what the person does in the header: choose a crumb, sibling or command. */
    activate: (activation: Parameters<AppNavigationActivationHandler>[0]) =>
      activate?.(activation),
  };
}
