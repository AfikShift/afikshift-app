import Ionicons from "@react-native-vector-icons/ionicons";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, request } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useEntitlement } from "@/src/billing/entitlement";
import { ProPrompt } from "@/src/components/pro-prompt";
import { StackHeader } from "@/src/components/stack-header";
import { useToast } from "@/src/components/toast";
import { Button, TextField } from "@/src/components/ui";
import { ShiftTemplate, TIME_RE, isSensitive } from "@/src/shifts/calc";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

/** Custom shift types / templates (e.g. "Night overtime 20:00–08:00"). Free: one; Pro: unlimited. */
export default function Templates() {
  const { user, refreshUser } = useAuth();
  const { isPro } = useEntitlement();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const list: ShiftTemplate[] = user?.shift_templates ?? [];
  const [label, setLabel] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canAdd = isPro || list.length < 1;

  const save = async (next: ShiftTemplate[]) => {
    setBusy(true);
    try {
      await request("/me", { method: "PATCH", body: { shift_templates: next } });
      await refreshUser();
      return true;
    } catch (e) {
      toast(e instanceof ApiError && e.message === "pro_required_templates" ? "Free includes one custom template" : (e as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    const name = label.trim();
    if (!name || name.length > 30) return setError("Enter a name up to 30 characters.");
    if (isSensitive(name)) return setError("Don't include personal or confidential details.");
    if ((start || end) && !(TIME_RE.test(start) && TIME_RE.test(end))) return setError("Enter start and finish as HH:MM, or leave both blank.");
    setError("");
    const id = `t_${Date.now().toString(36)}`;
    if (await save([...list, { id, label: name, start_time: start || null, end_time: end || null, break_minutes: 0 }])) {
      setLabel("");
      setStart("");
      setEnd("");
    }
  };

  return (
    <View style={styles.root} testID="templates-screen">
      <StackHeader title="Shift templates" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>Create your own shift types (for example "Weekend overtime"). A template with times fills them in when you add a shift.</Text>
        {list.map((t) => (
          <View key={t.id} style={styles.row} testID={`template-${t.id}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{t.label}</Text>
              <Text style={styles.sub}>{t.start_time ? `${t.start_time}–${t.end_time}` : "No default times"}</Text>
            </View>
            <Pressable
              testID={`template-delete-${t.id}`}
              accessibilityLabel={`Delete ${t.label}`}
              hitSlop={12}
              onPress={() => save(list.filter((x) => x.id !== t.id))}
            >
              <Ionicons name="trash-outline" size={20} color={colors.error} />
            </Pressable>
          </View>
        ))}
        {canAdd ? (
          <View style={styles.card}>
            <TextField testID="template-name-input" label="Template name" value={label} onChangeText={setLabel} />
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <TextField testID="template-start-input" label="Start (optional)" value={start} onChangeText={setStart} placeholder="08:00" />
              </View>
              <View style={{ flex: 1 }}>
                <TextField testID="template-end-input" label="Finish (optional)" value={end} onChangeText={setEnd} placeholder="20:00" />
              </View>
            </View>
            {!!error && <Text style={styles.error}>{error}</Text>}
            <Button testID="template-add-button" label="Add template" icon="add" loading={busy} onPress={add} />
          </View>
        ) : (
          <ProPrompt testID="templates-pro-prompt" title="Unlimited templates with Pro" body="Free includes one custom template. Existing templates are always kept." />
        )}
        <Text style={styles.sub}>Built-in types: Standard shift, Overtime, Extra shift and Other.</Text>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: spacing.lg, gap: spacing.md },
  intro: { fontFamily: fonts.regular, fontSize: type.base, color: c.onSurfaceSecondary, lineHeight: 21 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: c.surfaceSecondary },
  card: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: c.border },
  name: { fontFamily: fonts.semibold, fontSize: type.base, color: c.onSurface },
  sub: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted },
  error: { fontFamily: fonts.medium, fontSize: type.sm, color: c.error },
}));
