import { BottomSheet } from "./BottomSheet";
import { button } from "../ui";

export type WhyThisEntry = {
  exerciseName: string;
  target: string;
  reasons: string[];
};

type WhyThisSheetProps = {
  ariaLabel: string;
  entries: WhyThisEntry[];
  triggerClassName?: string;
  open?: boolean;
  loading?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function WhyThisSheet({
  ariaLabel,
  entries,
  triggerClassName = "",
  open,
  loading = false,
  onOpenChange,
}: WhyThisSheetProps) {
  return (
    <BottomSheet
      title="Why this?"
      trigger={
        <button
          type="button"
          className={`${button} min-h-tap ${triggerClassName}`}
          aria-label={ariaLabel}
        >
          Why this?
        </button>
      }
      open={open}
      onOpenChange={onOpenChange}
    >
      {loading ? (
        <p role="status">Loading targets</p>
      ) : entries.length === 0 ? (
        <p className="text-fg-muted">
          No targets are available for this session.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {entries.map((entry, index) => (
            <section
              key={`${entry.exerciseName}:${index}`}
              className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
            >
              <h3 className="font-semibold">{entry.exerciseName}</h3>
              <p className="text-sm tabular-nums text-fg-muted">
                {entry.target}
              </p>
              {entry.reasons.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5">
                  {entry.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fg-muted">
                  No reasons were recorded for this target.
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}
