import * as LocalAuthentication from "expo-local-authentication";
import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, Switch, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { StackHeader } from "@/src/components/stack-header";
import { useToast } from "@/src/components/toast";
import { Button, Card, ListRow, SectionTitle, TextField } from "@/src/components/ui";
import { passwordProblem } from "@/src/format";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

export default function Security() {
  const { changePassword, deleteAccount, biometricEnabled, setBiometricEnabled } = useAuth();
  const toast = useToast();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [bioAvailable, setBioAvailable] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [savingPw, setSavingPw] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [delPw, setDelPw] = useState("");
  const [delError, setDelError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web") return;
    (async () => {
      setBioAvailable((await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync()));
    })();
  }, []);

  const toggleBio = async (v: boolean) => {
    if (v) {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Confirm to enable biometric unlock" });
      if (!r.success) return toast("Biometric check was cancelled", "error");
    }
    await setBiometricEnabled(v);
    toast(v ? "Biometric unlock enabled" : "Biometric unlock disabled");
  };

  const submitPw = async () => {
    if (!current) return setPwError("Enter your current password.");
    const p = passwordProblem(next);
    if (p) return setPwError(p);
    setPwError(null);
    setSavingPw(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      toast("Password changed. Other devices have been signed out.");
    } catch (e) {
      setPwError((e as Error).message);
    } finally {
      setSavingPw(false);
    }
  };

  const confirmDelete = async () => {
    if (!delPw) return setDelError("Enter your password to confirm.");
    setDeleting(true);
    try {
      await deleteAccount(delPw);
    } catch (e) {
      setDelError((e as Error).message);
      setDeleting(false);
    }
  };

  return (
    <View style={styles.root} testID="security-screen">
      <StackHeader title="Security" />
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
      >
        <SectionTitle>App lock</SectionTitle>
        <Card style={styles.group}>
          <View style={styles.bioRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Face ID / fingerprint unlock</Text>
              <Text style={styles.rowSub}>
                {Platform.OS === "web"
                  ? "Available in the iPhone and Android app."
                  : bioAvailable
                    ? "Require biometrics when opening DutyConnect."
                    : "Set up Face ID or a fingerprint in your phone settings first."}
              </Text>
            </View>
            <Switch
              testID="security-biometric-switch"
              value={biometricEnabled}
              disabled={!bioAvailable && !biometricEnabled}
              onValueChange={toggleBio}
              trackColor={{ true: colors.brandSecondary, false: colors.surfaceTertiary }}
              thumbColor="#FFFFFF"
            />
          </View>
        </Card>

        <SectionTitle>Change password</SectionTitle>
        <View style={styles.form}>
          <TextField testID="security-current-password-input" label="Current password" value={current} onChangeText={setCurrent} secure autoComplete="password" />
          <TextField
            testID="security-new-password-input"
            label="New password"
            value={next}
            onChangeText={setNext}
            secure
            autoComplete="new-password"
            hint="10+ characters with letters and numbers."
          />
          {!!pwError && (
            <Text style={styles.error} testID="security-password-error">
              {pwError}
            </Text>
          )}
          <Button testID="security-change-password-button" label="Update password" variant="secondary" onPress={submitPw} loading={savingPw} />
        </View>

        <SectionTitle>Your data</SectionTitle>
        <Card style={styles.group}>
          <ListRow testID="security-delete-account-row" icon="trash-outline" title="Delete account" danger onPress={() => setShowDelete(true)} last />
        </Card>
        <Text style={styles.note}>
          Your data is encrypted in transit and protected by your password. DutyConnect never needs other people's personal details or confidential
          employer information.
        </Text>
      </KeyboardAwareScrollView>

      <Modal visible={showDelete} transparent animationType="fade" onRequestClose={() => setShowDelete(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowDelete(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]} onPress={() => {}} testID="delete-account-sheet">
            <Text style={styles.sheetTitle}>Delete your account?</Text>
            <Text style={styles.sheetBody}>
              This permanently deletes your profile, shifts and payment records from our servers. This cannot be undone.
            </Text>
            <TextField testID="delete-account-password-input" label="Password" value={delPw} onChangeText={setDelPw} secure error={delError} />
            <Button testID="delete-account-confirm-button" label="Delete permanently" variant="danger" onPress={confirmDelete} loading={deleting} />
            <Button testID="delete-account-cancel-button" label="Cancel" variant="ghost" onPress={() => setShowDelete(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: spacing.lg },
  group: { padding: 0, overflow: "hidden" },
  bioRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  rowTitle: { fontFamily: fonts.semibold, fontSize: type.lg, color: c.onSurface },
  rowSub: { fontFamily: fonts.regular, fontSize: type.sm + 1, color: c.muted, marginTop: 2 },
  form: { gap: spacing.lg },
  error: { fontFamily: fonts.medium, fontSize: type.base, color: c.error },
  note: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted, marginTop: spacing.lg, lineHeight: 18 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  sheetTitle: { fontFamily: fonts.bold, fontSize: type.xl, color: c.onSurface },
  sheetBody: { fontFamily: fonts.regular, fontSize: type.base, color: c.onSurfaceSecondary, lineHeight: 21 },
}));
