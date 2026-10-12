import Ionicons from "@react-native-vector-icons/ionicons";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useAuth } from "@/src/auth";
import { useToast } from "@/src/components/toast";
import { SyncState, useShifts } from "@/src/shifts/provider";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

const LABEL: Record<SyncState, string> = {
  saved_local: "Saved on device",
  syncing: "Syncing",
  synced: "Synced",
  failed: "Sync failed · Retry",
  conflict: "Needs review",
};

export function SyncBadge() {
  const { syncState, syncNow, pendingCount, conflictCount, online } = useShifts();
  const toast = useToast();
  const styles = useStyles();
  const { colors } = useTheme();
  const tone = {
    saved_local: [colors.warningSoft, colors.warning],
    syncing: [colors.brandTertiary, colors.onBrandTertiary],
    synced: [colors.successSoft, colors.success],
    failed: [colors.errorSoft, colors.error],
    conflict: [colors.errorSoft, colors.error],
  }[syncState];
  const icon = { saved_local: "phone-portrait-outline", synced: "cloud-done-outline", failed: "refresh", conflict: "git-compare-outline", syncing: "" }[syncState] as any;

  const onPress = () => {
    if (syncState === "conflict") return toast(`${conflictCount} shift${conflictCount > 1 ? "s" : ""} changed on another device — open it in Shifts to choose a version`, "info");
    if (syncState === "saved_local" && !online) toast(`${pendingCount} change${pendingCount > 1 ? "s" : ""} saved on this device. Trying to sync…`, "info");
    syncNow();
  };

  return (
    <Pressable testID="sync-status-badge" onPress={onPress} hitSlop={6} style={[styles.badge, { backgroundColor: tone[0] }]}>
      {syncState === "syncing" ? <ActivityIndicator size="small" color={tone[1]} /> : <Ionicons name={icon} size={14} color={tone[1]} />}
      <Text style={[styles.text, { color: tone[1] }]} testID="sync-status-text">
        {LABEL[syncState]}
      </Text>
    </Pressable>
  );
}

/** Refresh (sync + profile) button with the sync badge, for tab headers. */
export function HeaderActions() {
  const { syncNow } = useShifts();
  const { refreshUser } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try {
      await Promise.all([syncNow(), refreshUser()]);
      toast("Up to date", "success");
    } catch {
      toast("Couldn't refresh – check your connection", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Pressable testID="header-refresh-button" onPress={refresh} disabled={busy} hitSlop={8} accessibilityLabel="Refresh" style={{ padding: 6 }}>
        {busy ? <ActivityIndicator size="small" color={colors.onSurface} /> : <Ionicons name="refresh" size={20} color={colors.onSurface} />}
      </Pressable>
      <SyncBadge />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    minHeight: 30,
    borderRadius: radius.pill,
    marginBottom: spacing.xs,
  },
  text: { fontFamily: fonts.semibold, fontSize: type.sm },
}));
