import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NotificationPrefs, useAuth } from "@/src/auth";
import { StackHeader } from "@/src/components/stack-header";
import { useToast } from "@/src/components/toast";
import { Button, Card, SectionTitle, TextField, tap } from "@/src/components/ui";
import { currencySymbol } from "@/src/format";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

const CATEGORIES = ["Prison Officer", "Operational Support Grade", "Custodial Manager", "Security Officer", "Other"];
const CURRENCIES = ["GBP", "EUR", "USD"] as const;
const PREFS: { key: keyof NotificationPrefs; label: string }[] = [
  { key: "shift_reminders", label: "Upcoming shift reminders" },
  { key: "payment_reminders", label: "Outstanding payment reminders" },
  { key: "product_updates", label: "Product news & updates" },
];

function Chips<T extends string>({ options, value, onChange, testPrefix }: { options: readonly T[]; value: T; onChange: (v: T) => void; testPrefix: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable
            key={o}
            testID={`${testPrefix}-${o.toLowerCase().replace(/\s+/g, "-")}`}
            onPress={() => {
              tap();
              onChange(o);
            }}
            style={[styles.chip, on && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}
          >
            <Text style={[styles.chipText, on && { color: colors.onBrandPrimary }]}>{o}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function Profile() {
  const { user, updateProfile } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(user?.full_name ?? "");
  const [category, setCategory] = useState(user?.professional_category ?? "Prison Officer");
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>(user?.currency ?? "GBP");
  const [rate, setRate] = useState(user?.hourly_rate != null ? String(user.hourly_rate) : "");
  const [prefs, setPrefs] = useState<NotificationPrefs>(
    user?.notification_prefs ?? { shift_reminders: true, payment_reminders: true, product_updates: false },
  );
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const r = rate.trim().replace(",", ".");
    const n = r === "" ? null : Number(r);
    const e = {
      name: name.trim().length < 2 ? "Enter your full name." : null,
      rate: n !== null && (!isFinite(n) || n <= 0 || n > 500) ? "Enter a rate between 0.01 and 500." : null,
    };
    setErrors(e);
    if (e.name || e.rate) return;
    setSaving(true);
    try {
      await updateProfile({
        full_name: name.trim(),
        professional_category: category,
        currency,
        notification_prefs: prefs,
        ...(n === null ? { clear_hourly_rate: true } : { hourly_rate: n }),
      });
      toast("Profile saved");
      router.back();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root} testID="profile-screen">
      <StackHeader title="Profile" />
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
      >
        <View style={styles.form}>
          <TextField testID="profile-name-input" label="Full name" value={name} onChangeText={setName} error={errors.name} hint="Used to pre-fill the officer name on your shifts." />
          <View style={styles.readonly}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.readonlyValue} testID="profile-email-text">
              {user?.email}
            </Text>
          </View>
        </View>

        <SectionTitle>Professional category</SectionTitle>
        <Chips options={CATEGORIES} value={category} onChange={setCategory} testPrefix="profile-category" />

        <SectionTitle>PP pay</SectionTitle>
        <View style={styles.form}>
          <Chips options={CURRENCIES} value={currency} onChange={setCurrency} testPrefix="profile-currency" />
          <TextField
            testID="profile-rate-input"
            label="Fixed hourly PP rate"
            prefix={currencySymbol(currency)}
            value={rate}
            onChangeText={setRate}
            keyboardType="decimal-pad"
            placeholder="e.g. 30.00"
            error={errors.rate}
            hint="Changing your rate only affects new shifts. Past shifts keep the rate applied at the time."
          />
        </View>

        <SectionTitle>Notifications</SectionTitle>
        <Card style={styles.group}>
          {PREFS.map((p, i) => (
            <View key={p.key} style={[styles.prefRow, i < PREFS.length - 1 && styles.divider]}>
              <Text style={styles.prefLabel}>{p.label}</Text>
              <Switch
                testID={`profile-pref-${p.key}`}
                value={prefs[p.key]}
                onValueChange={(v) => setPrefs((s) => ({ ...s, [p.key]: v }))}
                trackColor={{ true: colors.brandSecondary, false: colors.surfaceTertiary }}
                thumbColor="#FFFFFF"
              />
            </View>
          ))}
        </Card>

        <Button testID="profile-save-button" label="Save changes" onPress={save} loading={saving} style={{ marginTop: spacing.xl }} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: spacing.lg },
  form: { gap: spacing.lg },
  label: { fontFamily: fonts.semibold, fontSize: type.sm + 1, color: c.onSurfaceSecondary },
  readonly: { gap: spacing.xs + 2 },
  readonlyValue: { fontFamily: fonts.regular, fontSize: type.lg, color: c.muted, paddingVertical: spacing.xs },
  chips: { gap: spacing.sm, paddingRight: spacing.lg, height: 40, alignItems: "center" },
  chip: {
    height: 36,
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceSecondary,
    justifyContent: "center",
  },
  chipText: { fontFamily: fonts.semibold, fontSize: type.base, color: c.onSurfaceSecondary },
  group: { padding: 0, overflow: "hidden" },
  prefRow: { flexDirection: "row", alignItems: "center", minHeight: 56, paddingHorizontal: spacing.lg, gap: spacing.md },
  prefLabel: { flex: 1, fontFamily: fonts.medium, fontSize: type.base, color: c.onSurface },
  divider: { borderBottomWidth: 1, borderBottomColor: c.divider },
}));
