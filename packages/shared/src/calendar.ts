/**
 * Local calendar dates as `YYYY-MM-DD` (SPEC §3.2). Day arithmetic runs on
 * UTC midnights, so daylight-saving changes never shift a date.
 */

const MS_PER_DAY = 86_400_000;

function parse(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d);
}

const format = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The date at `now` in an IANA zone; UTC if the zone is unknown. */
export function localDateAt(timezone: string, now: number): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
  } catch (error) {
    if (error instanceof RangeError) return format(now);
    throw error;
  }
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export const addDays = (date: string, days: number): string =>
  format(parse(date) + days * MS_PER_DAY);

/** Whole days from `from` to `to`; negative if `to` is earlier. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((parse(to) - parse(from)) / MS_PER_DAY);

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (date: string): number =>
  ((new Date(parse(date)).getUTCDay() + 6) % 7) + 1;

/** The Monday of the week `date` falls in; weeks run Monday to Sunday (SPEC §2). */
export const weekStartOf = (date: string): string =>
  addDays(date, 1 - isoWeekday(date));
