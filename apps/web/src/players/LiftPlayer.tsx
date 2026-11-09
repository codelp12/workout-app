import {
  liftDetail,
  type LiftTargets,
  type SessionView,
} from "../plan/sessions";
import { PlanList } from "./PlanList";

/** Stand-in for the lift player (#51): the session's exercises and targets. */
export function LiftPlayer({ view }: { view: SessionView }) {
  const items = view.items.filter((i) => i.kind === "exercise");
  return (
    <PlanList
      label="Lift player"
      rows={items.map((item) => ({
        key: item.id,
        title:
          (item.exerciseId && view.exerciseNames.get(item.exerciseId)) ||
          "Pick an exercise",
        detail: liftDetail(item.targets as LiftTargets),
      }))}
      footer="Logging sets arrives with the lift player."
    />
  );
}
