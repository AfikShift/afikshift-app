import { ScrollView, View } from "react-native";

import { ComingSoon, TabHeader, useTabBottomPadding } from "@/src/components/tab-screen";
import { makeStyles, spacing } from "@/src/theme";

export default function Shifts() {
  const styles = useStyles();
  const bottom = useTabBottomPadding();
  return (
    <View style={styles.root} testID="shifts-screen">
      <TabHeader title="My PP Shifts" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
        <ComingSoon
          testID="shifts-coming-soon"
          icon="calendar-outline"
          title="Shift calendar & recording"
          body="Add Bed Watch, Constant Watch and Other PP duties, view them by month or week, and record completed shifts — even offline."
        />
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: spacing.lg },
}));
