import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { useAuth } from "@/src/auth";
import { ProvisionalBanner } from "@/src/components/provisional-banner";
import { SyncBadge } from "@/src/components/sync-badge";
import { TabHeader, useTabBottomPadding } from "@/src/components/tab-screen";
import { tap } from "@/src/components/ui";
import { firstName, greeting, money } from "@/src/format";
import { DUTY_LABEL, crossesMidnight, formatDateLong, formatHours, toISODate } from "@/src/shifts/calc";
import { useShifts } from "@/src/shifts/provider";
import { monthStats, nextShift, periodRange, summarise } from "@/src/shifts/stats";
import { useEntitlement } from "@/src/billing/entitlement";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

function QuickAction({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [styles.qa, pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 }]}
    >
      <View style={styles.qaIcon}>
        <Ionicons name={icon} size={20} color={colors.onBrandTertiary} />
      </View>
      <Text style={styles.qaLabel}>{label}</Text>
    </Pressable>
  );
}

function Stat({ label, value, testID }: { label: string; value: string; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} testID={testID}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function Home() {
  const { user, refreshUser } = useAuth();
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const bottom = useTabBottomPadding();
  const [refreshing, setRefreshing] = useState(false);
  const month = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const { shifts, syncNow, syncBlocked, makeSyncPhone } = useShifts();
  const { isPro } = useEntitlement();
  const stats = useMemo(() => {
    if (isPro) return monthStats(shifts, toISODate(new Date()).slice(0, 7));
    const w = periodRange("week", toISODate(new Date())); // Free: basic current-week summary
    return summarise(shifts, w.from, w.to);
  }, [shifts, isPro]);
  const next = useMemo(() => nextShift(shifts), [shifts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshUser().catch(() => {}), syncNow()]);
    setRefreshing(false);
  }, [refreshUser, syncNow]);

  return (
    <View style={styles.root} testID="home-screen">
      <TabHeader
        subtitle={greeting()}
        title={firstName(user?.full_name) || "there"}
        right={<SyncBadge />}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandSecondary} />}
      >
        {syncBlocked && (
          <View style={styles.banner} testID="home-sync-blocked-banner">
            <Ionicons name="phone-portrait-outline" size={20} color={colors.warning} />
            <View style={{ flex: 1, gap: spacing.sm }}>
              <Text style={styles.bannerTitle}>Another phone is your sync phone</Text>
              <Text style={styles.bannerBody}>
                Free syncs from one phone. Records on this phone are safe and keep working offline. Upgrade to Pro to sync every device, or make this your sync phone.
              </Text>
              <Pressable testID="home-make-sync-phone" onPress={() => makeSyncPhone().catch(() => {})}>
                <Text style={[styles.bannerTitle, { color: colors.brandSecondary }]}>Use this phone for sync</Text>
              </Pressable>
              <Pressable testID="home-sync-upgrade" onPress={() => router.push("/upgrade")}>
                <Text style={[styles.bannerTitle, { color: colors.brandSecondary }]}>See Pro</Text>
              </Pressable>
            </View>
          </View>
        )}
        {user?.hourly_rate == null && (
          <Animated.View entering={FadeInDown.duration(400)}>
            <Pressable testID="home-set-rate-banner" onPress={() => router.push("/profile")} style={styles.banner}>
              <Ionicons name="cash-outline" size={20} color={colors.warning} />
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>Set your default hourly rate</Text>
                <Text style={styles.bannerBody}>Needed to estimate your earnings.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          </Animated.View>
        )}

        <Animated.View entering={FadeInDown.delay(60).duration(450)} style={styles.hero} testID="home-next-shift-card">
          <View style={styles.heroTop}>
            <Text style={styles.heroLabel}>NEXT SHIFT</Text>
            {next && (
              <View style={styles.heroPeriod}>
                <Ionicons name={next.shift_period === "night" ? "moon" : "sunny"} size={14} color={colors.heroAccent} />
                <Text style={styles.heroPeriodText}>{next.shift_period === "night" ? "Night" : "Day"}</Text>
              </View>
            )}
          </View>
          {next ? (
            <>
              <Text style={styles.heroTitle} testID="home-next-shift-title">
                {DUTY_LABEL[next.duty_type]}
              </Text>
              <Text style={styles.heroWhen} testID="home-next-shift-when">
                {formatDateLong(next.date)} · {next.start_time}–{next.end_time}
                {crossesMidnight(next.start_time, next.end_time) ? " (+1)" : ""}
              </Text>
              <Text style={styles.heroBody}>
                {next.location || "No location"} · {formatHours(next.payable_hours)} payable
                {next.estimated_earnings != null ? ` · est. ${money(next.estimated_earnings, user?.currency)}` : ""}
              </Text>
              <Pressable testID="home-hero-view-shift-button" onPress={() => router.push({ pathname: "/(tabs)/shifts", params: { date: next.date } })} style={styles.heroBtn}>
                <Ionicons name="calendar" size={16} color={colors.hero} />
                <Text style={styles.heroBtnText}>View in calendar</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.heroTitle}>No upcoming shifts</Text>
              <Text style={styles.heroBody}>Your next booked shift will appear here.</Text>
              <Pressable testID="home-hero-add-shift-button" onPress={() => router.push("/shift-form")} style={styles.heroBtn}>
                <Ionicons name="add" size={18} color={colors.hero} />
                <Text style={styles.heroBtnText}>Add a shift</Text>
              </Pressable>
            </>
          )}
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(120).duration(450)} style={styles.qaRow}>
          <QuickAction testID="home-quick-add-shift" icon="add-circle-outline" label="Add Shift" onPress={() => router.push("/shift-form")} />
          <QuickAction testID="home-quick-calendar" icon="calendar-outline" label="Calendar" onPress={() => router.push("/(tabs)/shifts")} />
          <QuickAction testID="home-quick-messages" icon="chatbubbles-outline" label="Messages" onPress={() => router.push("/messages")} />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(180).duration(450)} style={styles.card} testID="home-month-summary-card">
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>{isPro ? "This month" : "This week"}</Text>
            <Text style={styles.cardSub}>{month}</Text>
          </View>
          <View style={styles.stats}>
            <Stat testID="home-stat-completed" label="Completed shifts" value={String(stats.completed)} />
            <Stat testID="home-stat-hours" label="Completed hours" value={stats.hours.toFixed(2)} />
            <Stat testID="home-stat-estimated" label="Estimated gross" value={money(stats.estimated, user?.currency)} />
            <Stat testID="home-stat-outstanding" label="Not yet paid (est.)" value={money(stats.outstanding, user?.currency)} />
          </View>
          <Text style={styles.projected} testID="home-stat-booked">
            {stats.booked} booked · {money(stats.projected, user?.currency)} projected
          </Text>
          <Text style={styles.disclaimer}>Estimates only — not official payroll records. Booked shifts are projected, not earned.</Text>
          <ProvisionalBanner count={stats.provisional} testID="home-provisional-banner" />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(240).duration(450)}>
          <Pressable testID="home-messages-card" onPress={() => router.push("/messages")} style={styles.msgCard}>
            <View style={styles.msgIcon}>
              <Ionicons name="mail-unread-outline" size={20} color={colors.onBrandTertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.msgTitle}>SMS forwarding</Text>
              <Text style={styles.msgBody}>
                {Platform.OS === "ios" ? "Not available on iPhone — tap to learn why" : "Android only · coming in a later phase"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: spacing.lg, gap: spacing.lg },
  sync: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: c.successSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    marginBottom: spacing.xs,
  },
  syncText: { fontFamily: fonts.semibold, fontSize: type.sm, color: c.success },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: c.warningSoft,
  },
  bannerTitle: { fontFamily: fonts.semibold, fontSize: type.base, color: c.onSurface },
  bannerBody: { fontFamily: fonts.regular, fontSize: type.sm, color: c.onSurfaceSecondary, marginTop: 2 },
  hero: { backgroundColor: c.hero, borderRadius: radius.lg, padding: spacing.xl, overflow: "hidden" },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroLabel: { fontFamily: fonts.bold, fontSize: type.sm, color: c.heroAccent, letterSpacing: 1.2 },
  heroTitle: { fontFamily: fonts.bold, fontSize: type.xxl, color: c.onHero, marginTop: spacing.md },
  heroWhen: { fontFamily: fonts.semibold, fontSize: type.lg, color: c.onHero, marginTop: spacing.xs },
  heroPeriod: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  heroPeriodText: { fontFamily: fonts.semibold, fontSize: type.sm, color: c.heroAccent },
  projected: { fontFamily: fonts.semibold, fontSize: type.sm + 1, color: c.onSurfaceSecondary, marginTop: spacing.lg },
  heroBody: { fontFamily: fonts.regular, fontSize: type.base, color: c.onHeroMuted, marginTop: spacing.xs },
  heroBtn: {
    marginTop: spacing.lg,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: c.heroAccent,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    borderRadius: radius.pill,
  },
  heroBtnText: { fontFamily: fonts.bold, fontSize: type.base, color: c.hero },
  qaRow: { flexDirection: "row", gap: spacing.md },
  qa: {
    flex: 1,
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  qaIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: c.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  qaLabel: { fontFamily: fonts.semibold, fontSize: type.sm + 1, color: c.onSurface },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: c.border },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  cardTitle: { fontFamily: fonts.bold, fontSize: type.lg, color: c.onSurface },
  cardSub: { fontFamily: fonts.medium, fontSize: type.sm, color: c.muted },
  stats: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.md, rowGap: spacing.lg },
  stat: { width: "50%" },
  statValue: { fontFamily: fonts.bold, fontSize: type.xl, color: c.onSurface },
  statLabel: { fontFamily: fonts.medium, fontSize: type.sm, color: c.muted, marginTop: 2 },
  disclaimer: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted, marginTop: spacing.xs },
  msgCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  msgIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: c.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  msgTitle: { fontFamily: fonts.semibold, fontSize: type.lg, color: c.onSurface },
  msgBody: { fontFamily: fonts.regular, fontSize: type.sm + 1, color: c.muted, marginTop: 2 },
}));
