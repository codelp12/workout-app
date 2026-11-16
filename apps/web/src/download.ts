/** Saves `text` as a file called `name`. */
export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Safari may still be reading the blob when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** `2026-11-16T19-08-20-123Z`, safe in a file name. */
export const fileStamp = (now: number) =>
  new Date(now).toISOString().replace(/[:.]/g, "-");
