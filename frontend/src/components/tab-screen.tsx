import Ionicons from "@react-native-vector-icons/ionicons";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

/** Sticky screen header used by every tab screen. */
export function TabHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
      <View style={{ flex: 1 }}>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {right}
    </View>
  );
}

/** Bottom padding for scroll content inside a tab screen. */
export function useTabBottomPadding() {
  const insets = useSafeAreaInsets();
  return (usesNativeTabs ? insets.bottom : 0) + spacing.xl;
}

export function ComingSoon({
  icon,
  title,
  body,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  body: string;
  testID?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.soon} testID={testID}>
      <View style={styles.soonIcon}>
        <Ionicons name={icon} size={28} color={colors.onBrandTertiary} />
      </View>
      <Text style={styles.soonTitle}>{title}</Text>
      <Text style={styles.soonBody}>{body}</Text>
      <View style={styles.pill}>
        <Text style={styles.pillText}>Coming in the next milestone</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: c.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
    gap: spacing.md,
  },
  subtitle: { fontFamily: fonts.medium, fontSize: type.base, color: c.muted },
  title: { fontFamily: fonts.bold, fontSize: 28, color: c.onSurface, letterSpacing: -0.5 },
  soon: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
  },
  soonIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: c.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  soonTitle: { fontFamily: fonts.bold, fontSize: type.xl, color: c.onSurface, textAlign: "center" },
  soonBody: {
    fontFamily: fonts.regular,
    fontSize: type.base,
    color: c.muted,
    textAlign: "center",
    lineHeight: 21,
    marginTop: spacing.sm,
  },
  pill: {
    marginTop: spacing.lg,
    backgroundColor: c.surfaceTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
  },
  pillText: { fontFamily: fonts.semibold, fontSize: type.sm, color: c.onSurfaceTertiary },
}));
