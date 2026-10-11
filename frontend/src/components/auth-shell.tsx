import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

export function AuthShell({
  title,
  subtitle,
  children,
  back = true,
  testID,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  back?: boolean;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.root} testID={testID}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        {back ? (
          <Pressable
            testID="auth-back-button"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/welcome"))}
            hitSlop={8}
            style={styles.back}
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
        ) : (
          <View style={styles.back} />
        )}
      </View>
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
      >
        <Text style={styles.title}>{title}</Text>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        <View style={styles.body}>{children}</View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  back: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surfaceSecondary,
  },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, maxWidth: 520, width: "100%", alignSelf: "center" },
  title: { fontFamily: fonts.bold, fontSize: 28, color: c.onSurface, letterSpacing: -0.5 },
  subtitle: { fontFamily: fonts.regular, fontSize: type.lg, color: c.muted, marginTop: spacing.sm, lineHeight: 22 },
  body: { marginTop: spacing.xl, gap: spacing.lg },
}));
