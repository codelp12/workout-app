import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

/** Re-runs `query` whenever the IndexedDB data it read changes. Pass a stable function. */
export function useLiveQuery<T>(query: () => Promise<T>, initial: T): T {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({
      next: setValue,
      error: (error: unknown) => console.error(error),
    });
    return () => sub.unsubscribe();
  }, [query]);
  return value;
}
