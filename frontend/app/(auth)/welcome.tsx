import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

const POINTS: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }[] = [
  { icon: "calendar-outline", text: "Record Bed Watch, Constant Watch & PP duties in seconds" },
  { icon: "cash-outline", text: "See estimated earnings and what you're still owed" },
  { icon: "cloud-offline-outline", text: "Works offline — syncs when you're back online" },
];

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.root} testID="welcome-screen">
      <View style={[styles.hero, { paddingTop: insets.top + spacing.xxl }]}>
        <Animated.View entering={FadeInDown.duration(500)} style={styles.logo}>
          <Ionicons name="shield-checkmark" size={30} color={colors.hero} />
        </Animated.View>
        <Animated.Text entering={FadeInDown.delay(80).duration(500)} style={styles.brand}>
          DutyConnect
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(140).duration(500)} style={styles.tagline}>
          Stay Connected. Stay Organised.
        </Animated.Text>
      </View>
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.points}>
          {POINTS.map((p, i) => (
            <Animated.View key={p.text} entering={FadeInDown.delay(220 + i * 70).duration(450)} style={styles.point}>
              <View style={styles.pointIcon}>
                <Ionicons name={p.icon} size={18} color={colors.onBrandTertiary} />
              </View>
              <Text style={styles.pointText}>{p.text}</Text>
            </Animated.View>
          ))}
        </View>
        <View style={styles.actions}>
          <Button testID="welcome-create-account-button" label="Create account" onPress={() => router.push("/register")} />
          <Button testID="welcome-sign-in-button" label="Sign in" variant="secondary" onPress={() => router.push("/login")} />
        </View>
        <Text style={styles.legal}>Personal records only. Never enter prisoner or confidential employer information.</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.hero },
  hero: { flex: 1, paddingHorizontal: spacing.xl, justifyContent: "center" },
  logo: {
    width: 60,
    height: 60,
    borderRadius: radius.lg - 4,
    backgroundColor: "#008080",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xl,
  },
  brand: { fontFamily: fonts.extrabold, fontSize: 40, color: c.onHero, letterSpacing: -1 },
  tagline: { fontFamily: fonts.medium, fontSize: type.lg, color: c.heroAccent, marginTop: spacing.xs },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  points: { gap: spacing.md, marginBottom: spacing.xl },
  point: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  pointIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: c.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  pointText: { flex: 1, fontFamily: fonts.medium, fontSize: type.base, color: c.onSurfaceSecondary, lineHeight: 20 },
  actions: { gap: spacing.sm },
  legal: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted, textAlign: "center", marginTop: spacing.lg },
}));
