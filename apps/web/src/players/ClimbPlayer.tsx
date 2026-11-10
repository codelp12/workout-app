import {
  formatRange,
  type ClimbTargets,
  type SessionView,
} from "../plan/sessions";
import { PlanList } from "./PlanList";

/** Stand-in for climb logging (#58): the session's grade targets. */
export function ClimbPlayer({ view }: { view: SessionView }) {
  return (
    <PlanList
      label="Climb player"
      rows={view.items.map((item) => {
        const climb = item.targets as ClimbTargets;
        return {
          key: item.id,
          title: climb.grades ? formatRange(climb.grades) : "Grades by feel",
          detail: [
            `${formatRange(climb.problems)} problems`,
            climb.maxHardAttempts !== null &&
              `up to ${climb.maxHardAttempts} hard attempts`,
          ]
            .filter(Boolean)
            .join(" · "),
        };
      })}
      footer="Logging climbs arrives with climb logging."
    />
  );
}
