import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

/** Compact prompt shown where a Pro feature would be. */
export function ProPrompt({ title, body, testID }: { title: string; body: string; testID: string }) {
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={() => router.push("/upgrade")} style={styles.wrap}>
      <Ionicons name="sparkles-outline" size={20} color={colors.onBrandTertiary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: c.brandTertiary },
  title: { fontFamily: fonts.semibold, fontSize: type.base, color: c.onSurface },
  body: { fontFamily: fonts.regular, fontSize: type.sm, color: c.onSurfaceSecondary, marginTop: 2 },
}));
