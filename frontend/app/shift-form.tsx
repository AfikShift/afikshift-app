import Ionicons from "@react-native-vector-icons/ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { PickerField } from "@/src/components/picker-field";
import { PrivacyNotice } from "@/src/components/privacy-notice";
import { Segmented } from "@/src/components/segmented";
import { StackHeader } from "@/src/components/stack-header";
import { useToast } from "@/src/components/toast";
import { Button, SectionTitle, TextField } from "@/src/components/ui";
import { currencySymbol, money } from "@/src/format";
import {
  DUTY_LABEL,
  BUILTIN_TYPES,
  SPECIALIST_TYPES,
  getCustomTemplates,
  DutyType,
  ShiftData,
  ShiftPeriod,
  ShiftStatus,
  TIME_RE,
  addDays,
  crossesMidnight,
  estimatedEarnings,
  formatDateLong,
  overlaps,
  payableHours,
  toISODate,
  validateShift,
} from "@/src/shifts/calc";
import { FREE_ACTIVE_SHIFTS, isActiveFuture, useShifts } from "@/src/shifts/provider";
import { ProPrompt } from "@/src/components/pro-prompt";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

const PRESETS: Record<ShiftPeriod, [string, string]> = { day: ["08:00", "20:00"], night: ["20:00", "08:00"] };
const BREAKS = ["0", "30", "45", "60"] as const;

