import { ScrollView, View } from "react-native";

import { ComingSoon, TabHeader, useTabBottomPadding } from "@/src/components/tab-screen";
import { makeStyles, spacing } from "@/src/theme";

export default function Earnings() {
  const styles = useStyles();
  const bottom = useTabBottomPadding();
  return (
    <View style={styles.root} testID="earnings-screen">
      <TabHeader title="Earnings" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
        <ComingSoon
          testID="earnings-coming-soon"
          icon="wallet-outline"
          title="Earnings, payments & reports"
          body="Monthly, quarterly and annual PP summaries, payment tracking against your payslip, and CSV/PDF exports."
        />
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: spacing.lg },
}));
