import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEntitlement } from "@/src/billing/entitlement";
import { PRODUCTS, PlanKey, Prices, billingAvailable, buy, loadPrices, openManageSubscription, restorePurchases } from "@/src/billing/play";
import { Segmented } from "@/src/components/segmented";
import { StackHeader } from "@/src/components/stack-header";
import { useToast } from "@/src/components/toast";
import { Button } from "@/src/components/ui";
import { endDate } from "@/src/format";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

const ROWS: [string, boolean | string, boolean | string][] = [
  ["Shift calendar & offline recording", true, true],
  ["Upcoming shifts", "Up to 3", "Unlimited"],
  ["History in the app", "Last 7 days", "Unlimited"],
  ["Payments per shift", "One", "Multiple"],
  ["Earnings", "This week", "Full dashboard"],
  ["Outstanding & overdue payments", false, true],
  ["Custom shift templates", "One", "Unlimited"],
  ["CSV & PDF reports", false, true],
  ["Sync & backup", "One phone", "All devices"],
  ["Download my data (JSON)", true, true],
]

export default function Upgrade() {
  const { isPro, ent, apply } = useEntitlement();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const [plan, setPlan] = useState<PlanKey>("annual");
  const [prices, setPrices] = useState<Prices | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadPrices(!!ent?.founding_eligible).then(setPrices);
  }, [ent?.founding_eligible]);

  const subscribe = async () => {
    if (!ent) return toast("Connect to the internet to subscribe", "error");
    setBusy(true);
    try {
      await buy(plan, ent.account_ref, !!ent.founding_eligible); // Pro is granted only after the server verifies it with Google
    } catch (e) {
      toast((e as Error).message, "info");
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    setBusy(true);
    try {
      const e = await restorePurchases();
      await apply(e);
      toast(e.plan === "pro" ? "Pro restored" : "No active subscription found for this Google account", e.plan === "pro" ? "success" : "info");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root} testID="upgrade-screen">
      <StackHeader title="DutyConnect Pro" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>{isPro ? "YOUR PLAN" : "UPGRADE"}</Text>
          <Text style={styles.heroTitle} testID="upgrade-plan-title">
            {isPro ? "You're on Pro" : "Stay in control of every shift and payment"}
          </Text>
          <Text style={styles.heroBody}>
            {isPro
              ? ent?.will_renew
                ? `Renews automatically on ${endDate(ent?.expires_at)}.`
                : `Cancelled – Pro stays active until ${endDate(ent?.expires_at)}, then you return to Free.`
              : "Your records are always yours: nothing is deleted if you cancel or downgrade."}
          </Text>
        </View>

        <View style={styles.card} testID="upgrade-comparison">
          <View style={styles.row}>
            <Text style={[styles.cell, styles.head, { flex: 1.6 }]}>Feature</Text>
            <Text style={[styles.cell, styles.head]}>Free</Text>
            <Text style={[styles.cell, styles.head]}>Pro</Text>
          </View>
          {ROWS.map(([label, free, pro]) => (
            <View key={label} style={styles.row}>
              <Text style={[styles.cell, { flex: 1.6 }]}>{label}</Text>
              {[free, pro].map((v, i) => (
                <View key={i} style={styles.cellBox}>
                  {typeof v === "string" ? (
                    <Text style={styles.cellSmall}>{v}</Text>
                  ) : (
                    <Ionicons name={v ? "checkmark-circle" : "remove-circle-outline"} size={18} color={v ? colors.success : colors.muted} />
                  )}
                </View>
              ))}
            </View>
          ))}
        </View>

        {!isPro && (
          <>
            <Segmented<PlanKey>
              testPrefix="upgrade-plan"
              value={plan}
              onChange={setPlan}
              options={[
                { value: "monthly", label: prices ? `Monthly · ${prices.monthly.price}` : "Monthly" },
                { value: "annual", label: prices ? `Annual · ${prices.annual.price}` : "Annual" },
              ]}
            />
            {prices?.[plan].intro && (
              <Text style={styles.offer} testID="upgrade-founding-offer">
                Founding member price: {prices[plan].intro} for the first 12 months, then {prices[plan].price} per {plan === "annual" ? "year" : "month"}. Google Play
                will show the exact terms before you confirm.
              </Text>
            )}
            <Button
              testID="upgrade-subscribe-button"
              label={prices ? `Subscribe – ${prices[plan].intro ?? prices[plan].price} per ${plan === "annual" ? "year" : "month"}` : "Subscribe"}
              loading={busy}
              onPress={subscribe}
            />
            {!prices && <Text style={styles.note}>Prices are shown by Google Play in your local currency.</Text>}
            {!billingAvailable && (
              <Text style={styles.note} testID="upgrade-unavailable-note">
                Subscriptions are available in the Google Play version of DutyConnect (not in Expo Go or the web preview).
              </Text>
            )}
          </>
        )}
        {isPro && (
          <Button testID="upgrade-manage-button" label="Manage subscription in Google Play" variant="secondary" onPress={() => openManageSubscription(ent?.product_id ?? PRODUCTS[plan])} />
        )}
        <Button testID="upgrade-restore-button" label="Restore purchases" variant="ghost" onPress={restore} disabled={busy} />
        <Text style={styles.note}>
          Payment is taken by Google Play. Subscriptions renew automatically at the price shown unless cancelled at least 24 hours before the renewal date.
          Cancel any time in Google Play – Pro continues until the end of the period you have paid for. Prices may vary by country. No free trial.
        </Text>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: spacing.lg, gap: spacing.lg },
  hero: { backgroundColor: c.hero, borderRadius: radius.lg, padding: spacing.xl },
  heroLabel: { fontFamily: fonts.bold, fontSize: type.sm, color: c.heroAccent, letterSpacing: 1.2 },
  heroTitle: { fontFamily: fonts.bold, fontSize: type.xxl, color: c.onHero, marginTop: spacing.sm },
  heroBody: { fontFamily: fonts.regular, fontSize: type.base, color: c.onHeroMuted, marginTop: spacing.xs },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  cell: { flex: 1, fontFamily: fonts.medium, fontSize: type.sm + 1, color: c.onSurface },
  head: { fontFamily: fonts.bold, color: c.onSurfaceSecondary },
  cellBox: { flex: 1, alignItems: "flex-start" },
  cellSmall: { fontFamily: fonts.medium, fontSize: type.sm, color: c.onSurfaceSecondary },
  offer: { fontFamily: fonts.semibold, fontSize: type.sm + 1, color: c.onSurface, backgroundColor: c.brandTertiary, borderRadius: radius.md, padding: spacing.md },
  note: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted, lineHeight: 18 },
}));
