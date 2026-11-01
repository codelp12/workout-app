import { Projects } from "../Projects";
import { ComingSoon, Screen } from "./Screen";

export function Today() {
  return (
    <Screen title="Today">
      <ComingSoon>
        Today&apos;s sessions, readiness check-in and coach note will show here.
      </ComingSoon>
      <Projects />
    </Screen>
  );
}
