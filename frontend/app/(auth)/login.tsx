import { Link, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { ApiError, useAuth } from "@/src/auth";
import { AuthShell } from "@/src/components/auth-shell";
import { Button, TextField } from "@/src/components/ui";
import { fonts, makeStyles, spacing, type } from "@/src/theme";

export default function Login() {
  const { login } = useAuth();
  const router = useRouter();
  const styles = useStyles();
  const pwRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return setError("Enter your email and password.");
    setError(null);
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      router.replace("/(tabs)");
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        router.push({ pathname: "/verify", params: { email: email.trim().toLowerCase() } });
      } else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to manage your PP shifts." testID="login-screen">
      <TextField
        testID="login-email-input"
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="you@example.com"
        returnKeyType="next"
        onSubmitEditing={() => pwRef.current?.focus()}
      />
      <TextField
        ref={pwRef}
        testID="login-password-input"
        label="Password"
        value={password}
        onChangeText={setPassword}
        secure
        autoComplete="password"
        placeholder="Your password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {!!error && (
        <Text style={styles.error} testID="login-error-text">
          {error}
        </Text>
      )}
      <Link href="/forgot" asChild>
        <Pressable testID="login-forgot-password-link" hitSlop={8} style={styles.forgot}>
          <Text style={styles.link}>Forgot password?</Text>
        </Pressable>
      </Link>
      <Button testID="login-submit-button" label="Sign in" onPress={submit} loading={loading} />
      <View style={styles.footer}>
        <Text style={styles.muted}>New to DutyConnect?</Text>
        <Pressable testID="login-go-register-link" onPress={() => router.replace("/register")} hitSlop={8}>
          <Text style={styles.link}>Create account</Text>
        </Pressable>
      </View>
    </AuthShell>
  );
}

const useStyles = makeStyles((c) => ({
  error: { fontFamily: fonts.medium, fontSize: type.base, color: c.error },
  forgot: { alignSelf: "flex-end", minHeight: 32, justifyContent: "center" },
  link: { fontFamily: fonts.semibold, fontSize: type.base, color: c.brandSecondary },
  footer: { flexDirection: "row", justifyContent: "center", gap: spacing.xs + 2, marginTop: spacing.sm },
  muted: { fontFamily: fonts.regular, fontSize: type.base, color: c.muted },
}));
