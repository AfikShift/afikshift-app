import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { request } from "@/src/api";
import { STORE } from "@/src/billing/store";
import { fonts, makeStyles, radius, spacing, type } from "@/src/theme";

const DOWNLOAD_PAGE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/public/download`;
const current = Constants.expoConfig?.version ?? "0.0.0";

/** "1.2.10" > "1.2.9" */
export function isOlder(a: string, b: string) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  return false;
}

/** Aptoide / direct APK installs don't update themselves: check the server's latest and minimum versions. */
export function useAppUpdate() {
  const [v, setV] = useState<{ latest: string; min_supported: string } | null>(null);
  useEffect(() => {
    if (STORE !== "aptoide") return; // Google Play handles its own updates
    request("/public/app-version", { auth: false }).then(setV).catch(() => {});
  }, []);
  return { available: !!v && isOlder(current, v.latest), required: !!v && isOlder(current, v.min_supported), latest: v?.latest };
}

export const openDownloadPage = () => WebBrowser.openBrowserAsync(DOWNLOAD_PAGE);

export function UpdateBanner() {
  const styles = useStyles();
  const { available, latest } = useAppUpdate();
  if (!available) return null;
  return (
    <Pressable testID="update-banner" onPress={openDownloadPage} style={styles.banner}>
      <Text style={styles.bannerText}>Update available (v{latest}) – tap to download. Your data is kept.</Text>
    </Pressable>
  );
}

/** Full-screen notice when this version is no longer supported (e.g. after an important fix). */
export function RequiredUpdateGate({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  const { required, latest } = useAppUpdate();
  if (!required) return <>{children}</>;
  return (
    <View style={styles.gate} testID="required-update-screen">
      <Text style={styles.gateTitle}>Please update AfikShift</Text>
      <Text style={styles.gateText}>This version is no longer supported. Install version {latest} to continue – your account and records are kept.</Text>
      <Pressable testID="required-update-button" onPress={openDownloadPage} style={styles.gateBtn}>
        <Text style={styles.gateBtnText}>Download update</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  banner: { backgroundColor: c.brandTertiary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  bannerText: { fontFamily: fonts.semibold, fontSize: type.sm + 1, color: c.onBrandTertiary },
  gate: { flex: 1, backgroundColor: c.surface, justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  gateTitle: { fontFamily: fonts.bold, fontSize: type.xl, color: c.onSurface },
  gateText: { fontFamily: fonts.regular, fontSize: type.base, color: c.onSurfaceSecondary, lineHeight: 21 },
  gateBtn: { backgroundColor: c.hero, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center" },
  gateBtnText: { fontFamily: fonts.bold, fontSize: type.base, color: c.onHero },
}));
