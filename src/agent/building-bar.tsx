import { Button } from "@fungi.computer/caps/components/button";
import { Loader } from "@fungi.computer/caps/components/loader";

/** One line while an Agent builds: who, how many saves, and Stop (or Done once it goes quiet). */
export function BuildingBar({
  who,
  saves,
  quiet,
  onEnd,
}: {
  who: string;
  saves: number;
  quiet: boolean;
  onEnd: () => void;
}) {
  return (
    <p className="wf-ask-building" role="status">
      {quiet ? null : <Loader decorative size="sm" />}
      <strong>{`${who} ${quiet ? "seems done" : "is building"}`}</strong>
      <span className="wf-muted">
        {saves === 0
          ? "Waiting for its first save"
          : `${String(saves)} ${saves === 1 ? "save" : "saves"}${quiet ? "" : " so far"}`}
      </span>
      <Button
        className="wf-ask-end"
        size="sm"
        variant="outline"
        onClick={onEnd}
      >
        {quiet ? "Done" : "Stop"}
      </Button>
    </p>
  );
}
