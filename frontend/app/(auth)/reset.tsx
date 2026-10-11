import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";

import { request } from "@/src/api";
import { AuthShell } from "@/src/components/auth-shell";
import { CodeInput } from "@/src/components/code-input";
import { useToast } from "@/src/components/toast";
import { Button, TextField } from "@/src/components/ui";
import { passwordProblem } from "@/src/format";
import { fonts, makeStyles, type } from "@/src/theme";

export default function Reset() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const router = useRouter();
  const toast = useToast();
  const styles = useStyles();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (code.length !== 6) return setError("Enter the 6-digit code.");
    const p = passwordProblem(password);
    if (p) return setError(p);
    setError(null);
    setLoading(true);
    try {
      await request("/auth/reset-password", { method: "POST", body: { email, code, new_password: password }, auth: false });
      toast("Password updated — please sign in");
      router.dismissTo("/login");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Set a new password" subtitle={`Enter the code sent to ${email ?? "your email"}.`} testID="reset-screen">
      <CodeInput testID="reset-code-input" value={code} onChange={setCode} />
      <TextField
        testID="reset-password-input"
        label="New password"
        value={password}
        onChangeText={setPassword}
        secure
        autoComplete="new-password"
        placeholder="At least 10 characters"
        hint="10+ characters with letters and numbers. You'll be signed out on other devices."
      />
      {!!error && (
        <Text style={styles.error} testID="reset-error-text">
          {error}
        </Text>
      )}
      <Button testID="reset-submit-button" label="Update password" onPress={submit} loading={loading} />
    </AuthShell>
  );
}

const useStyles = makeStyles((c) => ({
  error: { fontFamily: fonts.medium, fontSize: type.base, color: c.error },
}));
