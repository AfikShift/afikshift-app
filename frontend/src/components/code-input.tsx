import { useRef } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export function CodeInput({ value, onChange, testID }: { value: string; onChange: (v: string) => void; testID?: string }) {
  const ref = useRef<TextInput>(null);
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable onPress={() => ref.current?.focus()} style={styles.row}>
      {Array.from({ length: 6 }).map((_, i) => (
        <View
          key={i}
          style={[styles.cell, i === value.length && { borderColor: colors.brandSecondary }]}
        >
          <Text style={styles.digit}>{value[i] ?? ""}</Text>
        </View>
      ))}
      <TextInput
        ref={ref}
        testID={testID}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        autoFocus
        style={styles.hidden}
      />
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  cell: {
    flex: 1,
    height: 60,
    maxWidth: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: c.border,
    backgroundColor: c.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  digit: { fontFamily: fonts.bold, fontSize: 24, color: c.onSurface },
  hidden: { position: "absolute", opacity: 0.01, width: "100%", height: "100%" },
}));
