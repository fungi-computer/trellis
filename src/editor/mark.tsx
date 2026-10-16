import { Monogram } from "@fungi.computer/caps/components/monogram";
import { isSigilName, Sigil } from "@fungi.computer/sigils";
import {
  Box,
  Check,
  Clock,
  GitBranch,
  List,
  Repeat,
  SlidersHorizontal,
  ArrowDownToLine,
} from "lucide-react";

/** App artwork comes from display metadata, never inferred from a method name. */
export function WorkflowMark({
  appIcon,
  kind,
  appName,
}: {
  appIcon?: string;
  kind: string;
  appName?: string;
}) {
  if (appIcon && isSigilName(appIcon))
    return (
      <span className="wf-app-mark" data-app-sigil={appIcon}>
        <Sigil name={appIcon} size={28} />
      </span>
    );
  if (kind === "app") return <Monogram name={appName ?? "App"} subject="app" />;
  const Glyph =
    kind === "review"
      ? Check
      : kind === "wait"
        ? Clock
        : kind === "condition"
          ? GitBranch
          : kind === "repeat"
            ? Repeat
            : kind === "map"
              ? List
              : kind === "transform"
                ? SlidersHorizontal
                : kind === "input"
                  ? ArrowDownToLine
                  : Box;
  return <Glyph className="wf-control-mark" size={16} aria-hidden="true" />;
}
