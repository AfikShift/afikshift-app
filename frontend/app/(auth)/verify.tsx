import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text } from "react-native";

import { request } from "@/src/api";
import { useAuth } from "@/src/auth";
import { AuthShell } from "@/src/components/auth-shell";
import { CodeInput } from "@/src/components/code-input";
import { useToast } from "@/src/components/toast";
import { Button } from "@/src/components/ui";
import { fonts, makeStyles, type } from "@/src/theme";

export default function Verify() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const { verifyEmail } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const styles = useStyles();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(45);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = async () => {
    if (code.length !== 6) return setError("Enter the 6-digit code.");
    setError(null);
    setLoading(true);
    try {
      await verifyEmail(String(email), code);
      toast("Email verified — welcome to DutyConnect");
      router.replace("/(tabs)");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    try {
      await request("/auth/resend-verification", { method: "POST", body: { email }, auth: false });
      toast("A new code is on its way", "info");
      setCooldown(45);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <AuthShell title="Check your email" subtitle={`Enter the 6-digit code we sent to ${email ?? "your email"}.`} testID="verify-screen">
      <CodeInput testID="verify-code-input" value={code} onChange={setCode} />
      {!!error && (
        <Text style={styles.error} testID="verify-error-text">
          {error}
        </Text>
      )}
      <Button testID="verify-submit-button" label="Verify email" onPress={submit} loading={loading} disabled={code.length !== 6} />
      <Pressable testID="verify-resend-button" onPress={resend} disabled={cooldown > 0} hitSlop={8} style={styles.resend}>
        <Text style={[styles.link, cooldown > 0 && styles.muted]}>
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </Text>
      </Pressable>
      <Text style={styles.muted}>Can&apos;t find it? Check your spam or junk folder. Codes expire after 15 minutes.</Text>
    </AuthShell>
  );
}

const useStyles = makeStyles((c) => ({
  error: { fontFamily: fonts.medium, fontSize: type.base, color: c.error },
  resend: { alignSelf: "center", minHeight: 36, justifyContent: "center" },
  link: { fontFamily: fonts.semibold, fontSize: type.base, color: c.brandSecondary },
  muted: { fontFamily: fonts.regular, fontSize: type.sm + 1, color: c.muted, textAlign: "center" },
}));
