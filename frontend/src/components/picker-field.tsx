import DateTimePicker from "@react-native-community/datetimepicker";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { TextField } from "@/src/components/ui";
import { formatDateLong, isValidDate, parseISODate, toISODate } from "@/src/shifts/calc";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

type Props = { label: string; value: string; onChange: (v: string) => void; mode: "date" | "time"; error?: string; testID: string };

function maskTime(t: string) {
  const d = t.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
}

function maskDate(t: string) {
  const d = t.replace(/\D/g, "").slice(0, 8);
  if (d.length > 6) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
  if (d.length > 4) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return d;
}

/** Native picker on iOS/Android; masked text input on web. */
export function PickerField({ label, value, onChange, mode, error, testID }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  if (Platform.OS === "web") {
    return (
      <View style={styles.field}>
        <TextField
          testID={testID}
          label={label}
          value={value}
          onChangeText={(t) => onChange(mode === "time" ? maskTime(t) : maskDate(t))}
          placeholder={mode === "time" ? "HH:MM" : "YYYY-MM-DD"}
          keyboardType="number-pad"
          error={error}
        />
      </View>
    );
  }

  const asDate = (() => {
    if (mode === "date") return isValidDate(value) ? parseISODate(value) : new Date();
    const d = new Date();
    const [h, m] = value.split(":").map((x) => parseInt(x, 10));
    d.setHours(isNaN(h) ? 8 : h, isNaN(m) ? 0 : m, 0, 0);
    return d;
  })();

  const apply = (d: Date) =>
    onChange(mode === "date" ? toISODate(d) : `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable testID={testID} onPress={() => setOpen((o) => !o)} style={[styles.box, !!error && { borderColor: colors.error }, open && { borderColor: colors.brandSecondary }]}>
        <Ionicons name={mode === "date" ? "calendar-outline" : "time-outline"} size={18} color={colors.muted} />
        <Text style={styles.value}>{mode === "date" && isValidDate(value) ? formatDateLong(value) : value || "Select"}</Text>
      </Pressable>
      {open && (
        <DateTimePicker
          value={asDate}
          mode={mode}
          is24Hour
          display={Platform.OS === "ios" ? (mode === "date" ? "inline" : "spinner") : "default"}
          themeVariant={undefined}
          onValueChange={(_e: unknown, d: Date) => {
            if (Platform.OS === "android") setOpen(false);
            if (d) apply(d);
          }}
          onDismiss={() => setOpen(false)}
        />
      )}
      {open && Platform.OS === "ios" && (
        <Pressable testID={`${testID}-done`} onPress={() => setOpen(false)} style={styles.done}>
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  field: { gap: spacing.xs + 2, flex: 1 },
  label: { fontFamily: fonts.semibold, fontSize: type.sm + 1, color: c.onSurfaceSecondary },
  box: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: c.border,
    backgroundColor: c.surfaceSecondary,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  value: { fontFamily: fonts.semibold, fontSize: type.lg, color: c.onSurface },
  done: { alignSelf: "flex-end", paddingHorizontal: spacing.lg, minHeight: 36, justifyContent: "center" },
  doneText: { fontFamily: fonts.bold, fontSize: type.base, color: c.brandSecondary },
  error: { fontFamily: fonts.medium, fontSize: type.sm, color: c.error },
}));
