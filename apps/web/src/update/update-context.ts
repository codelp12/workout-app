import { createContext, useContext } from "react";

export type UpdateStatus =
  /** No service worker (dev server, unsupported browser). */
  "unsupported" | "idle" | "checking" | "current" | "available" | "failed";

export type AppUpdate = {
  status: UpdateStatus;
  /** Asks the server for a newer build. */
  check: () => void;
  /** Activates the waiting build and reloads the page. */
  install: () => void;
};

export const UpdateContext = createContext<AppUpdate>({
  status: "unsupported",
  check: () => {},
  install: () => {},
});

/** The app update state from the nearest `UpdateProvider`. */
export const useAppUpdate = () => useContext(UpdateContext);
