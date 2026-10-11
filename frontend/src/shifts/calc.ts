// Pure shift calculations — shared by the form, dashboard and calendar.
export type DutyType = "bed_watch" | "constant_watch" | "other";
export type ShiftPeriod = "day" | "night";
export type ShiftStatus = "booked" | "completed" | "cancelled";
export type PaymentStatus = "pending" | "partially_paid" | "paid";

export type ShiftData = {
  officer_name: string;
  duty_type: DutyType;
  shift_period: ShiftPeriod;
  date: string; // YYYY-MM-DD (start date)
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  break_minutes: number;
  location: string;
  status: ShiftStatus;
  payment_status: PaymentStatus;
  hourly_rate: number | null;
};

export const DUTY_LABEL: Record<DutyType, string> = {
  bed_watch: "Bed Watch",
  constant_watch: "Constant Watch",
  other: "Other PP",
};
export const STATUS_LABEL: Record<ShiftStatus, string> = { booked: "Booked", completed: "Completed", cancelled: "Cancelled" };
export const PAYMENT_LABEL: Record<PaymentStatus, string> = { pending: "Pending", partially_paid: "Partially paid", paid: "Paid" };

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRISONER_NO_RE = /\b[A-Za-z]\d{4}[A-Za-z]{2}\b/;

export function toMinutes(t: string) {
  return parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10);
}

/** Shift length in minutes; finish at or before start means the shift crosses midnight. */
export function durationMinutes(start: string, end: string) {
  const s = toMinutes(start);
  const e = toMinutes(end);
  return e > s ? e - s : e + 1440 - s;
}

export function crossesMidnight(start: string, end: string) {
  return toMinutes(end) <= toMinutes(start);
}

export function payableHours(start: string, end: string, breakMin: number) {
  return Math.round(((durationMinutes(start, end) - breakMin) / 60) * 100) / 100;
}

export function estimatedEarnings(hours: number, rate: number | null) {
  return rate == null ? null : Math.round(hours * rate * 100) / 100;
}

export function isValidDate(d: string) {
  if (!DATE_RE.test(d)) return false;
  const dt = new Date(`${d}T00:00:00`);
  return !isNaN(dt.getTime()) && toISODate(dt) === d;
}

/** Returns a field→message map; empty object means valid. */
export function validateShift(s: ShiftData): Record<string, string> {
  const e: Record<string, string> = {};
  if (!isValidDate(s.date)) e.date = "Enter a valid date (YYYY-MM-DD).";
  if (!TIME_RE.test(s.start_time)) e.start_time = "Use 24-hour time, e.g. 08:00.";
  if (!TIME_RE.test(s.end_time)) e.end_time = "Use 24-hour time, e.g. 20:00.";
  if (!e.start_time && !e.end_time) {
    if (s.start_time === s.end_time) e.end_time = "Finish time can't be the same as start time.";
    else if (s.break_minutes >= durationMinutes(s.start_time, s.end_time)) e.break_minutes = "Unpaid break must be shorter than the shift.";
  }
  if (!Number.isInteger(s.break_minutes) || s.break_minutes < 0 || s.break_minutes > 720) e.break_minutes = "Break must be 0–720 minutes.";
  if (s.location.length > 60) e.location = "Keep the location under 60 characters.";
  if (PRISONER_NO_RE.test(s.location)) e.location = "Don't enter prisoner numbers or identifying details.";
  if (!s.officer_name.trim()) e.officer_name = "Officer name is required.";
  return e;
}

export function toISODate(d: Date) {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseISODate(s: string) {
  return new Date(`${s}T00:00:00`);
}

export function addDays(iso: string, n: number) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Absolute start/end timestamps (ms, local time). */
export function interval(s: Pick<ShiftData, "date" | "start_time" | "end_time">) {
  const start = parseISODate(s.date).getTime() + toMinutes(s.start_time) * 60000;
  return { start, end: start + durationMinutes(s.start_time, s.end_time) * 60000 };
}

export function overlaps<T extends ShiftData & { id: string }>(candidate: ShiftData & { id?: string }, others: T[]): T[] {
  if (candidate.status === "cancelled" || validateShift(candidate).date || !TIME_RE.test(candidate.start_time) || !TIME_RE.test(candidate.end_time))
    return [];
  const a = interval(candidate);
  return others.filter((o) => {
    if (o.id === candidate.id || o.status === "cancelled") return false;
    const b = interval(o);
    return a.start < b.end && b.start < a.end;
  });
}

export function formatDateLong(iso: string) {
  return parseISODate(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function formatHours(h: number) {
  return `${h % 1 === 0 ? h.toFixed(0) : h.toFixed(2).replace(/0$/, "")}h`;
}
