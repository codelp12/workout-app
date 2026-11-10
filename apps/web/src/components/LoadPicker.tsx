import { formatAmount } from "@workout-app/engine";
import { useId, useState } from "react";
import { BottomSheet } from "./BottomSheet";

type LoadPickerProps = {
  /** Visible label, also used to name the buttons ("Increase Weight"). */
  label: string;
  value: number;
  /** Every load on offer, lightest first. `value` should be one of them. */
  options: readonly number[];
  unit: string;
  onValueChange: (value: number) => void;
};

const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * A weight that can only be one of `options`: − and + step to the next
 * lighter or heavier load, and tapping the weight opens a sheet listing them
 * all. Unlike the {@link Stepper} there's no typing, so it never shows a load
 * the equipment can't make (SPEC §6.3).
 */
export function LoadPicker({
  label,
  value,
  options,
  unit,
  onValueChange,
}: LoadPickerProps) {
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const index = options.findIndex((option) => same(option, value));
  const lighter = index > 0 ? options[index - 1] : undefined;
  const heavier =
    index >= 0 && index < options.length - 1 ? options[index + 1] : undefined;
  const text = formatAmount(value, unit);

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
          disabled={lighter === undefined}
          onClick={() => lighter !== undefined && onValueChange(lighter)}
        >
          −
        </button>
        <BottomSheet
          title={`Pick a ${label.toLowerCase()}`}
          open={open}
          onOpenChange={setOpen}
          trigger={
            <button
              type="button"
              aria-label={`${label}: ${text}`}
              className="min-h-tap min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-2xl font-semibold text-fg tabular-nums active:opacity-80"
            >
              {text}
            </button>
          }
        >
          <ul
            aria-label={`${label} options`}
            className="grid grid-cols-4 gap-2"
          >
            {options.map((option) => {
              const selected = same(option, value);
              return (
                <li key={option}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    ref={
                      selected
                        ? (el) => el?.scrollIntoView?.({ block: "center" })
                        : undefined
                    }
                    className="min-h-tap w-full rounded-lg bg-surface-raised px-2 font-medium text-fg tabular-nums active:opacity-80 aria-pressed:bg-lift aria-pressed:text-bg"
                    onClick={() => {
                      if (!selected) onValueChange(option);
                      setOpen(false);
                    }}
                  >
                    {formatAmount(option, unit)}
                  </button>
                </li>
              );
            })}
          </ul>
        </BottomSheet>
        <button
          type="button"
          className={buttonClass}
          aria-label={`Increase ${label}`}
          disabled={heavier === undefined}
          onClick={() => heavier !== undefined && onValueChange(heavier)}
        >
          +
        </button>
      </div>
    </div>
  );
}
