import { useMemo, useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";

import { Segmented } from "@/src/components/segmented";
import { ShiftCard } from "@/src/components/shift-card";
import { ProPrompt } from "@/src/components/pro-prompt";
import { FREE_HISTORY_DAYS, useEntitlement } from "@/src/billing/entitlement";
import { money } from "@/src/format";
import { addDays, formatHours, interval, toISODate } from "@/src/shifts/calc";
import { LocalShift } from "@/src/shifts/provider";
import { summarise } from "@/src/shifts/stats";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

type Tab = "upcoming" | "history";
type Filter = "all" | "completed" | "cancelled" | "unpaid";

export function isUpcoming(s: LocalShift, now = Date.now()) {
  return s.status === "booked" && interval(s).end > now;
}

/** Upcoming (soonest first) and History (newest first) lists built from on-device data. */
export function ShiftListView({
  shifts,
  header,
  currency,
  onPress,
  bottomPadding,
  refreshing,
  onRefresh,
}: {
  shifts: LocalShift[];
  header: React.ReactElement;
  currency?: string;
  onPress: (id: string) => void;
  bottomPadding: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [filter, setFilter] = useState<Filter>("all");
  const { isPro } = useEntitlement();
  // Free: last 30 days of history in the app. Older records stay stored, synced and exportable.
  const cutoff = addDays(toISODate(new Date()), -FREE_HISTORY_DAYS);
  const olderHidden = isPro || tab !== "history" ? 0 : shifts.filter((s) => !isUpcoming(s) && s.date < cutoff).length;

  const data = useMemo(() => {
    const now = Date.now();
    if (tab === "upcoming") return shifts.filter((s) => isUpcoming(s, now));
    const hist = shifts.filter((s) => !isUpcoming(s, now) && (isPro || s.date >= cutoff)).reverse();
    if (filter === "completed") return hist.filter((s) => s.status === "completed");
    if (filter === "cancelled") return hist.filter((s) => s.status === "cancelled");
    if (filter === "unpaid") return hist.filter((s) => s.status === "completed" && s.payment_status !== "paid");
    return hist;
  }, [shifts, tab, filter, isPro, cutoff]);

  // History totals use the same rules as Home, Earnings and reports.
  const t = summarise(data);
  const summary =
    tab === "upcoming"
      ? `${data.length} upcoming · ${formatHours(Math.round(data.reduce((a, s) => a + s.payable_hours, 0) * 100) / 100)} booked`
      : `${data.length} shifts · ${t.completed} completed · ${formatHours(t.hours)} · est. ${money(t.estimated, currency)} · received ${money(t.received, currency)}`;

  return (
    <FlatList
      testID="shifts-list-view"
      data={data}
      keyExtractor={(s) => s.id}
      renderItem={({ item }) => <ShiftCard shift={item} currency={currency} onPress={() => onPress(item.id)} />}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      initialNumToRender={12}
      windowSize={7}
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandSecondary} />}
      ListHeaderComponent={
        <View style={styles.header}>
          {header}
          <Segmented<Tab>
            testPrefix="shifts-list-tab"
            value={tab}
            onChange={setTab}
            options={[
              { value: "upcoming", label: "Upcoming" },
              { value: "history", label: "History" },
            ]}
          />
          {tab === "history" && (
            <Segmented<Filter>
              testPrefix="shifts-history-filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "completed", label: "Completed" },
                { value: "cancelled", label: "Cancelled" },
                { value: "unpaid", label: "Unpaid" },
              ]}
            />
          )}
          <Text style={styles.summary} testID="shifts-list-summary">
            {summary}
          </Text>
          {olderHidden > 0 && (
            <ProPrompt
              testID="history-older-prompt"
              title={`${olderHidden} older shift${olderHidden === 1 ? " is" : "s are"} safely stored`}
              body="Free shows the last 30 days. View every record by exporting a CSV (Account → Export my data), or upgrade to browse them here."
            />
          )}
        </View>
      }
      ListEmptyComponent={
        <View style={styles.empty} testID="shifts-list-empty">
          <Text style={styles.emptyText}>{tab === "upcoming" ? "No upcoming booked shifts." : "No shifts match this filter."}</Text>
        </View>
      }
    />
  );
}

const useStyles = makeStyles((c) => ({
  content: { padding: spacing.lg },
  header: { gap: spacing.md, marginBottom: spacing.md },
  summary: { fontFamily: fonts.semibold, fontSize: type.sm + 1, color: c.onSurfaceSecondary },
  empty: { padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: c.borderStrong },
  emptyText: { fontFamily: fonts.medium, fontSize: type.base, color: c.onSurfaceSecondary },
}));
