import Ionicons from "@react-native-vector-icons/ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Platform, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { request } from "@/src/api";
import { StackHeader } from "@/src/components/stack-header";
import { useToast } from "@/src/components/toast";
import { Card, ListRow, SectionTitle } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

type Programmes = { referrals: boolean; ambassadors: boolean };
type Overview = {
  members: number; pro: number; free: number; new_this_week: number; ambassadors: number;
  referrals_waiting: number; referrals_held: number; referrals_flagged: number; referrals_qualifying: number; rewards_this_month: number; programmes: Programmes;
};
type Activity = { at: string; admin_email: string; action: string; detail: string };

const PROGRAMMES: { key: keyof Programmes; title: string; body: string }[] = [
  { key: "referrals", title: "Referral programme", body: "Off: hidden in the app and no new codes accepted. Rewards already earned can still be approved." },
  { key: "ambassadors", title: "Ambassador programme", body: "Off: ambassadors use the standard monthly reward limit." },
];
const ACTION: Record<string, string> = {
  programme_on: "Switched on", programme_off: "Switched off", referral_approved: "Referral approved",
  referral_cancelled: "Referral cancelled", member_updated: "Member updated",
  free_pro_granted: "Free Pro given", free_pro_removed: "Free Pro removed",
};
const NAME: Record<string, string> = { referrals: "Referral programme", ambassadors: "Ambassador programme" };

const confirm = (msg: string) =>
  Platform.OS === "web"
    ? Promise.resolve(window.confirm(msg))
    : new Promise<boolean>((res) => Alert.alert("Please confirm", msg, [{ text: "Back", style: "cancel", onPress: () => res(false) }, { text: "Confirm", onPress: () => res(true) }]));

/** Admin only. Totals (no personal details), programme switches and recent admin activity. */
export default function AdminDashboard() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const [o, setO] = useState<Overview | null>(null);
  const [log, setLog] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ov, act] = await Promise.all([request("/admin/overview"), request("/admin/activity")]);
      setO(ov);
      setLog(act.activity);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const toggle = async (key: keyof Programmes) => {
    if (!o) return;
    const on = !o.programmes[key];
    if (!(await confirm(`Switch ${on ? "on" : "off"} the ${NAME[key].toLowerCase()}?`))) return;
    setBusy(true);
    try {
      await request("/admin/programmes", { method: "PATCH", body: { [key]: on } });
      toast(`${NAME[key]} switched ${on ? "on" : "off"}`, "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const stats: [string, number][] = o
    ? [
        ["Members", o.members], ["Pro", o.pro], ["Free", o.free], ["New this week", o.new_this_week],
        ["To approve", o.referrals_waiting], ["Held for review", o.referrals_held], ["Flagged", o.referrals_flagged], ["Qualifying", o.referrals_qualifying], ["Rewards this month", o.rewards_this_month],
        ["Ambassadors", o.ambassadors],
      ]
    : [];

  return (
    <View style={styles.root} testID="admin-dashboard-screen">
      <StackHeader title="Admin dashboard" />
      {!o ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
          <SectionTitle>Overview</SectionTitle>
          <View style={styles.grid}>
            {stats.map(([label, n]) => (
              <View key={label} style={styles.stat} testID={`admin-stat-${label.toLowerCase().replace(/ /g, "-")}`}>
                <Text style={styles.statNum}>{n}</Text>
                <Text style={styles.small}>{label}</Text>
              </View>
            ))}
          </View>

          <Card style={styles.group}>
            <ListRow testID="admin-open-referrals" icon="gift-outline" title="Members & referrals" value={o.referrals_waiting + o.referrals_held ? `${o.referrals_waiting + o.referrals_held} to review` : "Free Pro, rewards"} onPress={() => router.push("/admin-referrals")} last />
          </Card>

          <SectionTitle>Programmes</SectionTitle>
          {PROGRAMMES.map((p) => (
            <View key={p.key} style={styles.row} testID={`admin-programme-${p.key}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{p.title}</Text>
                <Text style={styles.small}>{p.body}</Text>
              </View>
              <Switch
                testID={`admin-programme-${p.key}-switch`}
                value={o.programmes[p.key]}
                disabled={busy}
                onValueChange={() => toggle(p.key)}
                trackColor={{ true: colors.brandSecondary, false: colors.border }}
              />
            </View>
          ))}

          <SectionTitle>Recent activity</SectionTitle>
          {log.length === 0 ? (
            <Text style={styles.small} testID="admin-activity-empty">No admin activity yet.</Text>
          ) : (
            log.map((a, i) => (
              <View key={i} style={styles.logRow} testID={`admin-activity-${i}`}>
                <Ionicons name="time-outline" size={16} color={colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>
                    {ACTION[a.action] ?? a.action}
                    {a.action.startsWith("programme_") ? ` · ${NAME[a.detail] ?? a.detail}` : ""}
                  </Text>
                  <Text style={styles.small}>
                    {new Date(a.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {a.admin_email}
                    {!a.action.startsWith("programme_") && a.detail ? ` · ${a.detail}` : ""}
                  </Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: spacing.lg, gap: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  stat: { width: "31%", flexGrow: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border },
  statNum: { fontFamily: fonts.bold, fontSize: type.xl, color: c.onSurface },
  group: { padding: 0, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: c.surfaceSecondary },
  logRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  title: { fontFamily: fonts.semibold, fontSize: type.base, color: c.onSurface },
  small: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted, lineHeight: 18 },
}));
