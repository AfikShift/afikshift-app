import Ionicons from "@react-native-vector-icons/ionicons";
import { Pressable, ScrollView, Text, View } from "react-native";

import { tap } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

/** Single-select segmented chips in one horizontal row. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  testPrefix,
  icons,
  wrap,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  testPrefix: string;
  icons?: Partial<Record<T, React.ComponentProps<typeof Ionicons>["name"]>>;
  /** Wrap chips onto several lines so every option is visible (no sideways scrolling). */
  wrap?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const chips = options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={`${testPrefix}-${o.value}`}
            accessibilityState={{ selected: on }}
            onPress={() => {
              tap();
              onChange(o.value);
            }}
            style={[styles.chip, on && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}
          >
            {icons?.[o.value] && <Ionicons name={icons[o.value]!} size={15} color={on ? colors.onBrandPrimary : colors.onSurfaceSecondary} />}
            <Text style={[styles.text, on && { color: colors.onBrandPrimary }]}>{o.label}</Text>
          </Pressable>
        );
      });
  if (wrap) return <View style={[styles.row, styles.wrap]}>{chips}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
      {chips}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  row: { gap: spacing.sm, alignItems: "center", minHeight: 40 },
  wrap: { flexDirection: "row", flexWrap: "wrap" },
  chip: {
    height: 36,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceSecondary,
  },
  text: { fontFamily: fonts.semibold, fontSize: type.base, color: c.onSurfaceSecondary },
}));
