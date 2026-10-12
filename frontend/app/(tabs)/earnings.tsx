import Ionicons from "@react-native-vector-icons/ionicons";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { useAuth } from "@/src/auth";
import { ExportSheet } from "@/src/components/export-sheet";
import { ProvisionalBanner } from "@/src/components/provisional-banner";
import { Segmented } from "@/src/components/segmented";
import { dutyColors } from "@/src/components/shift-card";
import { HeaderActions } from "@/src/components/sync-badge";
import { TabHeader, useTabBottomPadding } from "@/src/components/tab-screen";
import { Button } from "@/src/components/ui";
import { ProPrompt } from "@/src/components/pro-prompt";
import { useEntitlement } from "@/src/billing/entitlement";
import { money } from "@/src/format";
import { DUTY_LABEL, afterTax, formatHours, toISODate } from "@/src/shifts/calc";
import { useShifts } from "@/src/shifts/provider";
import { PeriodKind, periodRange, stepPeriod, summarise } from "@/src/shifts/stats";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

function Stat({ label, value, testID, tone }: { label: string; value: string; testID: string; tone?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tone ? { color: tone } : null]} testID={testID}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function Earnings() {
  const styles = useStyles();
  const { colors } = useTheme();
  const bottom = useTabBottomPadding();
  const { user } = useAuth();
  const { shifts, syncNow } = useShifts();
  const cur = user?.currency;
  const { isPro } = useEntitlement();
  const [kind, setKind] = useState<PeriodKind>("month");
  const [anchor, setAnchor] = useState(toISODate(new Date()));
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const range = isPro ? periodRange(kind, anchor) : periodRange("week", toISODate(new Date()));
  const t = useMemo(() => summarise(shifts, range.from, range.to), [shifts, range.from, range.to]);
  // For monthly-paid workers: what this period's shifts should pay (worked so far + booked still to work).
  const expected = t.estimated + t.projected;
  const isMonth = isPro && kind === "month";

  return (
    <View style={styles.root} testID="earnings-screen">
      <TabHeader title="Earnings" right={<HeaderActions />} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
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
        {isPro && (
        <>
        <Segmented<PeriodKind>
          testPrefix="earnings-period"
          value={kind}
          onChange={setKind}
          options={[
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
            { value: "year", label: "Year" },
          ]}
        />
        <View style={styles.nav}>
          <Pressable testID="earnings-prev" accessibilityLabel="Previous period" onPress={() => setAnchor(stepPeriod(kind, anchor, -1))} style={styles.navBtn}>
            <Ionicons name="chevron-back" size={20} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.navLabel} testID="earnings-period-label">
            {range.label}
          </Text>
          <Pressable testID="earnings-next" accessibilityLabel="Next period" onPress={() => setAnchor(stepPeriod(kind, anchor, 1))} style={styles.navBtn}>
            <Ionicons name="chevron-forward" size={20} color={colors.onSurface} />
          </Pressable>
        </View>
        </>
        )}
        {!isPro && (
          <Text style={styles.navLabel} testID="earnings-period-label">
            {range.label}
          </Text>
        )}

        <ProvisionalBanner count={t.provisional} testID="earnings-provisional-banner" />

        <View style={styles.hero} testID="earnings-summary-card">
          <Text style={styles.heroLabel} testID="earnings-hero-label">
            {isMonth ? `EXPECTED PAY · END OF ${range.label.toUpperCase()}` : `EXPECTED PAY · ${range.label.toUpperCase()}`}
          </Text>
          <Text style={styles.heroValue} testID="earnings-estimated">
            {money(expected, cur)}
          </Text>
          <Text style={styles.heroSub}>Before tax · {money(t.estimated, cur)} worked so far + {money(t.projected, cur)} booked</Text>
          {user?.tax_rate != null && (
            <Text style={styles.heroTax} testID="earnings-after-tax">
              After {user.tax_rate}% tax: {money(afterTax(expected, user.tax_rate), cur)}
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.stats}>
            <Stat testID="earnings-worked" label="Worked so far" value={money(t.estimated, cur)} />
            <Stat testID="earnings-projected" label="Booked still to work" value={money(t.projected, cur)} />
            <Stat testID="earnings-completed" label="Completed shifts" value={String(t.completed)} />
            <Stat testID="earnings-booked" label="Booked shifts" value={String(t.booked)} />
            <Stat testID="earnings-hours" label="Completed hours" value={t.hours.toFixed(2)} />
          </View>
          {t.missingRate && (
            <Text style={styles.warnText} testID="earnings-missing-rate">
              Some completed shifts have no hourly rate, so they aren&apos;t included in estimates.
            </Text>
          )}
        </View>

        {isPro ? (
        <View style={styles.card} testID="earnings-by-duty">
          <Text style={styles.cardTitle}>By duty type</Text>
          {t.byDuty.map((d) => {
            const [fg] = dutyColors(colors, d.duty);
            return (
              <View key={d.duty} style={styles.dutyRow} testID={`earnings-duty-${d.duty}`}>
                <View style={[styles.dot, { backgroundColor: fg }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.dutyName}>{DUTY_LABEL[d.duty]}</Text>
                  <Text style={styles.dutySub}>
                    {d.count} shift{d.count === 1 ? "" : "s"} · {formatHours(d.hours)}
                  </Text>
                </View>
                <Text style={styles.dutyValue}>{money(d.estimated, cur)}</Text>
              </View>
            );
          })}
        </View>
        ) : (
          <ProPrompt testID="earnings-pro-prompt" title="Unlock the full earnings dashboard" body="Week, month and year views, duty-type breakdowns and PDF reports with Pro." />
        )}

        <Button testID="earnings-export-button" label="Export report" icon="share-outline" onPress={() => setExporting(true)} />
        <Text style={styles.disclaimer}>Estimates only — not official payroll records. Expected pay adds completed shifts and booked shifts in this period; check your payslip for the final amount.</Text>
      </ScrollView>
      <ExportSheet visible={exporting} onClose={() => setExporting(false)} shifts={shifts} label={range.label} from={range.from} to={range.to} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: spacing.lg, gap: spacing.lg },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceSecondary },
  navLabel: { fontFamily: fonts.bold, fontSize: type.lg, color: c.onSurface },
  hero: { backgroundColor: c.hero, borderRadius: radius.lg, padding: spacing.xl },
  heroLabel: { fontFamily: fonts.bold, fontSize: type.sm, color: c.heroAccent, letterSpacing: 1.2 },
  heroValue: { fontFamily: fonts.extrabold, fontSize: type.display, color: c.onHero, marginTop: spacing.sm },
  heroSub: { fontFamily: fonts.medium, fontSize: type.base, color: c.onHeroMuted, marginTop: spacing.sm },
  heroTax: { fontFamily: fonts.bold, fontSize: type.lg, color: c.heroAccent, marginTop: spacing.sm },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: c.border },
  cardTitle: { fontFamily: fonts.bold, fontSize: type.lg, color: c.onSurface, marginBottom: spacing.sm },
  stats: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.lg },
  stat: { width: "50%" },
  statValue: { fontFamily: fonts.bold, fontSize: type.xl, color: c.onSurface },
  statLabel: { fontFamily: fonts.medium, fontSize: type.sm, color: c.muted, marginTop: 2 },
  warnText: { fontFamily: fonts.medium, fontSize: type.sm, color: c.warning, marginTop: spacing.sm },
  dutyRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.divider },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dutyName: { fontFamily: fonts.semibold, fontSize: type.base, color: c.onSurface },
  dutySub: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted },
  dutyValue: { fontFamily: fonts.bold, fontSize: type.base, color: c.onSurface },
  disclaimer: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted },
}));