export default function ShiftForm() {
  const params = useLocalSearchParams<{ id?: string; duplicate?: string; date?: string }>();
  const { user } = useAuth();
  const { byId, create, update, shifts, atShiftLimit } = useShifts();
  const router = useRouter();
  const toast = useToast();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const editing = params.id ? byId(params.id) : undefined;
  const source = editing ?? (params.duplicate ? byId(params.duplicate) : undefined);

  const [f, setF] = useState<ShiftData>(() => {
    if (source) {
      const base = {
        officer_name: source.officer_name,
        duty_type: source.duty_type,
        shift_period: source.shift_period,
        date: source.date,
        start_time: source.start_time,
        end_time: source.end_time,
        break_minutes: source.break_minutes,
        location: source.location,
        status: source.status,
        hourly_rate: source.hourly_rate,
        payments: [],
        payment_decisions: [],
      };
      // Duplicate: next day, fresh status, current profile rate, no payments copied.
      return editing ? base : { ...base, date: addDays(source.date, 1), status: "booked", hourly_rate: user?.hourly_rate ?? null, officer_name: user?.full_name ?? base.officer_name };
    }
    return {
      officer_name: user?.full_name ?? "",
      duty_type: "standard",
      shift_period: "day",
      date: params.date ?? toISODate(new Date()),
      start_time: PRESETS.day[0],
      end_time: PRESETS.day[1],
      break_minutes: 0,
      location: "",
      status: "booked",
      hourly_rate: user?.hourly_rate ?? null,
      payments: [],
      payment_decisions: [],
    };
  });
  const [rateText, setRateText] = useState(f.hourly_rate != null ? String(f.hourly_rate) : "");
  const [customBreak, setCustomBreak] = useState(!BREAKS.includes(String(f.break_minutes) as any));
  const [timesTouched, setTimesTouched] = useState(!!source);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ShiftData>(k: K, v: ShiftData[K]) => setF((s) => ({ ...s, [k]: v }));

  const timesOk = TIME_RE.test(f.start_time) && TIME_RE.test(f.end_time) && f.start_time !== f.end_time;
  const hours = timesOk ? payableHours(f.start_time, f.end_time, f.break_minutes) : 0;
  const rateNum = rateText.trim() === "" ? null : Number(rateText.replace(",", "."));
  const est = estimatedEarnings(hours, rateNum != null && isFinite(rateNum) ? rateNum : null);
  const clashes = useMemo(() => overlaps({ ...f, id: editing?.id }, shifts), [f, editing?.id, shifts]);

  const save = async () => {
    const data: ShiftData = { ...f, officer_name: f.officer_name.trim(), location: f.location.trim(), hourly_rate: rateNum, payments: editing?.payments ?? [], payment_decisions: editing?.payment_decisions ?? [] };
    const e = validateShift(data);
    if (rateNum != null && (!isFinite(rateNum) || rateNum < 0 || rateNum > 500)) e.hourly_rate = "Enter a rate between 0 and 500.";
    setErrors(e);
    if (Object.keys(e).length) return toast("Please check the highlighted fields", "error");
    // Free limit: saving must not add a 4th active/future shift (editing an already-active one is fine).
    if (atShiftLimit && isActiveFuture({ ...data, deleted: false }) && !(editing && isActiveFuture(editing)))
      return toast(`Free includes ${FREE_ACTIVE_SHIFTS} upcoming shifts. Complete, cancel or delete one, or upgrade to Pro.`, "info");
    setSaving(true);
    try {
      // Editing never touches payments: the store keeps the latest payment list (incl. other devices').
      const { payments: _ignored, payment_decisions: _ignoredDecisions, ...details } = data;
      if (editing) await update(editing.id, details);
      else await create(data);
      toast(clashes.length ? "Shift saved — note: it overlaps another shift" : "Shift saved", clashes.length ? "info" : "success");
      router.back();
    } catch (err) {
      toast((err as Error).message, "error");
      setSaving(false);
    }
  };

  const title = editing ? "Edit shift" : params.duplicate ? "Duplicate shift" : "Add shift";

  if (!editing && atShiftLimit && f.status === "booked")
    return (
      <View style={styles.root} testID="shift-limit-screen">
        <StackHeader title={title} />
        <View style={[styles.content, { gap: spacing.lg }]}>
          <Text style={styles.limitText}>
            You have {FREE_ACTIVE_SHIFTS} upcoming shifts – the most DutyConnect Free can hold. Your shifts are safe. Complete, cancel or delete one to add another,
            or upgrade for unlimited shifts.
          </Text>
          <ProPrompt testID="shift-limit-pro-prompt" title="Unlimited shifts with Pro" body="Plus full history, multiple payments, reports and sync on all devices." />
        </View>
      </View>
    );

  return (
    <View style={styles.root} testID="shift-form-screen">
      <StackHeader title={title} />
      <KeyboardAwareScrollView bottomOffset={140} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <PrivacyNotice />
        <SectionTitle>Shift type</SectionTitle>
        <Segmented<DutyType>
          testPrefix="shift-duty"
          wrap
          value={f.duty_type}
          onChange={(v) => {
            set("duty_type", v);
            const t = getCustomTemplates().find((x) => x.id === v); // a template pre-fills its times
            if (t?.start_time && t.end_time) setF((p) => ({ ...p, duty_type: v, start_time: t.start_time!, end_time: t.end_time!, break_minutes: t.break_minutes ?? p.break_minutes }));
          }}
          options={typeOptions(f.duty_type, !!user?.specialist_presets).map((k) => ({ value: k.id, label: k.label }))}
        />
        <View style={{ height: spacing.md }} />
        <Segmented<ShiftPeriod>
          testPrefix="shift-period"
          value={f.shift_period}
          icons={{ day: "sunny", night: "moon" }}
          onChange={(v) => {
            setF((s) => ({ ...s, shift_period: v, ...(timesTouched ? {} : { start_time: PRESETS[v][0], end_time: PRESETS[v][1] }) }));
          }}
          options={[
            { value: "day", label: "Day" },
            { value: "night", label: "Night" },
          ]}
        />

        <SectionTitle>When</SectionTitle>
        <View style={styles.gap}>
          <PickerField testID="shift-date-input" label="Date (shift start)" mode="date" value={f.date} onChange={(v) => set("date", v)} error={errors.date} />
          <View style={styles.row}>
            <PickerField
              testID="shift-start-input"
              label="Start"
              mode="time"
              value={f.start_time}
              onChange={(v) => {
                setTimesTouched(true);
                set("start_time", v);
              }}
              error={errors.start_time}
            />
            <PickerField
              testID="shift-end-input"
              label="Finish"
              mode="time"
              value={f.end_time}
              onChange={(v) => {
                setTimesTouched(true);
                set("end_time", v);
              }}
              error={errors.end_time}
            />
          </View>
          {timesOk && crossesMidnight(f.start_time, f.end_time) && (
            <View style={styles.info} testID="shift-overnight-note">
              <Ionicons name="moon" size={14} color={colors.night} />
              <Text style={styles.infoText}>Overnight — finishes {formatDateLong(addDays(f.date, 1))} at {f.end_time}</Text>
            </View>
          )}
        </View>

        <SectionTitle>Unpaid break (minutes)</SectionTitle>
        <Segmented<string>
          testPrefix="shift-break"
          value={customBreak ? "custom" : String(f.break_minutes)}
          onChange={(v) => {
            if (v === "custom") return setCustomBreak(true);
            setCustomBreak(false);
            set("break_minutes", parseInt(v, 10));
          }}
          options={[...BREAKS.map((b) => ({ value: b, label: b === "0" ? "None" : `${b} min` })), { value: "custom", label: "Custom" }]}
        />
        {customBreak && (
          <View style={{ marginTop: spacing.md }}>
            <TextField
              testID="shift-break-custom-input"
              label="Break minutes"
              keyboardType="number-pad"
              value={String(f.break_minutes)}
              onChangeText={(t) => set("break_minutes", parseInt(t.replace(/\D/g, "") || "0", 10))}
            />
          </View>
        )}
        {!!errors.break_minutes && <Text style={styles.error}>{errors.break_minutes}</Text>}

        <SectionTitle>Details</SectionTitle>
        <View style={styles.gap}>
          <TextField testID="shift-officer-input" label="Your name" value={f.officer_name} onChangeText={(v) => set("officer_name", v)} error={errors.officer_name} />
          <TextField
            testID="shift-location-input"
            label="General location (optional)"
            value={f.location}
            onChangeText={(v) => set("location", v)}
            placeholder="e.g. Local hospital"
            maxLength={60}
            error={errors.location}
            hint="General description only. Never enter other people's names, ID numbers, health or security details."
          />
          <TextField
            testID="shift-rate-input"
            label="Hourly rate for this shift"
            prefix={currencySymbol(user?.currency)}
            keyboardType="decimal-pad"
            value={rateText}
            onChangeText={setRateText}
            placeholder="Not set"
            error={errors.hourly_rate}
            hint={editing ? "Saved with this shift — changing your profile rate won't alter it." : "Taken from your profile. Saved with this shift."}
          />
        </View>

        <SectionTitle>Status</SectionTitle>
        <Segmented<ShiftStatus>
          testPrefix="shift-status"
          value={f.status}
          onChange={(v) => set("status", v)}
          options={[
            { value: "booked", label: "Booked" },
            { value: "completed", label: "Completed" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
        {!!errors.status && <Text style={styles.error}>{errors.status}</Text>}
        <Text style={styles.payNote}>Payments are recorded from the shift&apos;s menu once it&apos;s completed. Payment status updates automatically.</Text>
        <View style={{ height: 160 }} />
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ opened: insets.bottom }}>
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          {clashes.length > 0 && (
            <View style={styles.warn} testID="shift-overlap-warning">
              <Ionicons name="warning" size={16} color={colors.warning} />
              <Text style={styles.warnText} numberOfLines={2}>
                Overlaps {DUTY_LABEL[clashes[0].duty_type]} on {formatDateLong(clashes[0].date)} {clashes[0].start_time}–{clashes[0].end_time}
                {clashes.length > 1 ? ` (+${clashes.length - 1} more)` : ""}
              </Text>
            </View>
          )}
          <View style={styles.summary}>
            <View>
              <Text style={styles.sumValue} testID="shift-payable-hours">
                {hours.toFixed(2)} h
              </Text>
              <Text style={styles.sumLabel}>Payable hours</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.sumValue} testID="shift-estimated-earnings">
                {est != null ? money(est, user?.currency) : "—"}
              </Text>
              <Text style={styles.sumLabel}>{est != null ? "Estimated gross" : "Set a rate to estimate"}</Text>
            </View>
          </View>
          <Button testID="shift-save-button" label={editing ? "Save changes" : "Save shift"} onPress={save} loading={saving} />
        </View>
      </KeyboardStickyView>
    </View>
  );
}

