import { FlatList, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { ShiftCard } from "@/src/components/shift-card";
import { StackHeader } from "@/src/components/stack-header";
import { useToast } from "@/src/components/toast";
import { Button } from "@/src/components/ui";
import { money } from "@/src/format";
import { DELETED_RETENTION_DAYS, deletedTime, useShifts } from "@/src/shifts/provider";
import { fonts, makeStyles, radius, spacing, type } from "@/src/theme";

export default function RecentlyDeleted() {
  const { user } = useAuth();
  const { deleted, restore } = useShifts();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const styles = useStyles();

  return (
    <View style={styles.root} testID="recently-deleted-screen">
      <StackHeader title="Recently deleted" />
      <FlatList
        data={deleted}
        keyExtractor={(s) => s.id}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListHeaderComponent={
          <Text style={styles.intro}>
            Deleted shifts and all their payments are kept here for {DELETED_RETENTION_DAYS} days and are not included in any totals. Restore one to bring it
            back exactly as it was.
          </Text>
        }
        ListEmptyComponent={
          <View style={styles.empty} testID="recently-deleted-empty">
            <Text style={styles.emptyText}>No recently deleted shifts.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const days = Math.max(0, DELETED_RETENTION_DAYS - Math.floor((Date.now() - deletedTime(item)) / 86_400_000));
          const paid = (item.payments ?? []).filter((p) => !p.deleted).length;
          return (
            <View style={styles.item} testID={`deleted-item-${item.id}`}>
              <ShiftCard shift={item} currency={user?.currency} />
              <Text style={styles.meta}>
                Deleted {new Date(deletedTime(item)).toLocaleDateString("en-GB")} · {days} day{days === 1 ? "" : "s"} left
                {paid ? ` · ${paid} payment${paid === 1 ? "" : "s"} (${money(item.amount_received ?? 0, user?.currency)}) kept` : ""}
              </Text>
              <Button
                testID={`deleted-restore-${item.id}`}
                label="Restore shift"
                icon="refresh-outline"
                variant="secondary"
                onPress={() => restore(item.id).then(() => toast("Shift restored with its payments"))}
              />
            </View>
          );
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: spacing.lg },
  intro: { fontFamily: fonts.regular, fontSize: type.base, color: c.onSurfaceSecondary, lineHeight: 21, marginBottom: spacing.lg },
  item: { gap: spacing.sm },
  meta: { fontFamily: fonts.medium, fontSize: type.sm, color: c.muted },
  empty: { padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: c.borderStrong },
  emptyText: { fontFamily: fonts.medium, fontSize: type.base, color: c.onSurfaceSecondary },
}));
