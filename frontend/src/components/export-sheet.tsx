import Ionicons from "@react-native-vector-icons/ionicons";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { useToast } from "@/src/components/toast";
import { Button } from "@/src/components/ui";
import { ProPrompt } from "@/src/components/pro-prompt";
import { useEntitlement } from "@/src/billing/entitlement";
import { LocalShift } from "@/src/shifts/provider";
import { reportRows, shareReport } from "@/src/shifts/report";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

type Props = { visible: boolean; onClose: () => void; shifts: LocalShift[]; label: string; from?: string; to?: string };

/** Choose CSV or PDF, confirm the privacy warning, then share. */
export function ExportSheet({ visible, onClose, shifts, label, from, to }: Props) {
  const { user } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const [format, setFormat] = useState<"csv" | "pdf" | null>(null);
  const [busy, setBusy] = useState(false);
  const { isPro } = useEntitlement();
  const count = reportRows(shifts, from, to).length;

  const close = () => {
    setFormat(null);
    onClose();
  };
  const confirm = async () => {
    if (!format || !user) return;
    setBusy(true);
    try {
      await shareReport(format, shifts, { officer: user.full_name, email: user.email, currency: user.currency, label, from, to });
      close();
    } catch {
      toast("Couldn't create the report. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={() => {}} testID="export-sheet">
          <View style={styles.grabber} />
          <Text style={styles.title}>Export report</Text>
          <Text style={styles.sub} testID="export-period">
            {label} · {count} shift{count === 1 ? "" : "s"}
          </Text>
          {!format ? (
            <View style={{ gap: spacing.sm }}>
              {isPro ? (
                <>
                  <Button testID="export-csv-button" label="CSV spreadsheet" icon="grid-outline" variant="secondary" onPress={() => setFormat("csv")} />
                  <Button testID="export-pdf-button" label="PDF report" icon="document-text-outline" variant="secondary" onPress={() => setFormat("pdf")} />
                </>
              ) : (
                <ProPrompt
                  testID="export-pro-prompt"
                  title="CSV & PDF reports with Pro"
                  body="A free copy of all your personal data is always available: Account → Download my data."
                />
              )}
              <Button testID="export-close-button" label="Cancel" variant="ghost" onPress={close} />
            </View>
          ) : (
            <View style={{ gap: spacing.md }} testID="export-privacy-warning">
              <View style={styles.warn}>
                <Ionicons name="shield-checkmark-outline" size={20} color={colors.warning} />
                <Text style={styles.warnText}>
                  This {format.toUpperCase()} contains your personal shift and earnings records only. Once shared it leaves DutyConnect's encryption, so
                  send it only to people or services you trust, avoid shared or work-issued devices, and delete copies you no longer need.
                </Text>
              </View>
              <Button testID="export-confirm-button" label="I understand – share" loading={busy} onPress={confirm} />
              <Button testID="export-back-button" label="Back" variant="ghost" onPress={() => setFormat(null)} />
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: c.borderStrong, marginBottom: spacing.sm },
  title: { fontFamily: fonts.bold, fontSize: type.xl, color: c.onSurface },
  sub: { fontFamily: fonts.medium, fontSize: type.base, color: c.muted, marginBottom: spacing.sm },
  warn: { flexDirection: "row", gap: spacing.sm, backgroundColor: c.warningSoft, borderRadius: radius.md, padding: spacing.md },
  warnText: { flex: 1, fontFamily: fonts.regular, fontSize: type.sm + 1, color: c.onSurface, lineHeight: 19 },
}));