/** Built-in + custom (+ specialist presets when turned on). A type already on the record always stays selectable. */
function typeOptions(id: string, specialist: boolean) {
  const opts = [...BUILTIN_TYPES, ...getCustomTemplates(), ...(specialist ? SPECIALIST_TYPES : [])];
  return opts.some((t) => t.id === id) ? opts : [...opts, { id, label: DUTY_LABEL[id] }];
}

const useStyles = makeStyles((c) => ({
  limitText: { fontFamily: fonts.medium, fontSize: type.base, color: c.onSurface, lineHeight: 22 },
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  gap: { gap: spacing.lg },
  row: { flexDirection: "row", gap: spacing.md },
  info: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  infoText: { fontFamily: fonts.medium, fontSize: type.sm + 1, color: c.onSurfaceSecondary },
  error: { fontFamily: fonts.medium, fontSize: type.sm, color: c.error, marginTop: spacing.sm },
  payNote: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted, marginTop: spacing.md, lineHeight: 18 },
  footer: {
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  warn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: c.warningSoft, padding: spacing.md, borderRadius: radius.md },
  warnText: { flex: 1, fontFamily: fonts.medium, fontSize: type.sm + 1, color: c.onSurface },
  summary: { flexDirection: "row", justifyContent: "space-between" },
  sumValue: { fontFamily: fonts.bold, fontSize: type.xl, color: c.onSurface },
  sumLabel: { fontFamily: fonts.medium, fontSize: type.sm, color: c.muted },
}));
