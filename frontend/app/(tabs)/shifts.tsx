import Ionicons from "@react-native-vector-icons/ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { useAuth } from "@/src/auth";
import { Segmented } from "@/src/components/segmented";
import { ShiftActionsSheet } from "@/src/components/shift-actions-sheet";
import { ShiftCalendar, weekStart } from "@/src/components/shift-calendar";
import { ShiftCard } from "@/src/components/shift-card";
import { SyncBadge } from "@/src/components/sync-badge";
import { TabHeader, useTabBottomPadding } from "@/src/components/tab-screen";
import { tap } from "@/src/components/ui";
import { addDays, formatDateLong, isValidDate, toISODate } from "@/src/shifts/calc";
import { LocalShift, useShifts } from "@/src/shifts/provider";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";
import { usesNativeTabs } from "@/src/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function Shifts() {
  const params = useLocalSearchParams<{ date?: string }>();
  const { user } = useAuth();
  const { shifts, ready, syncNow, byId } = useShifts();
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = useTabBottomPadding();
  const fabBottom = (usesNativeTabs ? insets.bottom : 0) + spacing.lg;
  const [mode, setMode] = useState<"month" | "week">("month");
  const [selected, setSelected] = useState(toISODate(new Date()));
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (params.date && isValidDate(params.date)) setSelected(params.date);
  }, [params.date]);

  const byDate = useMemo(() => {
    const m: Record<string, LocalShift[]> = {};
    for (const s of shifts) (m[s.date] ??= []).push(s);
    return m;
  }, [shifts]);

  const listTitle = mode === "week" ? "This week" : formatDateLong(selected);
  const list = useMemo(() => {
    if (mode === "week") {
      const ws = weekStart(selected);
      const we = addDays(ws, 6);
      return shifts.filter((s) => s.date >= ws && s.date <= we);
    }
    return byDate[selected] ?? [];
  }, [mode, selected, shifts, byDate]);
  const monthCount = shifts.filter((s) => s.date.slice(0, 7) === selected.slice(0, 7) && s.status !== "cancelled").length;

  return (
    <View style={styles.root} testID="shifts-screen">
      <TabHeader title="My PP Shifts" right={<SyncBadge />} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottom + 72 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.brandSecondary}
            onRefresh={async () => {
              setRefreshing(true);
              await syncNow();
              setRefreshing(false);
            }}
          />
        }
      >
        <Segmented<"month" | "week">
          testPrefix="shifts-view"
          value={mode}
          onChange={setMode}
          options={[
            { value: "month", label: "Month" },
            { value: "week", label: "Week" },
          ]}
        />
        <ShiftCalendar mode={mode} selected={selected} onSelect={setSelected} byDate={byDate} />
        <View style={styles.legend}>
          <Legend color={colors.dutyBed} label="Bed Watch" />
          <Legend color={colors.dutyConstant} label="Constant Watch" />
          <Legend color={colors.dutyOther} label="Other PP" />
          <Ionicons name="moon" size={10} color={colors.night} />
          <Text style={styles.legendText}>Night</Text>
        </View>

        <View style={styles.listHead}>
          <Text style={styles.listTitle} testID="shifts-list-title">
            {listTitle}
          </Text>
          <Text style={styles.listSub}>{monthCount} this month</Text>
        </View>
        {!ready ? (
          <ActivityIndicator color={colors.brandSecondary} />
        ) : list.length ? (
          <View style={{ gap: spacing.sm }} testID="shifts-list">
            {list.map((s) => (
              <ShiftCard key={s.id} shift={s} currency={user?.currency} showDate={mode === "week"} onPress={() => setSheetId(s.id)} />
            ))}
          </View>
        ) : (
          <Pressable testID="shifts-empty-add" onPress={() => router.push({ pathname: "/shift-form", params: { date: selected } })} style={styles.empty}>
            <Ionicons name="add-circle-outline" size={22} color={colors.brandSecondary} />
            <Text style={styles.emptyText}>No shifts {mode === "week" ? "this week" : "on this day"} — tap to add one</Text>
          </Pressable>
        )}
      </ScrollView>

      <Pressable
        testID="shifts-add-fab"
        accessibilityLabel="Add shift"
        onPress={() => {
          tap();
          router.push({ pathname: "/shift-form", params: { date: selected } });
        }}
        style={({ pressed }) => [styles.fab, { bottom: fabBottom }, pressed && { transform: [{ scale: 0.95 }] }]}
      >
        <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
        <Text style={styles.fabText}>Add shift</Text>
      </Pressable>

      <ShiftActionsSheet shift={sheetId ? (byId(sheetId) ?? null) : null} onClose={() => setSheetId(null)} />
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const styles = useStyles();
  return (
    <>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: spacing.lg, gap: spacing.md },
  legend: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2, flexWrap: "wrap" },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontFamily: fonts.medium, fontSize: type.sm, color: c.muted, marginRight: spacing.sm },
  listHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: spacing.sm },
  listTitle: { fontFamily: fonts.bold, fontSize: type.lg, color: c.onSurface },
  listSub: { fontFamily: fonts.medium, fontSize: type.sm, color: c.muted },
  empty: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: c.borderStrong,
  },
  emptyText: { flex: 1, fontFamily: fonts.medium, fontSize: type.base, color: c.onSurfaceSecondary },
  fab: {
    position: "absolute",
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: c.brandPrimary,
    paddingHorizontal: spacing.xl,
    height: 52,
    borderRadius: radius.pill,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabText: { fontFamily: fonts.bold, fontSize: type.base, color: c.onBrandPrimary },
}));
