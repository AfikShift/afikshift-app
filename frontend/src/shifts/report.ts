// CSV / PDF earnings reports, built on the device from the signed-in user's own records.
// The records come only from this user's encrypted local store, which the server fills
// exclusively with shifts owned by the authenticated account.
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { money } from "@/src/format";
import { DUTY_LABEL, PAYMENT_LABEL, STATUS_LABEL } from "@/src/shifts/calc";
import { LocalShift } from "@/src/shifts/provider";
import { Totals, summarise } from "@/src/shifts/stats";

export type ReportMeta = { officer: string; email: string; currency?: string; label: string; from?: string; to?: string };

/** Shifts included in a report — the same filter summarise() applies, so totals always match. */
export function reportRows(shifts: LocalShift[], from?: string, to?: string) {
  return shifts.filter((s) => !s.deleted && (!from || s.date >= from) && (!to || s.date <= to)).sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
}

const n2 = (v: number | null | undefined) => (v == null ? "" : v.toFixed(2));

/** Quote a CSV cell and neutralise spreadsheet formulas (CSV injection). */
function cell(v: string | number) {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEAD = ["Date", "Start", "Finish", "Period", "Shift type", "Location", "Status", "Unpaid break (mins)", "Payable hours", "Hourly rate", "Estimated", "Received", "Outstanding", "Payment status", "Provisional"];

function rowValues(s: LocalShift) {
  const done = s.status === "completed";
  return [
    s.date, s.start_time, s.end_time, s.shift_period === "night" ? "Night" : "Day", DUTY_LABEL[s.duty_type], s.location, STATUS_LABEL[s.status],
    s.break_minutes, n2(s.payable_hours), n2(s.hourly_rate), n2(s.estimated_earnings),
    done ? n2(s.amount_received) : "", done ? n2(s.outstanding) : "", done ? PAYMENT_LABEL[s.payment_status] : "", s.payment_clash ? "Yes" : "",
  ];
}

export function buildCsv(shifts: LocalShift[], meta: ReportMeta) {
  const rows = reportRows(shifts, meta.from, meta.to);
  const t = summarise(shifts, meta.from, meta.to);
  const lines = [
    ["DutyConnect earnings report"],
    ["Name", meta.officer],
    ["Period", meta.label],
    ["Currency", meta.currency ?? "GBP"],
    ["Generated", new Date().toLocaleString("en-GB")],
    [],
    HEAD,
    ...rows.map(rowValues),
    [],
    ["Totals (completed shifts)"],
    ["Completed shifts", t.completed],
    ["Payable hours", n2(t.hours)],
    ["Estimated gross", n2(t.estimated)],
    ["Received", n2(t.received)],
    ["Outstanding", n2(t.outstanding)],
    ["Booked shifts (projected)", `${t.booked} / ${n2(t.projected)}`],
    ...(t.provisional ? [["Warning", `${t.provisional} shift(s) have an unresolved payment edit clash; figures are provisional.`]] : []),
    ["Note", "Estimates only - not official payroll records."],
  ];
  return lines.map((l) => l.map(cell).join(",")).join("\r\n");
}

const esc = (s: string | number) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function buildHtml(shifts: LocalShift[], meta: ReportMeta) {
  const rows = reportRows(shifts, meta.from, meta.to);
  const t: Totals = summarise(shifts, meta.from, meta.to);
  const m = (v: number) => esc(money(v, meta.currency));
  const body = rows.map((s) => `<tr>${rowValues(s).map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#111827;padding:24px;font-size:11px}
h1{color:#0A192F;font-size:20px;margin:0}.sub{color:#6B7280;margin:4px 0 16px}
.tot{display:flex;gap:12px;margin-bottom:16px}.tot div{flex:1;background:#F4F5F7;border-radius:8px;padding:10px}
.tot b{display:block;font-size:15px;color:#0A192F}table{width:100%;border-collapse:collapse}
th{background:#0A192F;color:#fff;text-align:left;padding:5px;font-size:9px}td{padding:5px;border-bottom:1px solid #E5E7EB;font-size:9px}
.warn{background:#FEF3E2;color:#B45309;padding:8px;border-radius:6px;margin-bottom:12px}.foot{color:#6B7280;margin-top:16px}
</style></head><body>
<h1>DutyConnect earnings report</h1>
<div class="sub">${esc(meta.officer)} · ${esc(meta.label)} · generated ${esc(new Date().toLocaleString("en-GB"))}</div>
${t.provisional ? `<div class="warn">${t.provisional} shift(s) have an unresolved payment edit clash. Figures are provisional until the correct payment is chosen.</div>` : ""}
<div class="tot"><div><b>${t.completed}</b>Completed shifts</div><div><b>${t.hours.toFixed(2)}</b>Payable hours</div><div><b>${m(t.estimated)}</b>Estimated gross</div><div><b>${m(t.received)}</b>Received</div><div><b>${m(t.outstanding)}</b>Outstanding</div></div>
<div class="sub">${t.booked} booked · ${m(t.projected)} projected (not earned)</div>
<table><thead><tr>${HEAD.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body || `<tr><td colspan="${HEAD.length}">No shifts in this period.</td></tr>`}</tbody></table>
<div class="foot">Estimates only — not official payroll records. Confidential: contains personal earnings information.</div>
</body></html>`;
}

function fileName(meta: ReportMeta, ext: string) {
  return `DutyConnect-report-${(meta.from ?? "all").replace(/[^0-9-]/g, "")}${meta.to ? `-to-${meta.to}` : ""}.${ext}`;
}

/** Save a JSON personal-data download and open the share sheet (web: download). Free on every plan. */
export async function shareJson(data: unknown) {
  const json = JSON.stringify(data, null, 2);
  const name = `DutyConnect-my-data-${new Date().toISOString().slice(0, 10)}.json`;
  if (Platform.OS === "web") {
    const w: any = globalThis;
    const a = w.document.createElement("a");
    a.href = w.URL.createObjectURL(new w.Blob([json], { type: "application/json" }));
    a.download = name;
    a.click();
    return;
  }
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create();
  f.write(json);
  try {
    await Sharing.shareAsync(f.uri, { mimeType: "application/json", dialogTitle: "Save my data" });
  } finally {
    if (f.exists) f.delete();
  }
}

/** Generate the report and open the share sheet (web: download / print). */
export async function shareReport(format: "csv" | "pdf", shifts: LocalShift[], meta: ReportMeta) {
  if (format === "csv") {
    const csv = buildCsv(shifts, meta);
    if (Platform.OS === "web") {
      const w: any = globalThis;
      const a = w.document.createElement("a");
      a.href = w.URL.createObjectURL(new w.Blob([csv], { type: "text/csv" }));
      a.download = fileName(meta, "csv");
      a.click();
      return;
    }
    const f = new File(Paths.cache, fileName(meta, "csv"));
    if (f.exists) f.delete();
    f.create();
    f.write(csv);
    try {
      await Sharing.shareAsync(f.uri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text", dialogTitle: "Share report" });
    } finally {
      if (f.exists) f.delete(); // don't leave a copy of personal data in the cache
    }
    return;
  }
  const html = buildHtml(shifts, meta);
  if (Platform.OS === "web") {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  const f = new File(uri);
  try {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "Share report" });
  } finally {
    if (f.exists) f.delete();
  }
}
