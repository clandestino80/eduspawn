/** UTC calendar date for `UserGenerationUsageDaily.usageDate` (@db.Date). */
export function utcUsageDateForNow(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** `YYYY-MM` for `UserCreatorUsageMonthly.periodMonth`. */
export function currentUtcPeriodMonth(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
