import { ImportUnsynced } from "../UnsyncedData";
import { ComingSoon, Screen } from "./Screen";

export function Settings() {
  return (
    <Screen title="Settings">
      <ComingSoon>
        Units, equipment, schedule and backups will be set here.
      </ComingSoon>
      <ImportUnsynced />
    </Screen>
  );
}
