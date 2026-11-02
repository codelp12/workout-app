import type {
  DistanceUnit,
  Equipment,
  Modality,
  Onboarding,
  WeekType,
  WeightUnit,
} from "@workout-app/shared";
import type { EngineConfig } from "./config.js";

/** Why the engine decided something (SPEC §5.0): a stable code plus plain English. */
export type Reason = { code: string; text: string };

export type Readiness = "green" | "yellow" | "red";

/** Everything a prescription may depend on besides the engine's own state. */
export type EngineContext = {
  /** The session's local date, `YYYY-MM-DD`. Engines never read the clock. */
  date: string;
  weekType: WeekType;
  /** Green until the check-in ships in Phase 5 (SPEC §5.5). */
  readiness: Readiness;
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  equipment: Equipment;
  config: EngineConfig;
};

/** A week's summary for the Sunday review (SPEC §5.5). */
export type WeekReview = { reasons: Reason[] };

/**
 * One modality's coach (SPEC §5.0). Every method is pure: the same inputs
 * always give the same output, and inputs are never mutated. Phase 1 ships
 * static stubs; the real engines replace them without UI changes.
 */
export interface ModalityEngine<State, Intent, Prescription, Log> {
  readonly modality: Modality;
  /** Stored with every decision, e.g. as `generatedBy: engine@<version>`. */
  readonly version: string;
  /** Starting state from the onboarding answers (SPEC §5.0 cold start). */
  initState(onboarding: Onboarding | null): State;
  prescribe(state: State, intent: Intent, ctx: EngineContext): Prescription;
  /** Fold one finished session into the state. */
  update(state: State, log: Log): State;
  reviewWeek(
    state: State,
    logs: readonly Log[],
    ctx: EngineContext,
  ): WeekReview;
}
