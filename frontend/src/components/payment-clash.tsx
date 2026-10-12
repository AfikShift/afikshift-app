import Ionicons from "@react-native-vector-icons/ionicons";
import { useState } from "react";
import { Text, View } from "react-native";

import { useToast } from "@/src/components/toast";
import { Button } from "@/src/components/ui";
import { money } from "@/src/format";
import { Payment, PaymentGroup, formatDateLong } from "@/src/shifts/calc";
import { useShifts } from "@/src/shifts/provider";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

/** One unresolved payment clash: shows every competing version and requires an explicit confirmation. */
export function PaymentClash({ shiftId, group, currency }: { shiftId: string; group: PaymentGroup; currency?: string }) {
  const { resolvePaymentClash } = useShifts();
  const toast = useToast();
  const styles = useStyles();
  const { colors } = useTheme();
  const [choice, setChoice] = useState<Payment | null>(null);
  const unresolved = group.kind !== "none";
  const title =
    group.kind === "decision" ? "Different choices made on two devices" : group.kind === "edit" ? "Payment edited on two devices" : "Choice waiting to sync";

  return (
    <View style={styles.clash} testID={`payment-clash-panel-${group.kind}`}>
      <View style={styles.head}>
        <Ionicons name={unresolved ? "alert-circle-outline" : "cloud-upload-outline"} size={18} color={colors.warning} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={styles.sub}>
        {unresolved
          ? "Totals are provisional and count only the lower amount once until you confirm the correct payment. All versions stay in your payment history."
          : "Your choice is saved on this device. Figures stay provisional until it has synced and been confirmed."}
      </Text>
      {unresolved &&
        group.candidates.map((p) => (
          <View key={p.id} style={styles.row} testID={`payment-clash-option-${p.id}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.amount}>{money(p.amount, currency)}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {formatDateLong(p.date)}
                {p.note ? ` · ${p.note}` : ""}
              </Text>
            </View>
            <Button testID={`payment-clash-keep-${p.id}`} label="Keep this" variant="secondary" onPress={() => setChoice(p)} />
          </View>
        ))}
      {choice && (
        <View style={styles.confirm} testID="payment-clash-confirm">
          <Text style={styles.confirmText}>
            Count {money(choice.amount, currency)} as the correct payment? The other version{group.candidates.length > 2 ? "s" : ""} (
            {group.candidates
              .filter((p) => p.id !== choice.id)
              .map((p) => money(p.amount, currency))
              .join(", ")}
            ) will stop counting but stay in your history.
          </Text>
          <View style={styles.btns}>
            <Button testID="payment-clash-cancel" label="Back" variant="ghost" style={{ flex: 1 }} onPress={() => setChoice(null)} />
            <Button
              testID="payment-clash-confirm-button"
              label="Confirm"
              style={{ flex: 1 }}
              onPress={() =>
                resolvePaymentClash(shiftId, choice.id).then(() => {
                  setChoice(null);
                  toast("Choice saved – it will sync to your other devices");
                })
              }
            />
          </View>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  clash: { backgroundColor: c.warningSoft, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: type.base, color: c.onSurface },
  sub: { fontFamily: fonts.regular, fontSize: type.sm, color: c.onSurfaceSecondary },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  amount: { fontFamily: fonts.semibold, fontSize: type.base, color: c.onSurface },
  confirm: { backgroundColor: c.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  confirmText: { fontFamily: fonts.medium, fontSize: type.sm + 1, color: c.onSurface, lineHeight: 19 },
  btns: { flexDirection: "row", gap: spacing.sm },
}));
