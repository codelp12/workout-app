import {
  defaultChecklistId,
  type ChecklistItem,
  type ChecklistKind,
  type ChecklistSessionType,
} from "@workout-app/shared";

export type DefaultChecklistData = {
  id: string;
  kind: ChecklistKind;
  sessionType: ChecklistSessionType;
  items: ChecklistItem[];
};

type Item = [id: string, name: string, detail: string | null];

const PULL: Item[] = [
  ["easy-movement", "Easy general movement", "3–5 min"],
  ["thoracic-rotations", "Thoracic rotations", "6–8 per side"],
  [
    "shoulder-blades",
    "Shoulder circles and shoulder-blade protraction/retraction",
    "8–10",
  ],
];

/** Pre-session warm-ups from the owner's weekly training program (#121). */
const DEFAULT_WARMUPS: Record<ChecklistSessionType, Item[]> = {
  run: [
    ["easy-jog", "Easy walking or jogging, building pace", "5–8 min"],
    ["ankle-rocks", "Ankle rocks or knee-to-wall", "8–10 per side"],
    [
      "leg-swings",
      "Leg swings, front-to-back and side-to-side",
      "8–10 each way",
    ],
    ["lunges", "Relaxed walking lunges or marching steps", "a few"],
  ],
  push: [
    ["arm-circles", "Arm circles", "10 each direction"],
    ["wall-slides", "Shoulder-blade movements and wall slides", "8–10"],
    ["practice-sets", "Light practice sets of the first press", "a few"],
  ],
  pull: PULL,
  climb: [
    ...PULL,
    ["easy-climbs", "Easy routes or holds", "before harder attempts"],
  ],
  legs: [
    ["easy-movement", "Easy movement", "3–5 min"],
    ["ankle-rocks", "Ankle rocks", "8–10 per side"],
    ["hip-hinges", "Unweighted hip hinges", "8–10"],
    ["split-squats", "Bodyweight split squats", "5–6 per side"],
    ["ramp-up-sets", "Lighter ramp-up sets of the first lift", null],
  ],
};

/** The default checklists as rows, with the same ids on every server. */
export function defaultChecklists(): DefaultChecklistData[] {
  return Object.entries(DEFAULT_WARMUPS).map(([sessionType, items]) => ({
    id: defaultChecklistId("warmup", sessionType),
    kind: "warmup",
    sessionType: sessionType as ChecklistSessionType,
    items: items.map(([id, name, detail]) => ({ id, name, detail })),
  }));
}
