import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Platform, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { request } from "@/src/api";
import { Segmented } from "@/src/components/segmented";
import { StackHeader } from "@/src/components/stack-header";
import { useToast } from "@/src/components/toast";
import { Button, Card, SectionTitle, TextField } from "@/src/components/ui";
import { formatDateLong } from "@/src/shifts/calc";
import { fonts, makeStyles, radius, spacing, type } from "@/src/theme";
import { REFERRAL_STATUS } from "@/src/referrals";

type Row = { id: string; status: string; warnings?: string[]; referrer_email: string; friend_email: string; created_at: string; qualifies_at?: string; reason?: string; referrer_reward?: string; friend_reward?: string };
type Member = { id: string; email: string; ambassador: boolean; referral_cap: number | null; monthly_cap: number; referral_code: string };
type Filter = "awaiting_approval" | "held" | "paid" | "all";

const confirm = (msg: string) =>
  Platform.OS === "web"
    ? Promise.resolve(window.confirm(msg))
    : new Promise<boolean>((res) => Alert.alert("Please confirm", msg, [{ text: "Back", style: "cancel", onPress: () => res(false) }, { text: "Confirm", onPress: () => res(true) }]));

/** Admin only (ADMIN_EMAILS on the server). Approve or cancel referral rewards; set ambassador status and monthly caps. */
export default function AdminReferrals() {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const [filter, setFilter] = useState<Filter>("awaiting_approval");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [member, setMember] = useState<Member | null>(null);
  const [cap, setCap] = useState("");

  const load = useCallback(async (f: Filter) => {
    try {
      const q = f === "all" ? "" : `?status=${f}`;
      setRows((await request(`/admin/referrals${q}`)).referrals);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);
  useFocusEffect(
    useCallback(() => {
      load(filter);
    }, [load, filter]),
  );

  const act = async (r: Row, action: "approve" | "cancel") => {
    const ok = await confirm(
      action === "approve"
        ? `Approve this referral? ${r.friend_email} and ${r.referrer_email} each get 1 free month of Pro (referrer subject to their monthly limit).`
        : `Cancel this referral? No rewards will be given.`,
    );
    if (!ok) return;
    setBusyId(r.id);
    try {
      const res = await request(`/admin/referrals/${r.id}/${action}`, { method: "POST", body: action === "cancel" ? { reason: "Cancelled by admin" } : undefined });
      toast(action === "approve" ? (res.referrer_reward === "capped" ? "Approved – referrer at monthly limit" : "Approved – rewards added") : "Referral cancelled", "success");
      await load(filter);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusyId(null);
    }
  };

  const find = async () => {
    try {
      const m: Member = await request(`/admin/members?email=${encodeURIComponent(email.trim())}`);
      setMember(m);
      setCap(m.referral_cap == null ? "" : String(m.referral_cap));
    } catch (e) {
      setMember(null);
      toast((e as Error).message, "error");
    }
  };
  const saveMember = async (body: Record<string, unknown>) => {
    if (!member) return;
    try {
      const r = await request(`/admin/members/${member.id}`, { method: "PATCH", body });
      setMember({ ...member, ...r });
      setCap(r.referral_cap == null ? "" : String(r.referral_cap));
      toast("Saved", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <View style={styles.root} testID="admin-referrals-screen">
      <StackHeader title="Referral admin" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(filter)} />}
      >
        <Segmented<Filter>
          testPrefix="admin-filter"
          value={filter}
          onChange={(f) => {
            setRows(null);
            setFilter(f);
          }}
          options={[
            { value: "awaiting_approval", label: "To approve" },
            { value: "held", label: "Held" },
            { value: "paid", label: "Qualifying" },
            { value: "all", label: "All" },
          ]}
        />
        {!rows ? (
          <ActivityIndicator />
        ) : rows.length === 0 ? (
          <Text style={styles.small} testID="admin-referrals-empty">Nothing here.</Text>
        ) : (
          rows.map((r) => (
            <Card key={r.id} style={styles.card} testID={`admin-referral-${r.id}`}>
              <Text style={styles.title}>{REFERRAL_STATUS[r.status] ?? r.status}</Text>
              <Text style={styles.small}>Referrer: {r.referrer_email}</Text>
              <Text style={styles.small}>Friend: {r.friend_email}</Text>
              <Text style={styles.small}>
                Joined {formatDateLong(r.created_at.slice(0, 10))}
                {r.qualifies_at ? ` · qualifies ${formatDateLong(r.qualifies_at.slice(0, 10))}` : ""}
              </Text>
              {!!r.reason && <Text style={styles.small}>Reason: {r.reason}</Text>}
              {r.warnings?.map((w) => (
                <Text key={w} style={styles.warn} testID={`admin-warning-${r.id}`}>
                  ⚠ {w}
                </Text>
              ))}
              {!!r.referrer_reward && <Text style={styles.small}>Rewards: friend {r.friend_reward}, referrer {r.referrer_reward}</Text>}
              {(r.status === "awaiting_approval" || r.status === "held") && (
                <Button testID={`admin-approve-${r.id}`} label={r.status === "held" ? "Reviewed – approve rewards" : "Approve rewards"} loading={busyId === r.id} onPress={() => act(r, "approve")} />
              )}
              {["signed_up", "paid", "awaiting_approval", "held"].includes(r.status) && (
                <Button testID={`admin-cancel-${r.id}`} label="Cancel referral" variant="ghost" disabled={busyId === r.id} onPress={() => act(r, "cancel")} />
              )}
            </Card>
          ))
        )}

        <SectionTitle>Ambassadors & monthly limits</SectionTitle>
        <TextField testID="admin-member-email" label="Member email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <Button testID="admin-member-find" label="Find member" variant="secondary" disabled={!email.trim()} onPress={find} />
        {member && (
          <Card style={styles.card} testID="admin-member-card">
            <Text style={styles.title}>{member.email}</Text>
            <Text style={styles.small}>
              Code {member.referral_code} · {member.ambassador ? "Ambassador" : "Member"} · limit {member.monthly_cap} rewards/month
            </Text>
            <Button
              testID="admin-member-ambassador"
              label={member.ambassador ? "Remove ambassador status" : "Make ambassador"}
              variant="secondary"
              onPress={() => saveMember({ ambassador: !member.ambassador })}
            />
            <TextField testID="admin-member-cap" label="Custom monthly limit (blank = default)" value={cap} onChangeText={setCap} keyboardType="number-pad" />
            <Button
              testID="admin-member-cap-save"
              label="Save limit"
              variant="secondary"
              onPress={() => saveMember(cap.trim() === "" ? { clear_cap: true } : { referral_cap: Math.max(0, Math.min(100, parseInt(cap, 10) || 0)) })}
            />
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.md },
  title: { fontFamily: fonts.semibold, fontSize: type.base, color: c.onSurface },
  small: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted, lineHeight: 18 },
  warn: { fontFamily: fonts.semibold, fontSize: type.sm, color: c.warning },
}));
