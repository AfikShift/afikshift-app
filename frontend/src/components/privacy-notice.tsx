import Ionicons from "@react-native-vector-icons/ionicons";
import { Text, View } from "react-native";

import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

/** Standing reminder shown wherever officers can type free text. */
export function PrivacyNotice() {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.box} testID="privacy-notice">
      <Ionicons name="shield-checkmark-outline" size={16} color={colors.onBrandTertiary} />
      <Text style={styles.text}>
        Personal PP records only. Never enter prisoner-identifiable information, security-sensitive details or operational incidents.
      </Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  box: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    backgroundColor: c.brandTertiary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  text: { flex: 1, fontFamily: fonts.medium, fontSize: type.sm, color: c.onBrandTertiary, lineHeight: 18 },
}));
