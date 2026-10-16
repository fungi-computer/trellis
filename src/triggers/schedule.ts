/** Schedule presets share their labels with the published trigger summary. */
export const scheduleChoices = [
  { expression: "0 * * * *", label: "Every hour" },
  { expression: "0 9 * * *", label: "Every day at 09:00" },
  { expression: "0 9 * * 1-5", label: "Weekdays at 09:00" },
  { expression: "0 9 * * 1", label: "Every Monday at 09:00" },
];

export function scheduleSummary(cron: {
  expression: string;
  timeZone: string;
}) {
  const label =
    scheduleChoices.find((choice) => choice.expression === cron.expression)
      ?.label ?? "Custom schedule";
  return `${label} · ${cron.timeZone}`;
}
