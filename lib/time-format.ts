/** New-York-time formatters shared by chart UI and dialogs. */

const nyTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});

const nyDateTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});

/** Unix seconds → "HH:mm" in New York time. */
export function nyTime(unixSeconds: number): string {
  return nyTimeFmt.format(new Date(unixSeconds * 1000));
}

/** Unix seconds → "Sep 28, 14:30" in New York time. */
export function nyDateTime(unixSeconds: number): string {
  return nyDateTimeFmt.format(new Date(unixSeconds * 1000));
}
