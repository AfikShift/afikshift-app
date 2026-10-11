import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { ApiError, REFRESH_KEY, clearTokens, request, saveTokens, setSessionExpiredHandler, tryRefresh } from "@/src/api";
import { removeEncrypted, shiftsKey } from "@/src/shifts/local-store";
import { storage } from "@/src/utils/storage";

export type NotificationPrefs = { shift_reminders: boolean; payment_reminders: boolean; product_updates: boolean };
export type User = {
  id: string;
  email: string;
  full_name: string;
  professional_category: string;
  currency: "GBP" | "EUR" | "USD";
  hourly_rate: number | null;
  notification_prefs: NotificationPrefs;
  plan: string;
  features: Record<string, boolean>;
  email_verified: boolean;
  created_at: string;
};

type Status = "loading" | "signedOut" | "signedIn";
const USER_CACHE_KEY = "dc_user_cache";
export const BIOMETRIC_KEY = "dc_biometric_enabled";
const LOCK_AFTER_MS = 60_000;

type Ctx = {
  status: Status;
  user: User | null;
  locked: boolean;
  biometricEnabled: boolean;
  unlock: () => void;
  setBiometricEnabled: (v: boolean) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (full_name: string, email: string, password: string) => Promise<void>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (patch: Record<string, unknown>) => Promise<User>;
  refreshUser: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  changePassword: (current_password: string, new_password: string) => Promise<void>;
};

const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [locked, setLocked] = useState(false);
  const [biometricEnabled, setBio] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  const cacheUser = useCallback(async (u: User | null) => {
    setUser(u);
    if (u) await storage.secureSet(USER_CACHE_KEY, JSON.stringify(u));
    else await storage.secureRemove(USER_CACHE_KEY);
  }, []);

  const signOutLocal = useCallback(async () => {
    await clearTokens();
    await cacheUser(null);
    setLocked(false);
    setStatus("signedOut");
  }, [cacheUser]);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      signOutLocal();
    });
  }, [signOutLocal]);

  // Bootstrap: restore session (works offline using the cached profile).
  useEffect(() => {
    (async () => {
      const bio = (await storage.getItem(BIOMETRIC_KEY, false as boolean)) === true;
      setBio(bio);
      const token = await storage.secureGet(REFRESH_KEY, null as string | null);
      if (!token) return setStatus("signedOut");
      const cached = await storage.secureGet(USER_CACHE_KEY, null as string | null);
      if (cached) setUser(JSON.parse(cached));
      const ok = await tryRefresh();
      if (ok) {
        try {
          await cacheUser(await request<User>("/me"));
        } catch {}
      } else {
        const still = await storage.secureGet(REFRESH_KEY, null as string | null);
        if (!still || !cached) return signOutLocal();
      }
      if (bio) setLocked(true);
      setStatus("signedIn");
    })();
  }, [cacheUser, signOutLocal]);

  // Re-lock after the app has been in the background for a while.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") backgroundedAt.current = Date.now();
      if (s === "active" && backgroundedAt.current) {
        if (biometricEnabled && status === "signedIn" && Date.now() - backgroundedAt.current > LOCK_AFTER_MS) {
          setLocked(true);
        }
        backgroundedAt.current = null;
      }
    });
    return () => sub.remove();
  }, [biometricEnabled, status]);

  const afterTokens = useCallback(
    async (tokens: any) => {
      await saveTokens(tokens);
      await cacheUser(await request<User>("/me"));
      setStatus("signedIn");
    },
    [cacheUser],
  );

  const value = useMemo<Ctx>(
    () => ({
      status,
      user,
      locked,
      biometricEnabled,
      unlock: () => setLocked(false),
      setBiometricEnabled: async (v) => {
        setBio(v);
        await storage.setItem(BIOMETRIC_KEY, v);
      },
      login: async (email, password) => {
        const t = await request("/auth/login", { method: "POST", body: { email, password }, auth: false });
        await afterTokens(t);
      },
      register: async (full_name, email, password) => {
        await request("/auth/register", { method: "POST", body: { full_name, email, password }, auth: false });
      },
      verifyEmail: async (email, code) => {
        const t = await request("/auth/verify-email", { method: "POST", body: { email, code }, auth: false });
        await afterTokens(t);
      },
      logout: async () => {
        const token = await storage.secureGet(REFRESH_KEY, null as string | null);
        if (token) request("/auth/logout", { method: "POST", body: { refresh_token: token }, auth: false }).catch(() => {});
        await signOutLocal();
      },
      updateProfile: async (patch) => {
        const u = await request<User>("/me", { method: "PATCH", body: patch });
        await cacheUser(u);
        return u;
      },
      refreshUser: async () => {
        await cacheUser(await request<User>("/me"));
      },
      deleteAccount: async (password) => {
        await request("/me", { method: "DELETE", body: { password } });
        if (user) await removeEncrypted(shiftsKey(user.id)); // purge on-device shift records
        await storage.removeItem(BIOMETRIC_KEY);
        setBio(false);
        await signOutLocal();
      },
      changePassword: async (current_password, new_password) => {
        const t = await request("/me/change-password", { method: "POST", body: { current_password, new_password } });
        await saveTokens(t);
      },
    }),
    [status, user, locked, biometricEnabled, afterTokens, cacheUser, signOutLocal],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}

export function useFeature(key: string): boolean {
  const { user } = useAuth();
  return !!user?.features?.[key];
}

export { ApiError };
