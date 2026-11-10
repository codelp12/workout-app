import { formatAmount } from "@workout-app/engine";
import {
  formatRange,
  type RunTargets,
  type SessionView,
} from "../plan/sessions";
import { PlanList } from "./PlanList";

/** Stand-in for run logging (#57): the run's targets. */
export function RunPlayer({ view }: { view: SessionView }) {
  return (
    <PlanList
      label="Run player"
      rows={view.items.map((item) => {
        const run = item.targets as RunTargets;
        return {
          key: item.id,
          title: run.distance
            ? formatAmount(run.distance.value, run.distance.unit)
            : "Distance by feel",
          detail: `Target RPE ${formatRange(run.targetRpe)}`,
        };
      })}
      footer="Logging runs arrives with run logging."
    />
  );
}
