import type { Modality } from "@workout-app/shared";

type ModalityStyle = {
  label: string;
  /** Text in the modality's color. */
  text: string;
  /** Solid fill with readable text on top. */
  fill: string;
  /** Left accent bar for cards and list rows. */
  accent: string;
  /** Fill for a selected chip (`data-state=on`). */
  selected: string;
};

// Full class names, so Tailwind finds them when it scans the source.
export const modalityStyles: Record<Modality, ModalityStyle> = {
  lift: {
    label: "Lifting",
    text: "text-lift",
    fill: "bg-lift text-bg",
    accent: "border-l-4 border-lift",
    selected: "data-[state=on]:bg-lift data-[state=on]:text-bg",
  },
  run: {
    label: "Running",
    text: "text-run",
    fill: "bg-run text-bg",
    accent: "border-l-4 border-run",
    selected: "data-[state=on]:bg-run data-[state=on]:text-bg",
  },
  climb: {
    label: "Climbing",
    text: "text-climb",
    fill: "bg-climb text-bg",
    accent: "border-l-4 border-climb",
    selected: "data-[state=on]:bg-climb data-[state=on]:text-bg",
  },
  mobility: {
    label: "Mobility",
    text: "text-mobility",
    fill: "bg-mobility text-bg",
    accent: "border-l-4 border-mobility",
    selected: "data-[state=on]:bg-mobility data-[state=on]:text-bg",
  },
};
