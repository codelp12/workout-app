import * as ToggleGroup from "@radix-ui/react-toggle-group";
import type { Modality } from "@workout-app/shared";
import { useId, type ReactNode } from "react";
import { modalityStyles } from "../modality";

type ChipOption<T extends string> = { value: T; label: ReactNode };

type Common<T extends string> = {
  /** Accessible name of the group, e.g. "Reps in reserve". */
  label: string;
  /** Show the label above the chips, for groups with no heading of their own. */
  showLabel?: boolean;
  options: readonly ChipOption<T>[];
  /** Color selected chips in this modality's color instead of the accent. */
  modality?: Modality;
  disabled?: boolean;
};

type ChipGroupProps<T extends string> = Common<T> &
  (
    | {
        type: "single";
        value: T | undefined;
        onValueChange: (value: T) => void;
      }
    | {
        type: "multiple";
        value: readonly T[];
        onValueChange: (value: T[]) => void;
      }
  );

const chip =
  "min-h-tap min-w-tap rounded-full bg-surface-raised px-4 font-medium text-fg active:opacity-80 disabled:opacity-40 data-[state=on]:bg-accent data-[state=on]:text-bg";

/**
 * A row of toggle chips (grades, RIR, filters). Single mode is a radio group:
 * arrow keys move between chips and tapping the selected chip keeps it
 * selected. Multiple mode toggles each chip on and off.
 */
export function ChipGroup<T extends string>(props: ChipGroupProps<T>) {
  const { label, showLabel, options, modality, disabled } = props;
  const labelId = useId();
  const name = showLabel
    ? { "aria-labelledby": labelId }
    : { "aria-label": label };
  const items = options.map((option) => (
    <ToggleGroup.Item
      key={option.value}
      value={option.value}
      className={
        modality ? `${chip} ${modalityStyles[modality].selected}` : chip
      }
    >
      {option.label}
    </ToggleGroup.Item>
  ));
  const rootClass = "flex flex-wrap gap-2";

  const labelled = (group: ReactNode) =>
    showLabel ? (
      <div className="flex flex-col gap-1">
        <span id={labelId} className="text-sm text-fg-muted">
          {label}
        </span>
        {group}
      </div>
    ) : (
      group
    );

  if (props.type === "single") {
    return labelled(
      <ToggleGroup.Root
        type="single"
        {...name}
        className={rootClass}
        disabled={disabled}
        value={props.value ?? ""}
        onValueChange={(next) => {
          // Radix clears the value when the selected chip is tapped again.
          if (next) props.onValueChange(next as T);
        }}
      >
        {items}
      </ToggleGroup.Root>,
    );
  }
  return labelled(
    <ToggleGroup.Root
      type="multiple"
      {...name}
      className={rootClass}
      disabled={disabled}
      value={[...props.value]}
      onValueChange={(next) => props.onValueChange(next as T[])}
    >
      {items}
    </ToggleGroup.Root>,
  );
}
