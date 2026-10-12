// Free / Pro entitlement on the device. The server decides the plan from Google Play; the app keeps a
// server-signed (Ed25519) pass so Pro keeps working offline for at most 7 days or until the paid period
// ends. A pass cannot be created or extended on the device (only the server holds the signing key).
import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes } from "@noble/ciphers/utils.js";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { request } from "@/src/api";
import { useAuth } from "@/src/auth";
import { storage } from "@/src/utils/storage";

export type Entitlement = {
  plan: "free" | "pro";
  product_id: string | null;
  state: string | null;
  expires_at: string | null;
  will_renew: boolean;
  pass: string;
  pass_expires_at: string;
  account_ref: string;
  mode: string;
  founding_eligible?: boolean;
};

const KEY = "dc_entitlement_v1";
const PUB = process.env.EXPO_PUBLIC_ENTITLEMENT_PUBLIC_KEY ?? "";

const b64 = (s: string) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
};

/** Plan from a signed pass, or "free" if missing, forged, for another account or expired. */
export function passPlan(pass: string | undefined, userId: string | undefined, nowMs = Date.now()): "free" | "pro" {
  try {
    const [body, sig] = (pass ?? "").split(".");
    if (!ed25519.verify(b64(sig), new TextEncoder().encode(body), hexToBytes(PUB))) return "free";
    const c = JSON.parse(new TextDecoder().decode(b64(body)));
    return c.sub === userId && c.plan === "pro" && c.exp * 1000 > nowMs ? "pro" : "free";
  } catch {
    return "free";
  }
}

type Ctx = { isPro: boolean; ent: Entitlement | null; refresh: () => Promise<void>; apply: (e: Entitlement) => Promise<void> };
const EntCtx = createContext<Ctx>({ isPro: false, ent: null, refresh: async () => {}, apply: async () => {} });

export function EntitlementProvider({ children }: { children: React.ReactNode }) {
  const { user, status, refreshUser } = useAuth();
  const [ent, setEnt] = useState<Entitlement | null>(null);
  const [, tick] = useState(0);

  const apply = useCallback(
    async (e: Entitlement) => {
      setEnt(e);
      await storage.setItem(KEY, JSON.stringify(e));
      refreshUser().catch(() => {});
    },
    [refreshUser],
  );
  const refresh = useCallback(async () => {
    try {
      await apply(await request<Entitlement>("/billing/entitlement"));
    } catch {
      // Offline: keep the cached signed pass.
    }
  }, [apply]);

  useEffect(() => {
    if (status !== "signedIn") return setEnt(null);
    storage.getItem(KEY, "").then((c) => {
      if (typeof c === "string" && c) setEnt(JSON.parse(c));
    });
    refresh();
    const iv = setInterval(() => tick((n) => n + 1), 60_000); // re-check pass expiry
    return () => clearInterval(iv);
  }, [status, refresh]);

  const isPro = passPlan(ent?.pass, user?.id) === "pro";
  const value = useMemo(() => ({ isPro, ent, refresh, apply }), [isPro, ent, refresh, apply]);
  return <EntCtx.Provider value={value}>{children}</EntCtx.Provider>;
}

export const useEntitlement = () => useContext(EntCtx);
export const FREE_HISTORY_DAYS = 7;
