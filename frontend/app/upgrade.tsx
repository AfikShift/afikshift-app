import Ionicons from "@react-native-vector-icons/ionicons";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEntitlement } from "@/src/billing/entitlement";
import { STORE, STORE_NAME } from "@/src/billing/store";
import { PRODUCTS, PlanKey, Prices, billingAvailable, buy, loadPrices, openManageSubscription, referencePrices, restorePurchases } from "@/src/billing/play";
import { StackHeader } from "@/src/components/stack-header";
import { useToast } from "@/src/components/toast";
import { Button } from "@/src/components/ui";
import { endDate } from "@/src/format";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

const openPublic = (page: "privacy" | "terms") => WebBrowser.openBrowserAsync(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/public/${page}`);

const TERMS = [
  `Payment is taken by ${STORE_NAME} when you confirm your purchase.`,
  "Your subscription renews automatically at the same price (monthly, or every 6 months) unless you cancel at least 24 hours before the renewal date.",
  `Cancel any time in ${STORE === "aptoide" ? "the Aptoide app or wallet" : "Google Play → Payments & subscriptions"}. Pro stays active until the end of the period you've paid for.`,
  `If a renewal payment fails, ${STORE_NAME} retries it for a short grace period and Pro keeps working. If it still fails, your account returns to Free.`,
  "Moving back to Free never deletes your data. Older history and extra features reappear when you subscribe again.",
  `No free trial. Refunds are handled by ${STORE_NAME} under its refund policy.`,
];
const DISCLAIMER =
  "DutyConnect is an independently developed and operated application. It is not affiliated with, endorsed by, sponsored by or officially connected to the government or any government agency. It is intended for personal shift, earnings and payment tracking and is not an official payroll or workforce management system.";

const perMonth = (p: { amount: number; currency: string }) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: p.currency }).format(Math.round((p.amount / 6) * 100) / 100);
/** % saved on the six-month plan against paying monthly for six months. */
const saving = (p: Prices) => Math.round((1 - p.sixmonth.amount / (6 * p.monthly.amount)) * 100);

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
  const [plan, setPlan] = useState<PlanKey>("sixmonth");
  const [prices, setPrices] = useState<Prices | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadPrices().then((p) => setPrices(p ?? referencePrices()));
  }, []);

  const subscribe = async () => {
    if (!ent) return toast("Connect to the internet to subscribe", "error");
    setBusy(true);
    try {
      await buy(plan, ent.account_ref); // Pro is granted only after the server verifies it with Google
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
            <View style={styles.plans} accessibilityRole="radiogroup">
              {(["monthly", "sixmonth"] as PlanKey[]).map((k) => {
                const on = plan === k;
                const p = prices?.[k];
                return (
                  <Pressable
                    key={k}
                    testID={`upgrade-plan-${k}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => setPlan(k)}
                    style={[styles.planCard, on && { borderColor: colors.brandSecondary, borderWidth: 2 }]}
                  >
                    {k === "sixmonth" && prices && saving(prices) > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>BEST VALUE · SAVE {saving(prices)}%</Text>
                      </View>
                    )}
                    <View style={styles.planTop}>
                      <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? colors.brandSecondary : colors.muted} />
                      <Text style={styles.planName}>{k === "monthly" ? "Monthly" : "Six-month plan"}</Text>
                    </View>
                    {p && (
                      <>
                        <Text style={styles.planPrice} testID={`upgrade-price-${k}`}>
                          {k === "monthly" ? p.price : perMonth(p)}
                          <Text style={styles.planPer}> / month</Text>
                        </Text>
                        <Text style={styles.planSub}>{k === "monthly" ? "Billed every month" : `${p.price} billed every 6 months`}</Text>
                      </>
                    )}
                  </Pressable>
                );
              })}
            </View>
            <Button
              testID="upgrade-subscribe-button"
              label={prices ? `Subscribe – ${prices[plan].price} ${plan === "sixmonth" ? "every 6 months" : "per month"}` : "Subscribe"}
              loading={busy}
              onPress={subscribe}
            />
            <Text style={styles.note}>Prices shown in GBP and include VAT. {STORE_NAME} shows the final price in your local currency before you confirm.</Text>
            {!billingAvailable && (
              <Text style={styles.note} testID="upgrade-unavailable-note">
                {STORE === "aptoide" ? "Aptoide payments are being set up and will be available in a coming update." : "Subscriptions are available in the Google Play and Aptoide versions of DutyConnect (not in Expo Go or the web preview)."}
              </Text>
            )}
          </>
        )}
        {isPro && (
          <Button testID="upgrade-manage-button" label={`Manage subscription in ${STORE_NAME}`} variant="secondary" onPress={() => openManageSubscription(ent?.product_id ?? PRODUCTS[plan])} />
        )}
        <Button testID="upgrade-restore-button" label="Restore purchases" variant="ghost" onPress={restore} disabled={busy} />

        <View style={styles.terms} testID="upgrade-terms">
          <Text style={styles.termsTitle}>Subscription terms</Text>
          {TERMS.map((t) => (
            <View key={t} style={styles.termRow}>
              <Ionicons name="checkmark" size={16} color={colors.brandSecondary} />
              <Text style={styles.termText}>{t}</Text>
            </View>
          ))}
          <View style={styles.links}>
            <Pressable testID="upgrade-terms-link" onPress={() => openPublic("terms")} hitSlop={8}>
              <Text style={styles.link}>Terms of service</Text>
            </Pressable>
            <Pressable testID="upgrade-privacy-link" onPress={() => openPublic("privacy")} hitSlop={8}>
              <Text style={styles.link}>Privacy policy</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.disclaimer} testID="upgrade-disclaimer">
          {DISCLAIMER}
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
  plans: { gap: spacing.md },
  planCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, padding: spacing.lg, gap: spacing.xs },
  planTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  planName: { fontFamily: fonts.bold, fontSize: type.lg, color: c.onSurface },
  planPrice: { fontFamily: fonts.bold, fontSize: type.xl, color: c.onSurface, marginTop: spacing.xs },
  planPer: { fontFamily: fonts.medium, fontSize: type.base, color: c.onSurfaceSecondary },
  planSub: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted },
  badge: { alignSelf: "flex-start", backgroundColor: c.brandSecondary, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2, marginBottom: spacing.xs },
  badgeText: { fontFamily: fonts.bold, fontSize: type.sm - 1, color: "#FFFFFF", letterSpacing: 0.6 },
  terms: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.lg, gap: spacing.sm },
  termsTitle: { fontFamily: fonts.bold, fontSize: type.base, color: c.onSurface },
  termRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  termText: { flex: 1, fontFamily: fonts.regular, fontSize: type.sm, color: c.onSurfaceSecondary, lineHeight: 19 },
  links: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.xs },
  link: { fontFamily: fonts.semibold, fontSize: type.sm, color: c.brandSecondary, textDecorationLine: "underline" },
  disclaimer: { fontFamily: fonts.regular, fontSize: type.sm - 1, color: c.muted, lineHeight: 17 },
  note: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted, lineHeight: 18 },
}));
