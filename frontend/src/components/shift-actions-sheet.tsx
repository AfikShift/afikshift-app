import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { PaymentsPanel } from "@/src/components/payments-panel";
import { ShiftCard } from "@/src/components/shift-card";
import { useToast } from "@/src/components/toast";
import { Button, tap } from "@/src/components/ui";
import { DUTY_LABEL, STATUS_LABEL, formatDateLong } from "@/src/shifts/calc";
import { LocalShift, ServerShift, useShifts } from "@/src/shifts/provider";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

function Action({ icon, label, onPress, danger, testID }: { icon: IconName; label: string; onPress: () => void; danger?: boolean; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [styles.action, pressed && { backgroundColor: colors.surfaceTertiary }]}
    >
      <Ionicons name={icon} size={20} color={danger ? colors.error : colors.onSurface} />
      <Text style={[styles.actionText, danger && { color: colors.error }]}>{label}</Text>
    </Pressable>
  );
}

function summary(s: ServerShift | LocalShift) {
  return `${DUTY_LABEL[s.duty_type]} · ${formatDateLong(s.date)} ${s.start_time}–${s.end_time} · ${s.break_minutes}m break · ${STATUS_LABEL[s.status]}${s.location ? ` · ${s.location}` : ""}`;
}

export function ShiftActionsSheet({ shift, onClose }: { shift: LocalShift | null; onClose: () => void }) {
  const { user } = useAuth();
  const { update, remove, resolveConflict } = useShifts();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const close = () => {
    setConfirmDelete(false);
    onClose();
  };
  const run = async (fn: () => Promise<void>, msg: string) => {
    await fn();
    toast(msg);
    close();
  };
  const go = (params: Record<string, string>) => {
    close();
    router.push({ pathname: "/shift-form", params });
  };

  return (
    <Modal visible={!!shift} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={() => {}} testID="shift-actions-sheet">
          <View style={styles.grabber} />
          {shift && (
            <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md }}>
              <ShiftCard shift={shift} currency={user?.currency} />

              {shift._sync === "conflict" && (
                <View style={styles.conflict} testID="shift-conflict-panel">
                  <View style={styles.conflictHead}>
                    <Ionicons name="git-compare-outline" size={18} color={colors.error} />
                    <Text style={styles.conflictTitle}>Changed on another device</Text>
                  </View>
                  <Text style={styles.conflictLabel}>This device</Text>
                  <Text style={styles.conflictBody}>{summary(shift)}</Text>
                  <Text style={styles.conflictLabel}>Saved on server</Text>
                  <Text style={styles.conflictBody}>{shift._server ? (shift._server.deleted ? "Deleted on another device" : summary(shift._server)) : "No longer on the server"}</Text>
                  <View style={styles.conflictBtns}>
                    <Button testID="conflict-keep-mine-button" label="Keep this device's" style={{ flex: 1 }} onPress={() => run(() => resolveConflict(shift.id, "mine"), "Keeping this device's version")} />
                    <Button testID="conflict-use-server-button" label="Use server's" variant="secondary" style={{ flex: 1 }} onPress={() => run(() => resolveConflict(shift.id, "server"), "Using the server version")} />
                  </View>
                </View>
              )}

              <PaymentsPanel shift={shift} />

              {!confirmDelete ? (
                <View style={styles.actions}>
                  {shift.status === "booked" && (
                    <Action testID="shift-action-complete" icon="checkmark-circle-outline" label="Mark as completed" onPress={() => run(() => update(shift.id, { status: "completed" }), "Shift marked as completed")} />
                  )}
                  <Action testID="shift-action-edit" icon="create-outline" label="Edit" onPress={() => go({ id: shift.id })} />
                  <Action testID="shift-action-duplicate" icon="copy-outline" label="Duplicate" onPress={() => go({ duplicate: shift.id })} />
                  {shift.status !== "cancelled" ? (
                    <Action
                      testID="shift-action-cancel"
                      icon="close-circle-outline"
                      label="Cancel shift"
                      onPress={() =>
                        (shift.payments ?? []).some((p) => !p.deleted)
                          ? toast("Remove recorded payments before cancelling this shift", "error")
                          : run(() => update(shift.id, { status: "cancelled" }), "Shift cancelled")
                      }
                    />
                  ) : (
                    <Action testID="shift-action-restore" icon="refresh-outline" label="Restore as booked" onPress={() => run(() => update(shift.id, { status: "booked" }), "Shift restored")} />
                  )}
                  <Action testID="shift-action-delete" icon="trash-outline" label="Delete" danger onPress={() => setConfirmDelete(true)} />
                </View>
              ) : (
                <View style={{ gap: spacing.sm }} testID="shift-delete-confirm">
                  <Text style={styles.confirm}>
                    Delete this shift? It moves to Recently Deleted with all its payments for 90 days and can be restored from Account. Cancelling keeps it in your history instead.
                  </Text>
                  <Button testID="shift-delete-confirm-button" label="Delete shift" variant="danger" onPress={() => run(() => remove(shift.id), "Shift deleted")} />
                  <Button testID="shift-delete-cancel-button" label="Keep it" variant="ghost" onPress={() => setConfirmDelete(false)} />
                </View>
              )}
            </KeyboardAwareScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: "88%",
  },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: c.borderStrong, marginBottom: spacing.md },
  actions: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, overflow: "hidden" },
  action: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 52, paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.divider },
  actionText: { fontFamily: fonts.semibold, fontSize: type.lg, color: c.onSurface },
  label: { fontFamily: fonts.semibold, fontSize: type.sm + 1, color: c.onSurfaceSecondary },
  confirm: { fontFamily: fonts.regular, fontSize: type.base, color: c.onSurfaceSecondary, lineHeight: 21 },
  conflict: { backgroundColor: c.errorSoft, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  conflictHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  conflictTitle: { fontFamily: fonts.bold, fontSize: type.lg, color: c.onSurface },
  conflictLabel: { fontFamily: fonts.semibold, fontSize: type.sm, color: c.muted, marginTop: spacing.xs },
  conflictBody: { fontFamily: fonts.regular, fontSize: type.sm + 1, color: c.onSurface },
  conflictBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
}));
