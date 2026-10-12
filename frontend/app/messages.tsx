import Ionicons from "@react-native-vector-icons/ionicons";
import { Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StackHeader } from "@/src/components/stack-header";
import { Card } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

const IOS_POINTS = [
  "Apple does not allow any third-party app to read or forward your SMS or iMessages.",
  "This is an iOS platform restriction, not a DutyConnect limitation, and no App Store app can work around it.",
  "Every other DutyConnect feature (shifts, earnings, payments and reports) works fully on iPhone.",
];

const ANDROID_POINTS = [
  "Forward SMS from selected contacts (default) to your verified personal email.",
  "Explicit consent, pause any time, blocked senders and best-effort filtering of verification codes.",
  "Needs Google Play approval for SMS permissions, and testing on a real device. It is being assessed for a later phase.",
];

export default function Messages() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const ios = Platform.OS === "ios";
  const points = ios ? IOS_POINTS : ANDROID_POINTS;

  return (
    <View style={styles.root} testID="messages-screen">
      <StackHeader title="Messages" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name={ios ? "phone-portrait-outline" : "mail-unread-outline"} size={26} color={colors.onHero} />
          </View>
          <Text style={styles.heroTitle} testID="messages-status-title">
            {ios ? "SMS forwarding is not available on iPhone" : "SMS-to-email forwarding · coming soon"}
          </Text>
          <Text style={styles.heroBody}>
            {ios ? "Here's why, and what you can still do." : "Android only. Not active in this version."}
          </Text>
        </View>

        <Card style={styles.list}>
          {points.map((p, i) => (
            <View key={i} style={styles.point}>
              <Ionicons name={ios ? "information-circle-outline" : "checkmark-circle-outline"} size={20} color={colors.brandSecondary} />
              <Text style={styles.pointText}>{p}</Text>
            </View>
          ))}
        </Card>

        <View style={styles.note} testID="messages-privacy-note">
          <Ionicons name="lock-closed-outline" size={16} color={colors.muted} />
          <Text style={styles.noteText}>
            Message forwarding will never be covert, and never goes to employer-managed email without authorisation.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: spacing.lg, gap: spacing.lg },
  hero: { backgroundColor: c.hero, borderRadius: radius.lg, padding: spacing.xl },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  heroTitle: { fontFamily: fonts.bold, fontSize: type.xl, color: c.onHero, lineHeight: 26 },
  heroBody: { fontFamily: fonts.regular, fontSize: type.base, color: c.onHeroMuted, marginTop: spacing.xs },
  list: { gap: spacing.lg },
  point: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  pointText: { flex: 1, fontFamily: fonts.regular, fontSize: type.base, color: c.onSurfaceSecondary, lineHeight: 21 },
  note: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.xs },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: type.sm, color: c.muted, lineHeight: 18 },
}));
