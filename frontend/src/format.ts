const SYMBOLS: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" };

export function currencySymbol(c?: string) {
  return SYMBOLS[c ?? "GBP"] ?? "£";
}

export function money(v: number, c?: string) {
  return `${currencySymbol(c)}${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function firstName(full?: string) {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

export function initials(full?: string) {
  const p = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "DC";
}

export function passwordProblem(p: string): string | null {
  if (p.length < 10) return "Use at least 10 characters.";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Include both letters and numbers.";
  return null;
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
