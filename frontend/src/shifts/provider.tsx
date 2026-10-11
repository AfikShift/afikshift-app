import NetInfo from "@react-native-community/netinfo";
import * as Crypto from "expo-crypto";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { ApiError, request } from "@/src/api";
import { useAuth } from "@/src/auth";
import { ShiftData, estimatedEarnings, interval, payableHours } from "@/src/shifts/calc";
import { loadEncrypted, saveEncrypted, shiftsKey } from "@/src/shifts/local-store";

export type ServerShift = ShiftData & {
  id: string;
  version: number;
  deleted: boolean;
  payable_hours: number;
  estimated_earnings: number | null;
  created_at: string;
  updated_at: string;
};

export type LocalShift = ServerShift & {
  _sync: "pending" | "synced" | "conflict";
  _change_id?: string;
  _server?: ServerShift | null; // server copy when a conflict is detected
};

export type SyncState = "saved_local" | "syncing" | "synced" | "failed" | "conflict";

type Persisted = { shifts: Record<string, LocalShift>; since: string | null };

type Ctx = {
  ready: boolean;
  shifts: LocalShift[]; // visible (not deleted), sorted by start
  byId: (id: string) => LocalShift | undefined;
  syncState: SyncState;
  pendingCount: number;
  conflictCount: number;
  online: boolean;
  lastSyncedAt: string | null;
  syncNow: () => Promise<void>;
  create: (data: ShiftData) => Promise<string>;
  update: (id: string, patch: Partial<ShiftData>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  resolveConflict: (id: string, keep: "mine" | "server") => Promise<void>;
};

const ShiftsContext = createContext<Ctx | null>(null);
const EMPTY: Persisted = { shifts: {}, since: null };

function withComputed(d: ShiftData) {
  const h = payableHours(d.start_time, d.end_time, d.break_minutes);
  return { payable_hours: h, estimated_earnings: estimatedEarnings(h, d.hourly_rate) };
}

function pickData(s: LocalShift): ShiftData {
  const { officer_name, duty_type, shift_period, date, start_time, end_time, break_minutes, location, status, payment_status, hourly_rate } = s;
  return { officer_name, duty_type, shift_period, date, start_time, end_time, break_minutes, location, status, payment_status, hourly_rate };
}

export function ShiftsProvider({ children }: { children: React.ReactNode }) {
  const { user, status } = useAuth();
  const userId = status === "signedIn" ? user?.id : undefined;
  const [db, setDb] = useState<Persisted>(EMPTY);
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [online, setOnline] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const dbRef = useRef<Persisted>(EMPTY);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const syncLock = useRef(false);
  const rerun = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apply a state change and persist it (serialised so writes never interleave).
  const commit = useCallback(
    async (fn: (prev: Persisted) => Persisted) => {
      if (!userId) return;
      const next = fn(dbRef.current);
      dbRef.current = next;
      setDb(next);
      const p = saveChain.current.then(() => saveEncrypted(shiftsKey(userId), next));
      saveChain.current = p.catch(() => {});
      await p;
    },
    [userId],
  );

  // Load encrypted local records for the signed-in user.
  useEffect(() => {
    let alive = true;
    setReady(false);
    dbRef.current = EMPTY;
    setDb(EMPTY);
    if (!userId) return;
    loadEncrypted<Persisted>(shiftsKey(userId)).then((saved) => {
      if (!alive) return;
      const v = saved ?? EMPTY;
      dbRef.current = v;
      setDb(v);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  const syncNow = useCallback(async () => {
    if (!userId || !ready) return;
    if (syncLock.current) {
      rerun.current = true;
      return;
    }
    syncLock.current = true;
    setSyncing(true);
    try {
      do {
        rerun.current = false;
        const snapshot = dbRef.current;
        const pending = Object.values(snapshot.shifts).filter((s) => s._sync === "pending");
        const changes = pending.map((s) => ({
          id: s.id,
          change_id: s._change_id,
          base_version: s.version,
          deleted: s.deleted,
          data: s.deleted ? undefined : pickData(s),
        }));
        const res = await request<{
          results: { id: string; status: string; server: ServerShift | null }[];
          shifts: ServerShift[];
          server_time: string;
        }>("/shifts/sync", { method: "POST", body: { changes, since: snapshot.since } });
        const sent = new Map(pending.map((s) => [s.id, s._change_id]));
        await commit((prev) => {
          const shifts = { ...prev.shifts };
          for (const r of res.results) {
            const local = shifts[r.id];
            if (!local) continue;
            if (r.status === "applied" || r.status === "duplicate") {
              if (!r.server) continue;
              if (local._change_id === sent.get(r.id)) {
                if (r.server.deleted) delete shifts[r.id];
                else shifts[r.id] = { ...r.server, _sync: "synced" };
              } else shifts[r.id] = { ...local, version: r.server.version }; // edited again meanwhile
            } else if (r.status === "conflict") {
              shifts[r.id] = { ...local, _sync: "conflict", _server: r.server };
            } else if (r.status === "rejected") {
              delete shifts[r.id];
            }
          }
          for (const s of res.shifts) {
            const local = shifts[s.id];
            if (local && local._sync !== "synced") continue; // never overwrite unsynced local edits
            if (s.deleted) delete shifts[s.id];
            else shifts[s.id] = { ...s, _sync: "synced" };
          }
          return { shifts, since: res.server_time };
        });
        setFailed(false);
        setOnline(true);
        setLastSyncedAt(new Date().toISOString());
      } while (rerun.current);
    } catch (e) {
      // No connection: data stays safely on the device. Other errors: show "Sync failed".
      if (!(e instanceof ApiError && e.status === 0)) setFailed(true);
      else setOnline(false);
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  }, [userId, ready, commit]);

  const scheduleSync = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => syncNow(), 400);
  }, [syncNow]);

  // Sync on load, when connectivity returns, when the app is foregrounded, and periodically.
  useEffect(() => {
    if (!ready) return;
    syncNow();
    const net = NetInfo.addEventListener((s) => {
      const on = !!s.isConnected && s.isInternetReachable !== false;
      setOnline(on);
      if (on) syncNow();
    });
    const app = AppState.addEventListener("change", (s) => s === "active" && syncNow());
    const iv = setInterval(() => syncNow(), 60_000);
    // Web fallback: NetInfo on react-native-web doesn't always report reconnection.
    const onWebOnline = () => {
      setOnline(true);
      syncNow();
    };
    const w: any = Platform.OS === "web" && typeof window !== "undefined" ? window : null;
    w?.addEventListener("online", onWebOnline);
    return () => {
      net();
      app.remove();
      clearInterval(iv);
      w?.removeEventListener("online", onWebOnline);
    };
  }, [ready, syncNow]);

  const write = useCallback(
    async (id: string, build: (prev?: LocalShift) => LocalShift) => {
      await commit((prev) => ({ ...prev, shifts: { ...prev.shifts, [id]: build(prev.shifts[id]) } }));
      scheduleSync();
    },
    [commit, scheduleSync],
  );

  const value = useMemo<Ctx>(() => {
    const all = Object.values(db.shifts);
    const visible = all.filter((s) => !s.deleted).sort((a, b) => interval(a).start - interval(b).start);
    const pendingCount = all.filter((s) => s._sync === "pending").length;
    const conflictCount = all.filter((s) => s._sync === "conflict").length;
    const syncState: SyncState = syncing
      ? "syncing"
      : conflictCount
        ? "conflict"
        : failed && pendingCount
          ? "failed"
          : pendingCount
            ? "saved_local"
            : failed
              ? "failed"
              : "synced";
    return {
      ready,
      shifts: visible,
      byId: (id) => db.shifts[id],
      syncState,
      pendingCount,
      conflictCount,
      online,
      lastSyncedAt,
      syncNow,
      create: async (data) => {
        const id = Crypto.randomUUID();
        const ts = new Date().toISOString();
        await write(id, () => ({
          ...data,
          ...withComputed(data),
          id,
          version: 0,
          deleted: false,
          created_at: ts,
          updated_at: ts,
          _sync: "pending",
          _change_id: Crypto.randomUUID(),
        }));
        return id;
      },
      update: async (id, patch) => {
        await write(id, (prev) => {
          if (!prev) throw new Error("Shift not found");
          const data = { ...pickData(prev), ...patch };
          return {
            ...prev,
            ...data,
            ...withComputed(data),
            updated_at: new Date().toISOString(),
            _sync: prev._sync === "conflict" ? "conflict" : "pending",
            _change_id: Crypto.randomUUID(),
          };
        });
      },
      remove: async (id) => {
        await write(id, (prev) => {
          if (!prev) throw new Error("Shift not found");
          return { ...prev, deleted: true, _sync: "pending", _change_id: Crypto.randomUUID() };
        });
      },
      resolveConflict: async (id, keep) => {
        await commit((prev) => {
          const local = prev.shifts[id];
          if (!local) return prev;
          const shifts = { ...prev.shifts };
          const server = local._server;
          if (keep === "server") {
            if (server && !server.deleted) shifts[id] = { ...server, _sync: "synced" };
            else delete shifts[id];
          } else {
            // Keep my version: re-base on the server's latest version so the next push applies it.
            shifts[id] = { ...local, version: server?.version ?? 0, _sync: "pending", _server: undefined, _change_id: Crypto.randomUUID() };
          }
          return { ...prev, shifts };
        });
        scheduleSync();
      },
    };
  }, [db, ready, syncing, failed, online, lastSyncedAt, syncNow, write, commit, scheduleSync]);

  return <ShiftsContext.Provider value={value}>{children}</ShiftsContext.Provider>;
}

export function useShifts() {
  const c = useContext(ShiftsContext);
  if (!c) throw new Error("useShifts must be used inside ShiftsProvider");
  return c;
}
