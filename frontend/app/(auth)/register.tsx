import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { request } from "@/src/api";
import { useAuth } from "@/src/auth";
import { AuthShell } from "@/src/components/auth-shell";
import { Button, TextField } from "@/src/components/ui";
import { passwordProblem } from "@/src/format";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

export default function Register() {
  const { register } = useAuth();
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const emailRef = useRef<TextInput>(null);
  const pwRef = useRef<TextInput>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [referral, setReferral] = useState("");
  const [referralsOn, setReferralsOn] = useState(false);
  useEffect(() => {
    request("/programmes", { auth: false })
      .then((p) => setReferralsOn(!!p.referrals))
      .catch(() => {});
  }, []);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const e: Record<string, string | null> = {
      name: name.trim().length < 2 ? "Enter your full name." : null,
      email: /^\S+@\S+\.\S+$/.test(email.trim()) ? null : "Enter a valid email address.",
      password: passwordProblem(password),
      consent: consent ? null : "Please confirm to continue.",
    };
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    setLoading(true);
    try {
      const em = email.trim().toLowerCase();
      await register(name.trim(), em, password, referral.trim().toUpperCase());
      router.push({ pathname: "/verify", params: { email: em } });
    } catch (err) {
      setErrors({ form: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Create your account" subtitle="Track Bed Watch, Constant Watch, hospital escorts, enhanced observations, bank shifts, overtime and more. Takes under a minute." testID="register-screen">
      <TextField
        testID="register-name-input"
        label="Full name"
        value={name}
        onChangeText={setName}
        autoComplete="name"
        placeholder="e.g. Sam Taylor"
        error={errors.name}
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
      />
      <TextField
        ref={emailRef}
        testID="register-email-input"
        label="Personal email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="you@example.com"
        error={errors.email}
        hint="Use a personal email, not an employer-managed address."
        returnKeyType="next"
        onSubmitEditing={() => pwRef.current?.focus()}
      />
      <TextField
        ref={pwRef}
        testID="register-password-input"
        label="Password"
        value={password}
        onChangeText={setPassword}
        secure
        autoComplete="new-password"
        placeholder="At least 10 characters"
        error={errors.password}
        hint="10+ characters with letters and numbers."
      />
      {referralsOn && (
      <TextField
        testID="register-referral-input"
        label="Referral code (optional)"
        value={referral}
        onChangeText={setReferral}
        autoCapitalize="characters"
        placeholder="e.g. 7KQ2MXRP"
        hint="Got a code from a friend? You'll both get a free month of Pro after your first paid month."
      />
      )}
      <Pressable testID="register-consent-checkbox" onPress={() => setConsent((v) => !v)} style={styles.consent} hitSlop={4}>
        <View style={[styles.box, consent && { backgroundColor: colors.brandSecondary, borderColor: colors.brandSecondary }]}>
          {consent && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
        </View>
        <Text style={styles.consentText}>
          I understand DutyConnect stores my personal shift records only, and I will not enter other people's personal details or confidential
          employer information.
        </Text>
      </Pressable>
      {!!errors.consent && <Text style={styles.error}>{errors.consent}</Text>}
      {!!errors.form && (
        <Text style={styles.error} testID="register-error-text">
          {errors.form}
        </Text>
      )}
      <Button testID="register-submit-button" label="Create account" onPress={submit} loading={loading} />
      <View style={styles.footer}>
        <Text style={styles.muted}>Already registered?</Text>
        <Pressable testID="register-go-login-link" onPress={() => router.replace("/login")} hitSlop={8}>
          <Text style={styles.link}>Sign in</Text>
        </Pressable>
      </View>
    </AuthShell>
  );
}

const useStyles = makeStyles((c) => ({
  consent: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: c.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  consentText: { flex: 1, fontFamily: fonts.regular, fontSize: type.sm + 1, color: c.onSurfaceSecondary, lineHeight: 19 },
  error: { fontFamily: fonts.medium, fontSize: type.base, color: c.error },
  link: { fontFamily: fonts.semibold, fontSize: type.base, color: c.brandSecondary },
  footer: { flexDirection: "row", justifyContent: "center", gap: spacing.xs + 2, marginTop: spacing.sm },
  muted: { fontFamily: fonts.regular, fontSize: type.base, color: c.muted },
}));
