// Google Play Billing via expo-iap. Native only: Expo Go and the web preview cannot load the billing
// module, so purchases there report "unavailable" (everything else in the app keeps working).
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

import { request } from "@/src/api";
import { Entitlement } from "@/src/billing/entitlement";

export const PRODUCTS = { monthly: "dutyconnect_pro_monthly", annual: "dutyconnect_pro_annual" } as const;
export type PlanKey = keyof typeof PRODUCTS;

export const billingAvailable = Platform.OS === "android" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

function iap(): any {
  if (!billingAvailable) return null;
  try {
    return require("expo-iap");
  } catch {
    return null;
  }
}

let started = false;
/** Connect once and verify every purchase on the server BEFORE finishing it (Google refunds unacknowledged ones). */
export async function startBilling(onEntitlement: (e: Entitlement) => void, onError: (m: string) => void) {
  const m = iap();
  if (!m || started) return;
  started = true;
  await m.initConnection();
  m.purchaseUpdatedListener(async (p: any) => {
    try {
      const e = await request<Entitlement>("/billing/verify", { method: "POST", body: { product_id: p.productId ?? p.id, purchase_token: p.purchaseToken } });
      await m.finishTransaction({ purchase: p, isConsumable: false });
      onEntitlement(e);
    } catch (err) {
      onError((err as Error).message || "Purchase could not be verified. It will be retried.");
    }
  });
  m.purchaseErrorListener((e: any) => {
    if (e?.code !== m.ErrorCode?.UserCancelled) onError(e?.message ?? "Purchase failed");
  });
}

/** Localised prices from Google Play (fallback: approved launch prices). */
export async function loadPrices(): Promise<Record<PlanKey, string>> {
  const fallback = { monthly: "£2.99", annual: "£24.99" };
  const m = iap();
  if (!m) return fallback;
  try {
    const list = await m.fetchProducts({ skus: Object.values(PRODUCTS), type: "subs" });
    const price = (id: string) => list?.find((x: any) => x.id === id)?.displayPrice;
    return { monthly: price(PRODUCTS.monthly) ?? fallback.monthly, annual: price(PRODUCTS.annual) ?? fallback.annual };
  } catch {
    return fallback;
  }
}

export async function buy(plan: PlanKey, accountRef: string) {
  const m = iap();
  if (!m) throw new Error("Subscriptions are available in the Google Play version of DutyConnect.");
  const sku = PRODUCTS[plan];
  const [prod] = await m.fetchProducts({ skus: [sku], type: "subs" });
  const offer = prod?.subscriptionOfferDetailsAndroid?.[0];
  await m.requestPurchase({
    request: { google: { skus: [sku], obfuscatedAccountIdAndroid: accountRef, subscriptionOffers: offer ? [{ sku, offerToken: offer.offerToken }] : [] } },
    type: "subs",
  });
}

export async function restorePurchases(): Promise<Entitlement> {
  const m = iap();
  if (!m) return request<Entitlement>("/billing/entitlement");
  const owned = (await m.getAvailablePurchases()) ?? [];
  return request<Entitlement>("/billing/restore", {
    method: "POST",
    body: { purchases: owned.filter((p: any) => p.purchaseToken).map((p: any) => ({ product_id: p.productId ?? p.id, purchase_token: p.purchaseToken })) },
  });
}

export async function openManageSubscription(sku?: string) {
  const { Linking } = require("react-native");
  const pkg = Constants.expoConfig?.android?.package ?? "";
  await Linking.openURL(`https://play.google.com/store/account/subscriptions${sku ? `?sku=${sku}&package=${pkg}` : ""}`);
}
