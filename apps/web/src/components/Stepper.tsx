import { useId, useState, type KeyboardEvent } from "react";

type StepperProps = {
  /** Visible label, also used to name the buttons ("Increase Weight"). */
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  /** Shown after the number, e.g. "lb". */
  unit?: string;
};

/**
 * A number with − and + buttons for weights, reps and the like. The number
 * is a spinbutton: arrow keys step it, Home and End jump to min and max, and
 * typing a value commits on Enter or blur.
 */
export function Stepper({
  label,
  value,
  onValueChange,
  step = 1,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  unit,
}: StepperProps) {
  const labelId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const decimals = decimalPlaces(step);

  function commit(next: number) {
    setDraft(null);
    const clamped = Math.min(max, Math.max(min, next));
    if (clamped !== value) onValueChange(clamped);
  }

  // Rounds away floating-point drift (0.1 + 0.2) without snapping to the step.
  function stepBy(delta: number) {
    const places = Math.max(decimals, decimalPlaces(value));
    commit(Number((value + delta).toFixed(places)));
  }

  function commitDraft() {
    if (draft === null) return;
    const parsed = Number(draft.trim().replace(",", "."));
    if (draft.trim() === "" || !Number.isFinite(parsed)) setDraft(null);
    else commit(parsed);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const keys: Record<string, () => void> = {
      ArrowUp: () => stepBy(step),
      ArrowDown: () => stepBy(-step),
      Home: () => commit(min),
      End: () => commit(max),
      Enter: commitDraft,
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  const buttonClass =
    "min-w-tap rounded-lg bg-surface-raised text-2xl leading-none text-fg active:opacity-80 disabled:opacity-40";

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1">
      <span id={labelId} className="text-sm text-fg-muted">
        {label}
      </span>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          className={buttonClass}
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => stepBy(-step)}
        >
          −
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border border-border bg-surface px-2">
          <input
            type="text"
            role="spinbutton"
            inputMode={decimals > 0 ? "decimal" : "numeric"}
            aria-labelledby={labelId}
            aria-valuenow={value}
            aria-valuemin={min}
            aria-valuemax={max === Number.MAX_SAFE_INTEGER ? undefined : max}
            aria-valuetext={unit ? `${value} ${unit}` : undefined}
            className="w-full min-w-0 bg-transparent text-center text-2xl font-semibold text-fg outline-none"
            value={draft ?? String(value)}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={commitDraft}
            onKeyDown={onKeyDown}
          />
          {unit && (
            <span aria-hidden="true" className="text-fg-muted">
              {unit}
            </span>
          )}
        </div>
        <button
          type="button"
          className={buttonClass}
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => stepBy(step)}
        >
          +
        </button>
      </div>
    </div>
  );
}

function decimalPlaces(n: number) {
  return (String(n).split(".")[1] ?? "").length;
}
