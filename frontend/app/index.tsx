import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "@/src/auth";
import { useTheme } from "@/src/theme";

export default function Index() {
  const { status } = useAuth();
  const { colors } = useTheme();
  if (status === "loading") {
    return (
      <View testID="app-loading" style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator color={colors.brandSecondary} />
      </View>
    );
  }
  return <Redirect href={status === "signedIn" ? "/(tabs)" : "/welcome"} />;
}
