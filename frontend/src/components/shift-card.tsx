import Ionicons from "@react-native-vector-icons/ionicons";
import { Pressable, Text, View } from "react-native";

import { money } from "@/src/format";
import { DUTY_LABEL, DutyType, PAYMENT_LABEL, STATUS_LABEL, crossesMidnight, formatDateLong, formatHours } from "@/src/shifts/calc";
import { LocalShift } from "@/src/shifts/provider";
import { ThemeColors, fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

export function dutyColors(c: ThemeColors, d: DutyType) {
  return d === "bed_watch" ? [c.dutyBed, c.dutyBedSoft] : d === "constant_watch" ? [c.dutyConstant, c.dutyConstantSoft] : [c.dutyOther, c.dutyOtherSoft];
}

export function ShiftCard({ shift, currency, onPress, showDate = true }: { shift: LocalShift; currency?: string; onPress?: () => void; showDate?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [fg, bg] = dutyColors(colors, shift.duty_type);
  const night = shift.shift_period === "night";
  const statusTone =
    shift.status === "completed" ? [colors.successSoft, colors.success] : shift.status === "cancelled" ? [colors.surfaceTertiary, colors.muted] : [colors.brandTertiary, colors.onBrandTertiary];

  return (
    <Pressable
      testID={`shift-card-${shift.id}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, shift.status === "cancelled" && { opacity: 0.6 }, pressed && { transform: [{ scale: 0.99 }] }]}
    >
      <View style={[styles.bar, { backgroundColor: fg }]} />
      <View style={styles.body}>
        <View style={styles.top}>
          <View style={[styles.duty, { backgroundColor: bg }]}>
            <Text style={[styles.dutyText, { color: fg }]}>{DUTY_LABEL[shift.duty_type]}</Text>
          </View>
          <Ionicons name={night ? "moon" : "sunny"} size={14} color={night ? colors.night : colors.day} />
          <Text style={styles.period}>{night ? "Night" : "Day"}</Text>
          <View style={{ flex: 1 }} />
          {shift._sync !== "synced" && (
            <Ionicons
              testID={`shift-card-sync-${shift.id}`}
              name={shift._sync === "conflict" ? "alert-circle" : "phone-portrait-outline"}
              size={14}
              color={shift._sync === "conflict" ? colors.error : colors.warning}
            />
          )}
          <Text style={styles.hours}>{formatHours(shift.payable_hours)}</Text>
        </View>
        <Text style={styles.time}>
          {showDate ? `${formatDateLong(shift.date)} · ` : ""}
          {shift.start_time}–{shift.end_time}
          {crossesMidnight(shift.start_time, shift.end_time) ? " (+1)" : ""}
        </Text>
        <View style={styles.bottom}>
          <Text style={styles.loc} numberOfLines={1}>
            {shift.location || "No location"}
          </Text>
          <View style={[styles.pill, { backgroundColor: statusTone[0] }]}>
            <Text style={[styles.pillText, { color: statusTone[1] }]}>{STATUS_LABEL[shift.status]}</Text>
          </View>
          {shift.status === "completed" && (
            <View style={[styles.pill, { backgroundColor: shift.payment_status === "paid" ? colors.successSoft : colors.warningSoft }]}>
              <Text style={[styles.pillText, { color: shift.payment_status === "paid" ? colors.success : colors.warning }]}>{PAYMENT_LABEL[shift.payment_status]}</Text>
            </View>
          )}
        </View>
        {shift.status === "completed" && shift.outstanding != null && (
          <Text style={styles.money}>
            Est. {money(shift.estimated_earnings ?? 0, currency)} · Received {money(shift.amount_received ?? 0, currency)} ·{" "}
            {shift.outstanding < 0 ? `Overpaid ${money(-shift.outstanding, currency)}` : `Outstanding ${money(shift.outstanding, currency)}`}
          </Text>
        )}
        {!(shift.status === "completed" && shift.outstanding != null) && shift.estimated_earnings != null && (
          <Text style={styles.money}>Est. {money(shift.estimated_earnings, currency)}</Text>
        )}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  card: { flexDirection: "row", backgroundColor: c.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  bar: { width: 4 },
  body: { flex: 1, padding: spacing.md, gap: spacing.xs + 2 },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2 },
  duty: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  dutyText: { fontFamily: fonts.bold, fontSize: type.sm },
  period: { fontFamily: fonts.medium, fontSize: type.sm, color: c.muted },
  hours: { fontFamily: fonts.bold, fontSize: type.base, color: c.onSurface },
  time: { fontFamily: fonts.semibold, fontSize: type.lg, color: c.onSurface },
  bottom: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2 },
  loc: { flex: 1, fontFamily: fonts.regular, fontSize: type.sm + 1, color: c.muted },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  pillText: { fontFamily: fonts.semibold, fontSize: 11 },
  money: { fontFamily: fonts.medium, fontSize: type.sm, color: c.onSurfaceSecondary },
}));
