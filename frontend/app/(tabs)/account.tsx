import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { useAuth } from "@/src/auth";
import { ExportSheet } from "@/src/components/export-sheet";
import { TabHeader, useTabBottomPadding } from "@/src/components/tab-screen";
import { useToast } from "@/src/components/toast";
import { Card, ListRow, SectionTitle } from "@/src/components/ui";
import { currencySymbol, initials } from "@/src/format";
import { useShifts } from "@/src/shifts/provider";

/** Public pages (no login needed); the host comes from configuration. */
const openPublic = (page: "privacy" | "terms") => WebBrowser.openBrowserAsync(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/public/${page}`);
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

export default function Account() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const styles = useStyles();
  const { colors } = useTheme();
  const bottom = useTabBottomPadding();
  const { shifts, deleted } = useShifts();
  const [exporting, setExporting] = useState(false);
  const rate = user?.hourly_rate != null ? `${currencySymbol(user.currency)}${user.hourly_rate.toFixed(2)}/hr` : "Not set";

  return (
    <View style={styles.root} testID="account-screen">
      <TabHeader title="Account" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(user?.full_name)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} testID="account-name-text" numberOfLines={1}>
              {user?.full_name}
            </Text>
            <Text style={styles.email} testID="account-email-text" numberOfLines={1}>
              {user?.email}
            </Text>
            <View style={styles.planPill}>
              <Ionicons name="sparkles-outline" size={12} color={colors.onBrandTertiary} />
              <Text style={styles.planText} testID="account-plan-text">
                Free plan
              </Text>
            </View>
          </View>
        </View>

        <SectionTitle>Profile</SectionTitle>
        <Card style={styles.group}>
          <ListRow testID="account-edit-profile-row" icon="person-outline" title="Personal details" value={user?.professional_category} onPress={() => router.push("/profile")} />
          <ListRow testID="account-rate-row" icon="cash-outline" title="Hourly PP rate" value={rate} onPress={() => router.push("/profile")} last />
        </Card>

        <SectionTitle>Security & privacy</SectionTitle>
        <Card style={styles.group}>
          <ListRow testID="account-security-row" icon="shield-checkmark-outline" title="Security" value="Password, biometrics" onPress={() => router.push("/security")} />
          <ListRow testID="account-deleted-row" icon="trash-bin-outline" title="Recently deleted" value={deleted.length ? String(deleted.length) : "90 days"} onPress={() => router.push("/recently-deleted")} />
          <ListRow
            testID="account-export-row"
            icon="download-outline"
            title="Export my data"
            value="CSV / PDF"
            onPress={() => setExporting(true)}
            last
          />
        </Card>

        <SectionTitle>Subscription</SectionTitle>
        <Card style={styles.group}>
          <ListRow
            testID="account-subscription-row"
            icon="card-outline"
            title="Plan"
            value="Free"
            onPress={() => toast("Paid plans are not active yet", "info")}
            last
          />
        </Card>

        <SectionTitle>Support</SectionTitle>
        <Card style={styles.group}>
          <ListRow testID="account-messages-row" icon="chatbubbles-outline" title="SMS forwarding" onPress={() => router.push("/messages")} />
          <ListRow testID="account-privacy-row" icon="document-lock-outline" title="Privacy policy" onPress={() => openPublic("privacy")} />
          <ListRow testID="account-terms-row" icon="document-text-outline" title="Terms of use" onPress={() => openPublic("terms")} />
          <ListRow testID="account-support-row" icon="help-buoy-outline" title="Help & support" onPress={() => toast("Support contact will be added before launch", "info")} last />
        </Card>

        <Card style={[styles.group, { marginTop: spacing.xl }]}>
          <ListRow testID="account-signout-row" icon="log-out-outline" title="Sign out" danger onPress={logout} last right={<View />} />
        </Card>

        <Text style={styles.footer}>DutyConnect · Stay Connected. Stay Organised.{"\n"}Figures are estimates, not official payroll records.</Text>
      </ScrollView>
      <ExportSheet visible={exporting} onClose={() => setExporting(false)} shifts={shifts} label="All records" />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: spacing.lg },
  profile: { flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingVertical: spacing.sm },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: c.hero,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: fonts.bold, fontSize: type.xl, color: c.onHero },
  name: { fontFamily: fonts.bold, fontSize: type.xl, color: c.onSurface },
  email: { fontFamily: fonts.regular, fontSize: type.base, color: c.muted, marginTop: 2 },
  planPill: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    backgroundColor: c.brandTertiary,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  planText: { fontFamily: fonts.semibold, fontSize: type.sm, color: c.onBrandTertiary },
  group: { padding: 0, overflow: "hidden" },
  footer: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted, textAlign: "center", marginTop: spacing.xl, lineHeight: 18 },
}));
