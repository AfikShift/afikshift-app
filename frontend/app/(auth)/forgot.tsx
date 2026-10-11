import { useRouter } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";

import { request } from "@/src/api";
import { AuthShell } from "@/src/components/auth-shell";
import { Button, TextField } from "@/src/components/ui";
import { fonts, makeStyles, type } from "@/src/theme";

export default function Forgot() {
  const router = useRouter();
  const styles = useStyles();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const em = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(em)) return setError("Enter a valid email address.");
    setError(null);
    setLoading(true);
    try {
      await request("/auth/forgot-password", { method: "POST", body: { email: em }, auth: false });
      router.push({ pathname: "/reset", params: { email: em } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Reset password" subtitle="We'll email you a 6-digit code to set a new password." testID="forgot-screen">
      <TextField
        testID="forgot-email-input"
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="you@example.com"
        returnKeyType="send"
        onSubmitEditing={submit}
      />
      {!!error && (
        <Text style={styles.error} testID="forgot-error-text">
          {error}
        </Text>
      )}
      <Button testID="forgot-submit-button" label="Send reset code" onPress={submit} loading={loading} />
    </AuthShell>
  );
}

const useStyles = makeStyles((c) => ({
  error: { fontFamily: fonts.medium, fontSize: type.base, color: c.error },
}));
