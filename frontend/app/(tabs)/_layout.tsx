import Ionicons from "@react-native-vector-icons/ionicons";
import { Redirect, Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Platform } from "react-native";

import { useAuth } from "@/src/auth";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, useTheme } from "@/src/theme";

export default function TabsLayout() {
  const { status } = useAuth();
  const { colors } = useTheme();
  if (status === "signedOut") return <Redirect href="/welcome" />;

  if (usesNativeTabs) {
    return (
      <NativeTabs tintColor={colors.brandSecondary}>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon sf="house.fill" />
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="shifts">
          <NativeTabs.Trigger.Icon sf="calendar" />
          <NativeTabs.Trigger.Label>Shifts</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="earnings">
          <NativeTabs.Trigger.Icon sf="sterlingsign.circle.fill" />
          <NativeTabs.Trigger.Label>Earnings</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="account">
          <NativeTabs.Trigger.Icon sf="person.crop.circle.fill" />
          <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  const icon = (on: React.ComponentProps<typeof Ionicons>["name"], off: React.ComponentProps<typeof Ionicons>["name"]) => {
    const TabIcon = ({ focused, color }: { focused: boolean; color: any }) => (
      <Ionicons name={focused ? on : off} size={24} color={color} />
    );
    return TabIcon;
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11 },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        sceneStyle: { backgroundColor: colors.surface },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarButtonTestID: "tab-home", tabBarIcon: icon("home", "home-outline") }} />
      <Tabs.Screen name="shifts" options={{ title: "Shifts", tabBarButtonTestID: "tab-shifts", tabBarIcon: icon("calendar", "calendar-outline") }} />
      <Tabs.Screen name="earnings" options={{ title: "Earnings", tabBarButtonTestID: "tab-earnings", tabBarIcon: icon("wallet", "wallet-outline") }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarButtonTestID: "tab-account", tabBarIcon: icon("person-circle", "person-circle-outline") }} />
    </Tabs>
  );
}
