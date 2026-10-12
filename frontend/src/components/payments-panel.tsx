import Ionicons from "@react-native-vector-icons/ionicons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useAuth } from "@/src/auth";
import { PickerField } from "@/src/components/picker-field";
import { PrivacyNotice } from "@/src/components/privacy-notice";
import { useToast } from "@/src/components/toast";
import { Button, TextField } from "@/src/components/ui";
import { currencySymbol, money } from "@/src/format";
import { PAYMENT_LABEL, Payment, formatDateLong, toISODate, validatePayment } from "@/src/shifts/calc";
import { LocalShift, useShifts } from "@/src/shifts/provider";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

/** Payments recorded against one shift: list, add, edit (replace) and delete. */
export function PaymentsPanel({ shift }: { shift: LocalShift }) {
  const { user } = useAuth();
  const { addPayment, removePayment } = useShifts();
  const toast = useToast();
  const styles = useStyles();
  const { colors } = useTheme();
  const [editing, setEditing] = useState<Payment | "new" | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(toISODate(new Date()));
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const active = (shift.payments ?? []).filter((p) => !p.deleted);
  const cur = user?.currency;
  const out = shift.outstanding;

  const open = (p: Payment | "new") => {
    setEditing(p);
    setErrors({});
    if (p === "new") {
      setAmount(out != null && out > 0 ? out.toFixed(2) : "");
      setDate(toISODate(new Date()));
      setNote("");
    } else {
      setAmount(p.amount.toFixed(2));
      setDate(p.date);
      setNote(p.note);
    }
  };

  const save = async () => {
    const n = Number(amount.replace(",", "."));
    const e = validatePayment(n, date, note.trim());
    setErrors(e);
    if (Object.keys(e).length) return;
    await addPayment(shift.id, { amount: n, date, note, replaces: editing && editing !== "new" ? editing.id : undefined });
    toast(editing === "new" ? "Payment recorded" : "Payment updated");
    setEditing(null);
  };

  if (shift.status !== "completed" && !active.length) {
    return (
      <Text style={styles.hint} testID="payments-locked-hint">
        {shift.status === "cancelled" ? "Payments can't be recorded on a cancelled shift." : "Mark the shift as completed to record payments."}
      </Text>
    );
  }

  const tone = shift.payment_status === "paid" ? [colors.successSoft, colors.success] : shift.payment_status === "partially_paid" ? [colors.warningSoft, colors.warning] : [colors.surfaceTertiary, colors.onSurfaceTertiary];

  return (
    <View style={styles.wrap} testID="payments-panel">
      <View style={styles.head}>
        <Text style={styles.title}>Payments</Text>
        <View style={[styles.pill, { backgroundColor: tone[0] }]}>
          <Text style={[styles.pillText, { color: tone[1] }]} testID="payments-status">
            {PAYMENT_LABEL[shift.payment_status ?? "pending"]}
          </Text>
        </View>
      </View>
      <View style={styles.totals}>
        <Total label="Estimated" value={shift.estimated_earnings != null ? money(shift.estimated_earnings, cur) : "No rate"} testID="payments-estimated" />
        <Total label="Received" value={money(shift.amount_received ?? 0, cur)} testID="payments-received" />
        <Total
          label={out != null && out < 0 ? "Overpaid" : "Outstanding"}
          value={out == null ? "—" : money(Math.abs(out), cur)}
          testID="payments-outstanding"
          danger={out != null && out < 0}
        />
      </View>

      {active.map((p) => (
        <View key={p.id} style={styles.row} testID={`payment-row-${p.id}`}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowAmount}>{money(p.amount, cur)}</Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {formatDateLong(p.date)}
              {p.note ? ` · ${p.note}` : ""}
            </Text>
          </View>
          <Pressable testID={`payment-edit-${p.id}`} onPress={() => open(p)} hitSlop={8} style={styles.icon} accessibilityLabel="Edit payment">
            <Ionicons name="create-outline" size={18} color={colors.onSurfaceSecondary} />
          </Pressable>
          <Pressable
            testID={`payment-delete-${p.id}`}
            onPress={() => removePayment(shift.id, p.id).then(() => toast("Payment deleted"))}
            hitSlop={8}
            style={styles.icon}
            accessibilityLabel="Delete payment"
          >
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </Pressable>
        </View>
      ))}

      {editing ? (
        <View style={styles.form} testID="payment-form">
          <View style={styles.formRow}>
            <View style={{ flex: 1 }}>
              <TextField testID="payment-amount-input" label="Amount received" prefix={currencySymbol(cur)} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} error={errors.amount} />
            </View>
            <PickerField testID="payment-date-input" label="Date paid" mode="date" value={date} onChange={setDate} error={errors.date} />
          </View>
          <TextField testID="payment-note-input" label="Note (optional)" value={note} onChangeText={setNote} maxLength={40} placeholder="e.g. October payslip" error={errors.note} />
          <PrivacyNotice />
          <View style={styles.formRow}>
            <Button testID="payment-cancel-button" label="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setEditing(null)} />
            <Button testID="payment-save-button" label={editing === "new" ? "Save payment" : "Update"} style={{ flex: 1 }} onPress={save} />
          </View>
        </View>
      ) : (
        shift.status === "completed" && (
          <Button testID="payment-add-button" label="Record payment" icon="add" variant="secondary" onPress={() => open("new")} />
        )
      )}
    </View>
  );
}

function Total({ label, value, testID, danger }: { label: string; value: string; testID: string; danger?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.totalValue, danger && { color: colors.error }]} testID={testID}>
        {value}
      </Text>
      <Text style={styles.totalLabel}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: fonts.bold, fontSize: type.lg, color: c.onSurface },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  pillText: { fontFamily: fonts.semibold, fontSize: type.sm },
  totals: { flexDirection: "row", gap: spacing.sm },
  totalValue: { fontFamily: fonts.bold, fontSize: type.lg, color: c.onSurface },
  totalLabel: { fontFamily: fonts.medium, fontSize: type.sm, color: c.muted },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: c.divider },
  rowAmount: { fontFamily: fonts.semibold, fontSize: type.base, color: c.onSurface },
  rowSub: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted },
  icon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  form: { gap: spacing.md },
  formRow: { flexDirection: "row", gap: spacing.sm },
  hint: { fontFamily: fonts.regular, fontSize: type.sm + 1, color: c.muted },
}));
