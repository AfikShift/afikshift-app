import { LocalShift } from "@/src/shifts/provider";
import { DutyType, addDays, interval, parseISODate, toISODate } from "@/src/shifts/calc";

const pence = (v: number | null | undefined) => Math.round((v ?? 0) * 100);

/**
 * The single set of earnings rules used by Home, Earnings, History and exported reports, so every
 * screen and report shows matching totals:
 * - only non-deleted shifts dated within [from, to] count (deleted ones live in Recently Deleted);
 * - earned figures (hours, estimated, received, outstanding) use completed shifts only;
 * - booked shifts are "projected", never earned; cancelled shifts count towards nothing;
 * - received uses counted payments (edit clashes counted once, flagged provisional);
 * - outstanding ignores overpayments; all sums use whole pence.
 */
export function summarise(shifts: LocalShift[], from?: string, to?: string) {
  const inRange = shifts.filter((s) => !s.deleted && (!from || s.date >= from) && (!to || s.date <= to));
  const done = inRange.filter((s) => s.status === "completed");
  const booked = inRange.filter((s) => s.status === "booked");
  const sum = (arr: LocalShift[], f: (s: LocalShift) => number | null | undefined) => arr.reduce((a, s) => a + pence(f(s)), 0) / 100;
  const duties: DutyType[] = [...new Set(done.map((s) => s.duty_type))].sort();
  return {
    shifts: inRange.length,
    completed: done.length,
    cancelled: inRange.filter((s) => s.status === "cancelled").length,
    hours: sum(done, (s) => s.payable_hours),
    estimated: sum(done, (s) => s.estimated_earnings),
    received: sum(done, (s) => s.amount_received),
    outstanding: sum(done, (s) => Math.max(s.outstanding ?? 0, 0)),
    booked: booked.length,
    projected: sum(booked, (s) => s.estimated_earnings),
    missingRate: done.some((s) => s.hourly_rate == null),
    provisional: inRange.filter((s) => s.payment_clash).length,
    byDuty: duties.map((d) => {
      const ds = done.filter((s) => s.duty_type === d);
      return { duty: d, count: ds.length, hours: sum(ds, (s) => s.payable_hours), estimated: sum(ds, (s) => s.estimated_earnings), received: sum(ds, (s) => s.amount_received) };
    }),
  };
}

export type Totals = ReturnType<typeof summarise>;

export function monthStats(shifts: LocalShift[], ym: string) {
  return summarise(shifts, `${ym}-01`, `${ym}-31`);
}

export type PeriodKind = "week" | "month" | "year";

/** Inclusive date range + label for the week (Mon–Sun), month or year containing `anchor`. */
export function periodRange(kind: PeriodKind, anchor: string) {
  const d = parseISODate(anchor);
  if (kind === "week") {
    const from = addDays(anchor, -((d.getDay() + 6) % 7));
    const to = addDays(from, 6);
    const f = (iso: string) => parseISODate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return { from, to, label: `${f(from)} – ${f(to)} ${to.slice(0, 4)}` };
  }
  if (kind === "month") {
    const from = toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
    const to = toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    return { from, to, label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) };
  }
  return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31`, label: String(d.getFullYear()) };
}

export function stepPeriod(kind: PeriodKind, anchor: string, dir: 1 | -1) {
  const d = parseISODate(anchor);
  if (kind === "week") return addDays(anchor, 7 * dir);
  if (kind === "month") return toISODate(new Date(d.getFullYear(), d.getMonth() + dir, 1));
  return toISODate(new Date(d.getFullYear() + dir, 0, 1));
}

/** Next booked shift that hasn't finished yet. */
export function nextShift(shifts: LocalShift[], now = Date.now()) {
  return shifts.filter((s) => s.status === "booked" && interval(s).end > now).sort((a, b) => interval(a).start - interval(b).start)[0];
}
