import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { request } from "@/src/api";
import { REFERRAL_STATUS } from "@/src/referrals";
import { StackHeader } from "@/src/components/stack-header";
import { useToast } from "@/src/components/toast";
import { Button, Card, SectionTitle, TextField } from "@/src/components/ui";
import { formatDateLong } from "@/src/shifts/calc";
import { fonts, makeStyles, radius, spacing, type } from "@/src/theme";

type Ref = { id: string; status: string; created_at: string; qualifies_at: string | null; referrer_reward: string | null };
type Totals = { signed_up: number; qualifying: number; qualified: number; rewarded: number };
type Data = { enabled: boolean; code: string; download_url: string; this_month: Totals; all_time: Totals; rewards_left_this_month: number; monthly_cap: number; ambassador: boolean; can_apply_code: boolean; apply_window_days: number; my_referral_status: string | null; referrals: Ref[] };


const REWARD: Record<string, string> = { deferred: "1 free month added", bonus: "1 free month added", capped: "Monthly limit reached – no reward" };

export default function Referrals() {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const [data, setData] = useState<Data | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await request("/referrals/me"));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const share = () =>
    Share.share({
      message:
        `🚀 DutyConnect is now available on Aptoide!\n` +
        `We're working towards bringing DutyConnect to the Google Play Store. In the meantime, you don't have to wait!\n\n` +
        `📱 Download DutyConnect through Aptoide and start managing your shifts, tracking your earnings and keeping your payment records organised.\n` +
        `✅ Track Bed Watch and Constant Watch shifts\n✅ Monitor earnings and outstanding payments\n✅ Manage your shifts conveniently\n\n` +
        `Download DutyConnect today: ${data?.download_url}\n` +
        `Join with my code ${data?.code} – we both get a free month of Pro after your first paid month.\n\n` +
        `Google Play Store release coming soon!`,
    });

  const apply = async () => {
    setBusy(true);
    try {
      await request("/referrals/apply", { method: "POST", body: { code: code.trim().toUpperCase() } });
      toast("Referral code added", "success");
      setCode("");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root} testID="referrals-screen">
      <StackHeader title="Refer a friend" />
      {!data ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      ) : !data.enabled ? (
        <Text style={[styles.small, { padding: spacing.lg }]} testID="referrals-paused">
          The referral programme is paused at the moment. Rewards you have already earned are not affected.
        </Text>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load().finally(() => setRefreshing(false)); }} />}
        >
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>{data.ambassador ? "AMBASSADOR CODE" : "YOUR CODE"}</Text>
            <Text style={styles.code} testID="referral-code" selectable>
              {data.code}
            </Text>
            <Text style={styles.heroBody}>
              When a friend joins with your code and completes their first paid month of Pro, you each get 1 free month of Pro.
            </Text>
          </View>
          <Button testID="referral-share-button" label="Share my code" icon="share-outline" onPress={share} />

          <SectionTitle>{data.ambassador ? "Ambassador dashboard" : "Your results"}</SectionTitle>
          <View style={styles.table} testID="referral-totals">
            <View style={styles.tRow}>
              <Text style={[styles.tCell, styles.tHead, { flex: 1.4 }]} />
              <Text style={[styles.tCell, styles.tHead]}>This month</Text>
              <Text style={[styles.tCell, styles.tHead]}>All time</Text>
            </View>
            {(
              [
                ["Signed up", "signed_up"],
                ["Qualifying", "qualifying"],
                ["Qualified", "qualified"],
                ["Rewarded", "rewarded"],
              ] as const
            ).map(([label, k]) => (
              <View key={k} style={styles.tRow}>
                <Text style={[styles.tCell, { flex: 1.4 }]}>{label}</Text>
                <Text style={styles.tCell} testID={`referral-month-${k}`}>{data.this_month[k]}</Text>
                <Text style={styles.tCell} testID={`referral-all-${k}`}>{data.all_time[k]}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.small} testID="referral-rewards-left">
            Rewards left this month: {data.rewards_left_this_month} of {data.monthly_cap}
          </Text>

          {data.can_apply_code && (
            <Card style={styles.card}>
              <Text style={styles.title}>Have a friend's code?</Text>
              <TextField testID="referral-apply-input" label="Referral code" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="e.g. 7KQ2MXRP" />
              <Button testID="referral-apply-button" label="Add code" variant="secondary" loading={busy} disabled={code.trim().length < 4} onPress={apply} />
              <Text style={styles.small}>Codes can be added within {data.apply_window_days} days of joining and before your first subscription.</Text>
            </Card>
          )}
          {data.my_referral_status && (
            <Text style={styles.small} testID="referral-my-status">
              You joined with a friend's code · {REFERRAL_STATUS[data.my_referral_status]}
            </Text>
          )}

          <SectionTitle>Your referrals</SectionTitle>
          {data.referrals.length === 0 ? (
            <Text style={styles.small} testID="referrals-empty">No referrals yet. Share your code to get started.</Text>
          ) : (
            data.referrals.map((r) => (
              <View key={r.id} style={styles.row} testID={`referral-${r.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{REFERRAL_STATUS[r.status] ?? r.status}</Text>
                  <Text style={styles.small}>
                    Joined {formatDateLong(r.created_at.slice(0, 10))}
                    {r.status === "paid" && r.qualifies_at ? ` · qualifies ${formatDateLong(r.qualifies_at.slice(0, 10))}` : ""}
                    {r.referrer_reward ? ` · ${REWARD[r.referrer_reward]}` : ""}
                  </Text>
                </View>
              </View>
            ))
          )}

          <Text style={styles.small}>
            How it works: a referral counts once your friend's first paid month and the 48-hour refund window have passed, and the payment wasn't refunded.
            Rewards are checked before they're added. Up to {data.monthly_cap} rewards per month. If you subscribe, a free month moves your next Google Play
            payment back by a month; otherwise Pro is switched on for a month. Friends are never shown to you by name.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: spacing.lg, gap: spacing.md },
  hero: { backgroundColor: c.hero, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.xs },
  heroLabel: { fontFamily: fonts.bold, fontSize: type.sm, color: c.heroAccent, letterSpacing: 1.2 },
  code: { fontFamily: fonts.bold, fontSize: type.xxl, color: c.onHero, letterSpacing: 3 },
  heroBody: { fontFamily: fonts.regular, fontSize: type.base, color: c.onHeroMuted },
  card: { gap: spacing.md, padding: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.lg, borderRadius: radius.md, backgroundColor: c.surfaceSecondary },
  title: { fontFamily: fonts.semibold, fontSize: type.base, color: c.onSurface },
  small: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted, lineHeight: 18 },
  table: { borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, overflow: "hidden" },
  tRow: { flexDirection: "row", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  tCell: { flex: 1, fontFamily: fonts.medium, fontSize: type.base, color: c.onSurface },
  tHead: { fontFamily: fonts.bold, fontSize: type.sm, color: c.onSurfaceSecondary },
}));
