import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/src/auth";
import { useTheme } from "@/src/theme";

export default function AuthLayout() {
  const { status } = useAuth();
  const { colors } = useTheme();
  if (status === "signedIn") return <Redirect href="/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />;
}
