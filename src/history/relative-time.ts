const relativeTime = new Intl.RelativeTimeFormat("en", {
  style: "narrow",
  numeric: "auto",
});

/** Version labels use elapsed time; persisted commit timestamps stay unchanged. */
export function versionRelativeTime(createdAt: string, now = Date.now()) {
  const seconds = (new Date(createdAt).getTime() - now) / 1000;
  const elapsed = Math.abs(seconds);
  if (elapsed >= 86400)
    return relativeTime.format(Math.trunc(seconds / 86400), "day");
  if (elapsed >= 3600)
    return relativeTime.format(Math.trunc(seconds / 3600), "hour");
  if (elapsed >= 60)
    return relativeTime.format(Math.trunc(seconds / 60), "minute");
  return relativeTime.format(Math.trunc(seconds), "second");
}
