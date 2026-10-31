import { v7 } from "uuid";

/** A new UUIDv7: time-ordered, so ids sort by creation time (SPEC §3.2). */
export function newId(): string {
  return v7();
}
