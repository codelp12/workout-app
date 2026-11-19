import {
  CHECKLIST_SESSION_TYPES,
  defaultChecklistId,
  libraryExerciseId,
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

function stretch(
  key: string,
  name: string,
  howTo: { sourceId: string; instruction?: string } | { instruction: string },
): ChecklistItem {
  return {
    id: `stretch-${key}`,
    name,
    detail: "20–30 s per side",
    ...("sourceId" in howTo && {
      exerciseId: libraryExerciseId("free-exercise-db", howTo.sourceId),
    }),
    ...(howTo.instruction && { instruction: howTo.instruction }),
  };
}

const PULL_STRETCHES = [
  stretch("lat", "Gentle lat stretch", { sourceId: "One_Arm_Against_Wall" }),
  stretch("cross-body", "Cross-body shoulder stretch", {
    sourceId: "Shoulder_Stretch",
  }),
  stretch("thoracic", "Thoracic rotation", {
    instruction:
      "Lie on your side with knees bent and arms out in front. Keep your knees together and gently open your top arm and upper back toward the floor behind you.",
  }),
];

const LEG_STRETCHES = [
  stretch("hip-flexor", "Runner’s lunge / hip-flexor stretch", {
    sourceId: "Kneeling_Hip_Flexor",
    instruction:
      "Kneel on one knee with the opposite foot flat in front. Keep your torso upright and gently shift your weight forward until you feel a stretch at the front of your rear hip.",
  }),
  stretch("calf", "Calf stretch", {
    sourceId: "Calf_Stretch_Hands_Against_Wall",
    instruction:
      "Stand facing a wall with your hands against it and one foot behind you. Bend your front knee and lean in gently, keeping your back heel down.",
  }),
  stretch("hamstring", "Gentle hamstring stretch", {
    sourceId: "Hamstring_Stretch",
    instruction:
      "Lie on your back and loop a strap or band over one foot. Gently raise that leg until you feel a stretch behind your thigh. Keep the other leg on the floor.",
  }),
];

/** Optional post-session stretches from the owner's training program (#122). */
const DEFAULT_STRETCHES: Record<ChecklistSessionType, ChecklistItem[]> = {
  push: [
    stretch("doorway", "Doorway chest stretch", {
      instruction:
        "Rest a forearm on the doorframe with your elbow bent. Step forward gently until you feel a stretch across your chest.",
    }),
    stretch("shoulder", "Gentle shoulder stretch", {
      sourceId: "Shoulder_Stretch",
    }),
  ],
  pull: PULL_STRETCHES,
  climb: PULL_STRETCHES,
  run: LEG_STRETCHES,
  legs: LEG_STRETCHES,
};

function checklistRows(
  kind: ChecklistKind,
  itemsFor: (type: ChecklistSessionType) => ChecklistItem[],
): DefaultChecklistData[] {
  return CHECKLIST_SESSION_TYPES.map((sessionType) => ({
    id: defaultChecklistId(kind, sessionType),
    kind,
    sessionType,
    items: itemsFor(sessionType),
  }));
}

/** The default checklists as rows, with the same ids on every server. */
export function defaultChecklists(): DefaultChecklistData[] {
  return [
    ...checklistRows("warmup", (type) =>
      DEFAULT_WARMUPS[type].map(([id, name, detail]) => ({ id, name, detail })),
    ),
    ...checklistRows("stretch", (type) => DEFAULT_STRETCHES[type]),
  ];
}
