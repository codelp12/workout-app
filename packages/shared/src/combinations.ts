import {
  combineOverrideDataSchema,
  type PlanOverride,
  type PlannedSession,
  type SessionLog,
  type SetLog,
} from "./entities.js";

/** Active pairs, keyed by the plan that owns the shared log. */
export function liftCombinations(
  overrides: readonly PlanOverride[],
  plans: readonly PlannedSession[],
  logs: readonly SessionLog[],
  sets: readonly Pick<SetLog, "sessionLogId" | "deletedAt">[],
): Map<string, string> {
  const lifts = new Map(
    plans
      .filter(
        (p) =>
          p.deletedAt === null &&
          p.modality === "lift" &&
          (p.status === "planned" || p.status === "done"),
      )
      .map((p) => [p.id, p]),
  );
  const liveLogs = logs.filter((l) => l.deletedAt === null);
  const withSets = new Set(
    sets.filter((s) => s.deletedAt === null).map((s) => s.sessionLogId),
  );
  const logged = new Set(
    liveLogs
      .filter((l) => l.endedAt !== null || withSets.has(l.id))
      .map((l) => l.plannedSessionId),
  );
  const finished = new Set(
    liveLogs.filter((l) => l.endedAt !== null).map((l) => l.plannedSessionId),
  );
  const used = new Set<string>();
  const pairs = new Map<string, string>();
  const merges = overrides
    .filter(
      (o) =>
        o.kind === "combine" && o.deletedAt === null && o.supersededAt === null,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  for (const { plannedSessionId: primary, data } of merges) {
    const parsed = combineOverrideDataSchema.safeParse(data);
    if (!parsed.success || primary === null || !lifts.has(primary)) continue;
    const other = parsed.data.otherSessionId;
    if (
      other === primary ||
      lifts.get(other)?.status !== "planned" ||
      (logged.has(other) && !finished.has(primary)) ||
      used.has(primary) ||
      used.has(other)
    )
      continue;
    pairs.set(primary, other);
    used.add(primary);
    used.add(other);
  }
  return pairs;
}
