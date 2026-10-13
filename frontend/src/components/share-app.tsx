import Ionicons from "@react-native-vector-icons/ionicons";
import { Modal, Pressable, Share, Text, View } from "react-native";

import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const APTOIDE_URL = "https://afikshift.en.aptoide.com"; // placeholder until the listing is live (server copy: APTOIDE_URL)
export const DIRECT_URL = `${BASE}/api/public/download/android`; // stable link – always the latest signed APK
const DISCLAIMER = "AfikShift is independent and not affiliated with any government agency or employer.";

/** Share message for either distribution method (optionally with a referral code). */
export function shareMessage(method: "aptoide" | "direct", code?: string, aptoideUrl = APTOIDE_URL) {
  const link = method === "aptoide" ? `Download AfikShift on Aptoide: ${aptoideUrl}` : `Direct download for Android: ${DIRECT_URL}`;
  return (
    `🚀 AfikShift – Independent Shift & Earnings Tracker\n` +
    `Track Bed Watch, Constant Watch, hospital escorts, enhanced observations, bank shifts, overtime and more.\n\n` +
    `${link}\n` +
    (code ? `Join with my code ${code} – we both get a free month of Pro after your first paid month.\n` : "") +
    `\nGoogle Play Store release coming soon!\n${DISCLAIMER}`
  );
}

/** Lets the user pick Aptoide or direct APK, then opens Android's own share menu (WhatsApp, SMS, email…). */
export function ShareAppSheet({ visible, onClose, code, aptoideUrl }: { visible: boolean; onClose: () => void; code?: string; aptoideUrl?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const pick = async (m: "aptoide" | "direct") => {
    onClose();
    try {
      await Share.share({ message: shareMessage(m, code, aptoideUrl) });
    } catch {
      // share sheet unavailable (e.g. some web browsers) – nothing to do
    }
  };
  const opt = (m: "aptoide" | "direct", icon: React.ComponentProps<typeof Ionicons>["name"], title: string, sub: string) => (
    <Pressable testID={`share-app-${m}`} onPress={() => pick(m)} style={styles.opt}>
      <Ionicons name={icon} size={22} color={colors.brandSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="share-app-backdrop" />
      <View style={styles.sheet} testID="share-app-sheet">
        <Text style={styles.head}>Share AfikShift</Text>
        {opt("aptoide", "storefront-outline", "Download via Aptoide", "Share the official Aptoide listing")}
        {opt("direct", "download-outline", "Direct download (Android)", "Share a secure link to the latest app file")}
        <Pressable testID="share-app-cancel" onPress={onClose} style={styles.cancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.xl, gap: spacing.md },
  head: { fontFamily: fonts.bold, fontSize: type.lg, color: c.onSurface },
  opt: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: c.surfaceSecondary, minHeight: 56 },
  title: { fontFamily: fonts.semibold, fontSize: type.base, color: c.onSurface },
  sub: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted },
  cancel: { alignItems: "center", paddingVertical: spacing.md },
  cancelText: { fontFamily: fonts.semibold, fontSize: type.base, color: c.onSurfaceSecondary },
}));
