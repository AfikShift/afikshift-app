import Ionicons from "@react-native-vector-icons/ionicons";
import * as LocalAuthentication from "expo-local-authentication";
import React, { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { Button } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, type } from "@/src/theme";

export function LockScreen() {
  const { unlock, logout, user } = useAuth();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const [error, setError] = useState<string | null>(null);

  const attempt = useCallback(async () => {
    setError(null);
    const enrolled = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
    if (!enrolled) return unlock(); // biometrics removed from the device — fall back to the signed-in session
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock AfikShift" });
    if (r.success) unlock();
    else setError("Authentication was cancelled or failed.");
  }, [unlock]);

  useEffect(() => {
    attempt();
  }, [attempt]);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.xl }]} testID="biometric-lock-screen">
      <View style={styles.center}>
        <View style={styles.badge}>
          <Ionicons name="lock-closed" size={32} color="#FFFFFF" />
        </View>
        <Text style={styles.title}>AfikShift is locked</Text>
        <Text style={styles.sub}>{user?.email}</Text>
        {!!error && <Text style={styles.err}>{error}</Text>}
      </View>
      <View style={styles.actions}>
        <Button testID="biometric-unlock-button" label="Unlock" icon="finger-print" onPress={attempt} />
        <Button testID="biometric-signout-button" label="Sign out" variant="ghost" onPress={logout} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface, paddingHorizontal: spacing.xl },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  badge: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: c.hero,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: { fontFamily: fonts.bold, fontSize: type.xl, color: c.onSurface },
  sub: { fontFamily: fonts.regular, fontSize: type.base, color: c.muted },
  err: { fontFamily: fonts.medium, fontSize: type.base, color: c.error, marginTop: spacing.sm },
  actions: { gap: spacing.sm },
}));
