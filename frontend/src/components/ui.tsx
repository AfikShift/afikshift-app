import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import React, { forwardRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  PressableProps,
  StyleProp,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";

import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

export function tap() {
  if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
}

type BtnProps = {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, onPress, variant = "primary", loading, disabled, icon, testID, style }: BtnProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const bg = { primary: colors.brandPrimary, secondary: colors.surfaceSecondary, ghost: "transparent", danger: colors.error }[variant];
  const fg = { primary: colors.onBrandPrimary, secondary: colors.onSurface, ghost: colors.brandSecondary, danger: colors.onError }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={off}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: off ? 0.55 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        variant === "secondary" && styles.btnBorder,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={fg} />}
          <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

type FieldProps = TextInputProps & { label: string; error?: string | null; hint?: string; secure?: boolean; prefix?: string };

export const TextField = forwardRef<TextInput, FieldProps>(function TextField(
  { label, error, hint, secure, prefix, style, testID, ...rest },
  ref,
) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={[
          styles.inputWrap,
          focused && { borderColor: colors.brandSecondary },
          !!error && { borderColor: colors.error },
        ]}
      >
        {prefix && <Text style={styles.prefix}>{prefix}</Text>}
        <TextInput
          ref={ref}
          testID={testID}
          placeholderTextColor={colors.muted}
          secureTextEntry={secure && hidden}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[styles.input, style]}
          {...rest}
        />
        {secure && (
          <Pressable
            testID={testID ? `${testID}-toggle-visibility` : undefined}
            onPress={() => setHidden((h) => !h)}
            hitSlop={12}
            accessibilityLabel={hidden ? "Show password" : "Hide password"}
          >
            <Ionicons name={hidden ? "eye-outline" : "eye-off-outline"} size={20} color={colors.muted} />
          </Pressable>
        )}
      </View>
      {!!error && (
        <Text style={styles.error} testID={testID ? `${testID}-error` : undefined}>
          {error}
        </Text>
      )}
      {!error && !!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
});

export function Card({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const styles = useStyles();
  return (
    <View testID={testID} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const styles = useStyles();
  return <Text style={styles.section}>{children}</Text>;
}

type RowProps = PressableProps & {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  value?: string;
  danger?: boolean;
  right?: React.ReactNode;
  last?: boolean;
};

export function ListRow({ icon, title, value, danger, right, last, onPress, testID, ...rest }: RowProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && { backgroundColor: colors.surfaceTertiary }]}
      {...rest}
    >
      <View style={[styles.rowIcon, { backgroundColor: danger ? colors.errorSoft : colors.brandTertiary }]}>
        <Ionicons name={icon} size={18} color={danger ? colors.error : colors.onBrandTertiary} />
      </View>
      <Text style={[styles.rowTitle, danger && { color: colors.error }]} numberOfLines={1}>
        {title}
      </Text>
      {!!value && (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      )}
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null)}
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  btn: {
    minHeight: 52,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  btnBorder: { borderWidth: 1, borderColor: c.border },
  btnText: { fontFamily: fonts.semibold, fontSize: type.lg },
  field: { gap: spacing.xs + 2 },
  label: { fontFamily: fonts.semibold, fontSize: type.sm + 1, color: c.onSurfaceSecondary },
  inputWrap: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: c.border,
    backgroundColor: c.surfaceSecondary,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  prefix: { fontFamily: fonts.semibold, fontSize: type.lg, color: c.onSurfaceSecondary },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: type.lg,
    color: c.onSurface,
    paddingVertical: spacing.md,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
  },
  error: { fontFamily: fonts.medium, fontSize: type.sm, color: c.error },
  hint: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted },
  card: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.border,
  },
  section: {
    fontFamily: fonts.semibold,
    fontSize: type.sm,
    color: c.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.lg },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: c.divider },
  rowIcon: { width: 32, height: 32, borderRadius: radius.sm + 2, alignItems: "center", justifyContent: "center" },
  rowTitle: { flex: 1, fontFamily: fonts.medium, fontSize: type.lg, color: c.onSurface },
  rowValue: { fontFamily: fonts.regular, fontSize: type.base, color: c.muted, maxWidth: "45%" },
}));
