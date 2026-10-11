import Ionicons from "@react-native-vector-icons/ionicons";
import { Pressable, Text, View } from "react-native";

import { dutyColors } from "@/src/components/shift-card";
import { tap } from "@/src/components/ui";
import { addDays, parseISODate, toISODate } from "@/src/shifts/calc";
import { LocalShift } from "@/src/shifts/provider";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday of the week containing iso. */
export function weekStart(iso: string) {
  const d = parseISODate(iso);
  return addDays(iso, -((d.getDay() + 6) % 7));
}

type Props = {
  mode: "month" | "week";
  selected: string;
  onSelect: (iso: string) => void;
  byDate: Record<string, LocalShift[]>;
};

function DayMarks({ shifts }: { shifts: LocalShift[] }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const active = shifts.filter((s) => s.status !== "cancelled");
  if (!active.length) return <View style={styles.marks} />;
  const night = active.some((s) => s.shift_period === "night");
  return (
    <View style={styles.marks}>
      {active.slice(0, 3).map((s) => (
        <View key={s.id} style={[styles.dot, { backgroundColor: dutyColors(colors, s.duty_type)[0] }]} />
      ))}
      {night && <Ionicons name="moon" size={8} color={colors.night} />}
    </View>
  );
}

export function ShiftCalendar({ mode, selected, onSelect, byDate }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const today = toISODate(new Date());
  const sel = parseISODate(selected);

  let days: (string | null)[];
  let title: string;
  if (mode === "month") {
    const first = new Date(sel.getFullYear(), sel.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7;
    const count = new Date(sel.getFullYear(), sel.getMonth() + 1, 0).getDate();
    days = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => toISODate(new Date(sel.getFullYear(), sel.getMonth(), i + 1)))];
    while (days.length % 7) days.push(null);
    title = sel.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  } else {
    const ws = weekStart(selected);
    days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    const we = parseISODate(addDays(ws, 6));
    title = `${parseISODate(ws).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${we.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  }

  const shift = (dir: 1 | -1) => {
    tap();
    if (mode === "week") return onSelect(addDays(selected, 7 * dir));
    const d = new Date(sel.getFullYear(), sel.getMonth() + dir, 1);
    onSelect(toISODate(d));
  };

  return (
    <View style={styles.wrap} testID={`calendar-${mode}`}>
      <View style={styles.head}>
        <Pressable testID="calendar-prev-button" onPress={() => shift(-1)} hitSlop={8} style={styles.nav} accessibilityLabel="Previous">
          <Ionicons name="chevron-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} testID="calendar-title">
          {title}
        </Text>
        <Pressable testID="calendar-next-button" onPress={() => shift(1)} hitSlop={8} style={styles.nav} accessibilityLabel="Next">
          <Ionicons name="chevron-forward" size={20} color={colors.onSurface} />
        </Pressable>
      </View>
      <View style={styles.row}>
        {DOW.map((d) => (
          <Text key={d} style={styles.dow}>
            {d}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {days.map((iso, i) => {
          if (!iso) return <View key={`e${i}`} style={styles.cell} />;
          const isSel = iso === selected;
          const isToday = iso === today;
          return (
            <Pressable
              key={iso}
              testID={`calendar-day-${iso}`}
              onPress={() => {
                tap();
                onSelect(iso);
              }}
              style={styles.cell}
            >
              <View style={[styles.num, isSel && { backgroundColor: colors.brandPrimary }, !isSel && isToday && { borderWidth: 1.5, borderColor: colors.brandSecondary }]}>
                <Text style={[styles.numText, isSel && { color: colors.onBrandPrimary }]}>{parseISODate(iso).getDate()}</Text>
              </View>
              <DayMarks shifts={byDate[iso] ?? []} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.md },
  head: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  nav: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  title: { flex: 1, textAlign: "center", fontFamily: fonts.bold, fontSize: type.lg, color: c.onSurface },
  row: { flexDirection: "row" },
  dow: { width: `${100 / 7}%`, textAlign: "center", fontFamily: fonts.semibold, fontSize: 11, color: c.muted, paddingBottom: spacing.xs },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, alignItems: "center", paddingVertical: spacing.xs, minHeight: 52 },
  num: { width: 36, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  numText: { fontFamily: fonts.semibold, fontSize: type.base, color: c.onSurface },
  marks: { flexDirection: "row", alignItems: "center", gap: 2, height: 10, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
}));
