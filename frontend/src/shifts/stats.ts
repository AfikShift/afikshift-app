import { LocalShift } from "@/src/shifts/provider";
import { interval } from "@/src/shifts/calc";

export function monthStats(shifts: LocalShift[], ym: string) {
  const inMonth = shifts.filter((s) => s.date.startsWith(ym));
  const done = inMonth.filter((s) => s.status === "completed");
  const booked = inMonth.filter((s) => s.status === "booked");
  const sum = (arr: LocalShift[], f: (s: LocalShift) => number) => Math.round(arr.reduce((a, s) => a + f(s), 0) * 100) / 100;
  return {
    completed: done.length,
    hours: sum(done, (s) => s.payable_hours),
    estimated: sum(done, (s) => s.estimated_earnings ?? 0),
    outstanding: sum(done, (s) => Math.max(s.outstanding ?? 0, 0)),
    received: sum(done, (s) => s.amount_received ?? 0),
    booked: booked.length,
    projected: sum(booked, (s) => s.estimated_earnings ?? 0),
    missingRate: done.some((s) => s.hourly_rate == null),
  };
}

/** Next booked shift that hasn't finished yet. */
export function nextShift(shifts: LocalShift[], now = Date.now()) {
  return shifts.filter((s) => s.status === "booked" && interval(s).end > now).sort((a, b) => interval(a).start - interval(b).start)[0];
}
