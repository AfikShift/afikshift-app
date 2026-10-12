import { storage } from "@/src/utils/storage";

const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;
export const REFRESH_KEY = "dc_refresh_token";

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionExpired: (() => void) | null = null;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
}

export async function saveTokens(t: { access_token: string; refresh_token: string }) {
  accessToken = t.access_token;
  await storage.secureSet(REFRESH_KEY, t.refresh_token);
}

export async function clearTokens() {
  accessToken = null;
  await storage.secureRemove(REFRESH_KEY);
}

function errorMessage(data: any, status: number): string {
  const d = data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg).replace(/^Value error, /, "");
  if (status === 0) return "No internet connection";
  return "Something went wrong. Please try again.";
}

async function raw(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers as any) } });
}

let onAccountDeleted: (() => Promise<void> | void) | null = null;
/** Called when the server reports this account was deleted (e.g. via the web page) so local data is wiped. */
export function setAccountDeletedHandler(fn: () => Promise<void> | void) {
  onAccountDeleted = fn;
}

export async function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const token = await storage.secureGet(REFRESH_KEY, null as string | null);
    if (!token) return false;
    try {
      const r = await raw("/auth/refresh", { method: "POST", body: JSON.stringify({ refresh_token: token }) }, false);
      if (!r.ok) {
        if (r.status === 401) await clearTokens();
        if (r.status === 410) {
          await clearTokens();
          await onAccountDeleted?.();
        }
        return false;
      }
      await saveTokens(await r.json());
      return true;
    } catch {
      return false;
    }
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

export async function request<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const init: RequestInit = { method, body: body === undefined ? undefined : JSON.stringify(body) };
  let r: Response;
  try {
    r = await raw(path, init, auth);
    if (auth && r.status === 401) {
      const ok = await tryRefresh();
      if (!ok) {
        onSessionExpired?.();
        throw new ApiError(401, "Your session has expired. Please sign in again.");
      }
      r = await raw(path, init, auth);
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, "No internet connection");
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, errorMessage(data, r.status));
  return data as T;
}
