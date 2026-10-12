import Ionicons from "@react-native-vector-icons/ionicons";
import { Text, View } from "react-native";

import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

/** Shown wherever totals include a shift with an unresolved payment edit clash. */
export function ProvisionalBanner({ count, testID }: { count: number; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (!count) return null;
  return (
    <View style={styles.wrap} testID={testID}>
      <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
      <Text style={styles.text}>
        Provisional figures: a payment was edited differently on two devices on {count} shift{count === 1 ? "" : "s"}. Open the shift and choose the correct
        payment.
      </Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { flexDirection: "row", gap: spacing.sm, backgroundColor: c.warningSoft, borderRadius: radius.md, padding: spacing.md },
  text: { flex: 1, fontFamily: fonts.medium, fontSize: type.sm + 1, color: c.onSurface, lineHeight: 19 },
}));
