import { localDb } from "../sync";
import { useLiveQuery } from "../use-live-query";
import { ComingSoon, Screen } from "./Screen";

const exerciseCount = () =>
  localDb
    .rows("exercise")
    .filter((e) => e.deletedAt === null)
    .count();

export function Library() {
  const count = useLiveQuery(exerciseCount, 0);
  return (
    <Screen title="Library">
      <ComingSoon>
        {count > 0
          ? `${count} exercises are on this device. Browsing them arrives soon.`
          : "The exercise library downloads the first time you sync."}
      </ComingSoon>
    </Screen>
  );
}
