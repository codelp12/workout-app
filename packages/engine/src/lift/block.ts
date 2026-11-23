import {
  addDays,
  daysBetween,
  type Exercise,
  type TemplateSlot,
  type Weight,
  type WeekType,
} from "@workout-app/shared";
import type { EngineConfig } from "../config.js";
import { roundToLoadable } from "../loads.js";
import { implementOf, topSet, type LiftExercise } from "../stubs/lift.js";
import type { EngineContext, Reason } from "../types.js";
import { formatAmount, toWeightUnit } from "../units.js";
import { modelOf, type SlotScheme } from "./progression.js";
import type { ExerciseState, LiftEngineState } from "./state.js";

type Lift = EngineConfig["lift"];

/** Where a week sits on the global calendar (SPEC §5.1, §5.4). */
export type BlockPosition = {
  /** The block's first Monday. */
  startDate: string;
  /** 0-based. */
  index: number;
  weekCount: number;
  type: WeekType;
  /** Whether stalls pulled this week's deload forward. */
  earlyDeload: boolean;
};

/** The block's loading weeks: all but the closing deload. */
export const loadingWeeksOf = (weekCount: number) =>
  weekCount > 1 ? weekCount - 1 : weekCount;

/**
 * Main-lift target RIR in loading week `index` (§5.1): 3 → 2 → 1 over three
 * loading weeks, the same range spread over longer blocks (3, 2, 2, 1, 1).
 */
export function blockRir(
  index: number,
  loadingWeeks: number,
  config: Lift["block"],
): number {
  const { rirStart, rirEnd } = config;
  if (loadingWeeks <= 1) return rirStart;
  const progress = Math.min(index, loadingWeeks - 1) / (loadingWeeks - 1);
  return rirStart - Math.round((rirStart - rirEnd) * progress);
}

/** A slot's sets and RIR for this week of the block. */
export type WeekScheme = SlotScheme & {
  /** Sets a `ramp` slot wants on top of `sets`, before the weekly cap. */
  rampSets: number;
  /** Whether that's one more than last week, after its targets were met. */
  rampGained: boolean;
  reasons: Reason[];
};

const MET = new Set(["top", "beat", "done"]);

/**
 * A slot's scheme for its week of the block (§5.1 Block structure). Deload
 * weeks halve the sets (rounded up) at 3+ RIR. Loading weeks step main lifts'
 * (`e1rm_rir`) RIR down the block, and `ramp` slots gain a set in weeks 2
 * and 3 when the exercise's last exposure this block logged every prescribed
 * set and met its targets; otherwise they keep the sets already earned.
 */
export function weekScheme(
  slot: Pick<TemplateSlot, "sets" | "repMin" | "repMax" | "targetRir" | "ramp">,
  exercise: Pick<Exercise, "progressionModel"> | null,
  state: ExerciseState | undefined,
  position: BlockPosition,
  ctx: EngineContext,
): WeekScheme {
  const config = ctx.config.lift.block;
  const base = {
    sets: slot.sets,
    repMin: slot.repMin,
    repMax: slot.repMax,
    targetRir: slot.targetRir,
  };
  if (position.type === "deload") {
    const sets = Math.ceil(slot.sets * config.deloadSets);
    const targetRir =
      slot.targetRir === null
        ? null
        : Math.max(slot.targetRir, config.deloadMinRir);
    return {
      ...base,
      sets,
      targetRir,
      rampSets: 0,
      rampGained: false,
      reasons: [
        {
          code: position.earlyDeload ? "early_deload" : "deload",
          text: `${position.earlyDeload ? "Early deload, as main lifts stalled this block" : "Deload week"}: ${sets} of ${slot.sets} sets${targetRir === null ? "" : ` at ${targetRir}+ RIR`}.`,
        },
      ],
    };
  }

  const reasons: Reason[] = [];
  let targetRir = slot.targetRir;
  if (
    exercise !== null &&
    modelOf(exercise) === "e1rm_rir" &&
    slot.targetRir !== null
  ) {
    targetRir = blockRir(
      position.index,
      loadingWeeksOf(position.weekCount),
      config,
    );
    reasons.push({
      code: "block_rir",
      text: `Week ${position.index + 1} of ${position.weekCount}: main lifts at ${targetRir} RIR.`,
    });
  }

  let rampSets = 0;
  let rampGained = false;
  const last = state?.exposures.at(-1);
  if (
    slot.ramp &&
    position.index > 0 &&
    last?.source === "log" &&
    last.target &&
    last.date >= position.startDate
  ) {
    const earned = Math.min(
      Math.max(last.target.sets - slot.sets, 0),
      config.rampWeeks,
    );
    rampGained =
      position.index <= config.rampWeeks &&
      earned < position.index &&
      last.sets.length >= last.target.sets &&
      MET.has(state?.lastOutcome ?? "");
    rampSets = earned + (rampGained ? 1 : 0);
  }
  return { ...base, targetRir, rampSets, rampGained, reasons };
}

/** One lift item's sets for the weekly hard-set cap, in week order. */
export type RampRequest = {
  muscles: readonly string[];
  sets: number;
  rampSets: number;
};

/**
 * The ramp sets each item may add without pushing any primary muscle's
 * weekly hard sets past the cap (§5.1). Template sets always count in full;
 * ramp sets are granted in week order. `cappedBy` names the muscle that
 * held an item back.
 */
