import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { LogBox, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/src/auth";
import { ErrorBoundary } from "@/src/components/error-boundary";
import { LockScreen } from "@/src/components/lock-screen";
import { ToastProvider, useToast } from "@/src/components/toast";
import { RequiredUpdateGate } from "@/src/components/app-update";
import { queryClient } from "@/src/query-client";
import { ShiftsProvider } from "@/src/shifts/provider";
import { EntitlementProvider, useEntitlement } from "@/src/billing/entitlement";
import { startBilling } from "@/src/billing/play";

/** Starts the Play Billing listener early so purchases completed while the app was closed are verified. */
function BillingListener() {
  const { status } = useAuth();
  const { apply } = useEntitlement();
  const toast = useToast();
  useEffect(() => {
    if (status === "signedIn")
      startBilling(
        (e) => {
          apply(e);
          toast(e.plan === "pro" ? "Welcome to DutyConnect Pro" : "Purchase recorded");
        },
        (m) => toast(m, "error"),
      ).catch(() => {});
  }, [status, apply, toast]);
  return null;
}
import { useTheme } from "@/src/theme";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync().catch(() => {});

function AppStack() {
  const { colors, scheme } = useTheme();
  const { locked, status } = useAuth();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <RequiredUpdateGate>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="messages" options={{ presentation: "card" }} />
        <Stack.Screen name="profile" options={{ presentation: "card" }} />
        <Stack.Screen name="security" options={{ presentation: "card" }} />
        <Stack.Screen name="shift-form" options={{ presentation: "card" }} />
        <Stack.Screen name="recently-deleted" options={{ presentation: "card" }} />
        <Stack.Screen name="upgrade" options={{ presentation: "card" }} />
        <Stack.Screen name="templates" options={{ presentation: "card" }} />
        <Stack.Screen name="referrals" options={{ presentation: "card" }} />
        <Stack.Screen name="admin" options={{ presentation: "card" }} />
        <Stack.Screen name="admin-referrals" options={{ presentation: "card" }} />
      </Stack>
      </RequiredUpdateGate>
      {status === "signedIn" && locked && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
          <LockScreen />
        </View>
      )}
    </View>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    "PJS-Regular": require("../assets/fonts/PlusJakartaSans-Regular.ttf"),
    "PJS-Medium": require("../assets/fonts/PlusJakartaSans-Medium.ttf"),
    "PJS-SemiBold": require("../assets/fonts/PlusJakartaSans-SemiBold.ttf"),
    "PJS-Bold": require("../assets/fonts/PlusJakartaSans-Bold.ttf"),
    "PJS-ExtraBold": require("../assets/fonts/PlusJakartaSans-ExtraBold.ttf"),
    Ionicons: require("@react-native-vector-icons/ionicons/fonts/Ionicons.ttf"),
  });

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <KeyboardProvider>
              <AuthProvider>
                <EntitlementProvider>
                <ShiftsProvider>
                  <ToastProvider>
                    <BillingListener />
                    <AppStack />
                  </ToastProvider>
                </ShiftsProvider>
                </EntitlementProvider>
              </AuthProvider>
            </KeyboardProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
