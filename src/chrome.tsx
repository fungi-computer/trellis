import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  AppCrumb,
  AppHeaderCommand,
  AppHeaderStatus,
  HostNavigation,
} from "@fungi.computer/agar";
import { useHostNavigation } from "@fungi.computer/agar/react";

/** A path crumb with what choosing it (or one of its siblings) does. */
export type ChromeCrumb = AppCrumb & {
  select?: (siblingId?: string) => void;
};
/** A header command with what it does. */
export type ChromeCommand = AppHeaderCommand & { run: () => void };
/** The App's history: Back and Forward move between places already visited. */
export type ChromeHistory = Readonly<{
  canGoBack: boolean;
  canGoForward: boolean;
  back: () => boolean;
  forward: () => boolean;
}>;

/** What one part of Trellis adds to the window header the host draws. */
export type ChromeParts = Readonly<{
  crumbs?: readonly ChromeCrumb[];
  primary?: readonly ChromeCommand[];
  menu?: readonly ChromeCommand[];
  status?: readonly AppHeaderStatus[];
  history?: ChromeHistory;
}>;

type Register = (key: string, parts: ChromeParts | null) => void;
const Registry = createContext<Register | null>(null);

/** The wire carries data only; what a crumb or command does stays here. */
function crumbData(crumb: ChromeCrumb): AppCrumb {
  const { id, label } = crumb;
  return crumb.siblings === undefined
    ? { id, label }
    : { id, label, siblings: crumb.siblings };
}
function commandData(item: ChromeCommand): AppHeaderCommand {
  let data: AppHeaderCommand = { id: item.id, label: item.label };
  if (item.icon !== undefined) data = { ...data, icon: item.icon };
  if (item.variant !== undefined) data = { ...data, variant: item.variant };
  if (item.tone !== undefined) data = { ...data, tone: item.tone };
  if (item.disabled !== undefined) data = { ...data, disabled: item.disabled };
  return data;
}

/**
 * Trellis has no chrome of its own: the host draws one header row, and each
 * part of the App adds its crumbs, commands and status to it in the order
 * the parts first appeared.
 */
export function ChromeProvider({
  navigation,
  children,
}: {
  navigation: HostNavigation | undefined;
  children: ReactNode;
}) {
  const [parts, setParts] = useState<ReadonlyMap<string, ChromeParts>>(
    new Map(),
  );
  const register = useCallback<Register>((key, next) => {
    setParts((current) => {
      const updated = new Map(current);
      if (next === null) updated.delete(key);
      else updated.set(key, next);
      return updated;
    });
  }, []);
  // The workspace owns the start of the path; other parts extend it.
  const all = [...parts]
    .sort(
      ([left], [right]) =>
        Number(right === "workspace") - Number(left === "workspace"),
    )
    .map(([, part]) => part);
  const crumbs = all.flatMap((part) => part.crumbs ?? []);
  const primary = all.flatMap((part) => part.primary ?? []);
  const menu = all.flatMap((part) => part.menu ?? []);
  const history = all.find((part) => part.history !== undefined)?.history;
  const published = {
    canGoBack: history?.canGoBack === true,
    canGoForward: history?.canGoForward === true,
    onForward: () => history?.forward() ?? false,
    onBack: () => history?.back() ?? false,
    onCrumb: (crumbId: string, siblingId?: string) => {
      crumbs.find((crumb) => crumb.id === crumbId)?.select?.(siblingId);
    },
    onAction: (actionId: string) => {
      [...primary, ...menu].find((item) => item.id === actionId)?.run();
    },
    status: all.flatMap((part) => part.status ?? []),
  };
  useHostNavigation(navigation, {
    ...published,
    crumbs: crumbs.map(crumbData),
    primary: primary.map(commandData),
    menu: menu.map(commandData),
  });
  return <Registry.Provider value={register}>{children}</Registry.Provider>;
}

/** Add this part's crumbs, commands and status to the header while mounted. */
export function useChrome(key: string, parts: ChromeParts | null) {
  const register = useContext(Registry);
  useEffect(() => {
    register?.(key, parts);
  });
  useEffect(
    () => () => {
      register?.(key, null);
    },
    [register, key],
  );
}