export function capRampSets(
  requests: readonly RampRequest[],
  cap: number,
): { rampSets: number; cappedBy: string | null }[] {
  const totals = new Map<string, number>();
  const add = (muscle: string, sets: number) =>
    totals.set(muscle, (totals.get(muscle) ?? 0) + sets);
  for (const r of requests) for (const m of r.muscles) add(m, r.sets);
  return requests.map((r) => {
    let allowed = r.rampSets;
    let cappedBy: string | null = null;
    for (const m of r.muscles) {
      const room = Math.max(cap - (totals.get(m) ?? 0), 0);
      if (room < allowed) {
        allowed = room;
        cappedBy = m;
      }
    }
    for (const m of r.muscles) add(m, allowed);
    return { rampSets: allowed, cappedBy };
  });
}

/** The reason for a ramp slot's set count once the cap has had its say. */
export function rampReason(
  scheme: Pick<WeekScheme, "sets" | "rampSets" | "rampGained">,
  granted: { rampSets: number; cappedBy: string | null },
  cap: number,
): Reason | null {
  const sets = scheme.sets + granted.rampSets;
  if (granted.cappedBy !== null) {
    return {
      code: "hard_set_cap",
      text: `${sets} sets: ${granted.cappedBy} is at its cap of ${cap} hard sets this week.`,
    };
  }
  if (granted.rampSets === 0) return null;
  return scheme.rampGained
    ? {
        code: "ramp_set",
        text: `Met last week's targets, so ${sets} sets this week.`,
      }
    : {
        code: "ramp_hold",
        text: `${sets} sets again until last week's targets are met.`,
      };
}

/**
 * Main lifts (`e1rm_rir`) that stalled on or after `from` and before `to`,
 * for the early deload (§5.1 Rules).
 */
export function stalledMainLifts(
  state: LiftEngineState,
  exercises: readonly Pick<Exercise, "id" | "progressionModel">[],
  from: string,
  to: string,
): number {
  return exercises.filter((e) => {
    const stall = state.exercises[e.id]?.lastStallDate ?? null;
    return (
      modelOf(e) === "e1rm_rir" && stall !== null && stall >= from && stall < to
    );
  }).length;
}

/**
 * The load an exercise logged in the block's first week, for the deload
 * (§5.1): its planned target, else its top set. Null when no exposure from
 * that week is still kept.
 */
export function weekOneLoad(
  state: ExerciseState | undefined,
  blockStart: string,
): Weight | null {
  const end = addDays(blockStart, 7);
  const exposure = state?.exposures.find(
    (e) => e.source === "log" && e.date >= blockStart && e.date < end,
  );
  if (!exposure) return null;
  return exposure.target?.load ?? topSet(exposure.sets)?.load ?? null;
}

/**
 * `load` × `factor`, in the context's unit, rounded to the nearest load the
 * equipment can make, and lighter than `load` whenever the equipment allows.
 */
export function scaleLoad(
  load: Weight,
  factor: number,
  exercise: LiftExercise | null,
  ctx: EngineContext,
): Weight {
  const from = toWeightUnit(load, ctx.weightUnit);
  const target = from * factor;
  const implement = implementOf(exercise);
  if (implement === null) {
    return { value: Math.round(target), unit: ctx.weightUnit };
  }
  const usable =
    implement === "barbell" &&
    ctx.equipment.barbells.length === 0 &&
    ctx.equipment.bar !== null
      ? "bar"
      : implement;
  const nearest = roundToLoadable(ctx.equipment, usable, target);
  const value =
    nearest !== null && nearest < from - 1e-6
      ? nearest
      : (roundToLoadable(ctx.equipment, usable, from - 0.001, "down") ??
        nearest ??
        from);
  return { value, unit: ctx.weightUnit };
}

export type Reentry = { cut: number; reason: Reason };

/**
 * Layoff re-entry for a lift session on `date` (§5.1 Rules), from the dates
 * of earlier lift sessions. 7–13 days since the last one cuts the first
 * session back; 14+ days cuts every session for a week from it.
 */
export function layoffReentry(
  sessionDates: readonly string[],
  date: string,
  config: Lift["layoff"],
): Reentry | null {
  const before = [...new Set(sessionDates)].filter((d) => d < date).sort();
  const last = before.at(-1);
  if (last === undefined) return null;
  const gap = daysBetween(last, date);
  const pct = (cut: number) => `${Math.round(cut * 1000) / 10}%`;
  if (gap >= config.longDays) {
    return {
      cut: config.longCut,
      reason: {
        code: "layoff_long",
        text: `${gap} days since your last lift: ${pct(config.longCut)} lighter for your first week back.`,
      },
    };
  }
  if (gap >= config.shortDays) {
    return {
      cut: config.shortCut,
      reason: {
        code: "layoff_short",
        text: `${gap} days since your last lift: ${pct(config.shortCut)} lighter for this session.`,
      },
    };
  }
  let comeback: string | null = null;
  for (let i = 1; i < before.length; i++) {
    if (daysBetween(before[i - 1]!, before[i]!) >= config.longDays) {
      comeback = before[i]!;
    }
  }
  if (comeback !== null && daysBetween(comeback, date) < config.longCutDays) {
    return {
      cut: config.longCut,
      reason: {
        code: "layoff_long",
        text: `First week back since ${comeback}: ${pct(config.longCut)} lighter.`,
      },
    };
  }
  return null;
}

/** Formats a load for a reason. */
export const describeLoad = (load: Weight) =>
  formatAmount(load.value, load.unit);
