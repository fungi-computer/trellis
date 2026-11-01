import cronstrue from "cronstrue";
import * as Cron from "effect/Cron";
import * as Result from "effect/Result";

const weekdays = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];

const unrestricted = (field: ReadonlySet<number>, size: number) =>
  field.size === 0 || field.size === size;

/** Only phrase common cases; Effect owns cron syntax and normalized fields. */
function commonCadence(cron: Cron.Cron): string | undefined {
  if (
    cron.days.size !== 0 ||
    cron.months.size !== 0 ||
    cron.seconds.size !== 1 ||
    !cron.seconds.has(0) ||
    cron.minutes.size !== 1
  )
    return undefined;
  const minute = [...cron.minutes][0];
  const hour = cron.hours.size === 1 ? [...cron.hours][0] : undefined;
  const everyDay = unrestricted(cron.weekdays, 7);
  if (unrestricted(cron.hours, 24) && minute === 0 && everyDay)
    return "Every hour";
  if (hour === undefined) return undefined;
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (everyDay) return `Every day at ${time}`;
  if (
    cron.weekdays.size === 5 &&
    [1, 2, 3, 4, 5].every((day) => cron.weekdays.has(day))
  )
    return `Weekdays at ${time}`;
  if (cron.weekdays.size === 1) {
    const day = [...cron.weekdays][0];
    return `${weekdays[day]} at ${time}`;
  }
  return undefined;
}

/** Schedules and Triggers share one wording owner, not a second cron parser. */
export function cadenceWords(expression: string): string {
  const parsed = Cron.parse(expression);
  if (Result.isFailure(parsed)) return "Custom schedule";
  const common = commonCadence(parsed.success);
  if (common !== undefined) return common;
  try {
    return cronstrue.toString(expression, {
      use24HourTimeFormat: true,
      verbose: false,
      throwExceptionOnParseError: true,
    });
  } catch {
    return "Custom schedule";
  }
}

/** Schedule presets share their labels with the published trigger summary. */
export const scheduleChoices = [
  "0 * * * *",
  "0 9 * * *",
  "0 9 * * 1-5",
  "0 9 * * 1",
].map((expression) => ({ expression, label: cadenceWords(expression) }));

export function scheduleSummary(cron: {
  expression: string;
  timeZone: string;
}) {
  return `${cadenceWords(cron.expression)} · ${cron.timeZone}`;
}
