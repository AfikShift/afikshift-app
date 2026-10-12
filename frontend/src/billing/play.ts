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

export const FOUNDING_OFFER_ID = "founding";
export type Prices = Record<PlanKey, { price: string; intro?: string }>;

/** Prices and the founding offer exactly as Google Play returns them (nothing hard-coded). */
export async function loadPrices(foundingEligible: boolean): Promise<Prices | null> {
  const m = iap();
  if (!m) return null;
  try {
    const list = await m.fetchProducts({ skus: Object.values(PRODUCTS), type: "subs" });
    const one = (id: string) => {
      const p = list?.find((x: any) => x.id === id);
      if (!p) return null;
      const offers: any[] = p.subscriptionOfferDetailsAndroid ?? [];
      const founding = foundingEligible ? offers.find((o) => o.offerId === FOUNDING_OFFER_ID) : undefined;
      return { price: p.displayPrice, intro: founding?.pricingPhases?.pricingPhaseList?.[0]?.formattedPrice };
    };
    const monthly = one(PRODUCTS.monthly);
    const annual = one(PRODUCTS.annual);
    return monthly && annual ? { monthly, annual } : null;
  } catch {
    return null;
  }
}

/** The server decides founding eligibility (first 200 new paying subscribers); only then is the offer requested. */
export async function buy(plan: PlanKey, accountRef: string, foundingEligible: boolean) {
  const m = iap();
  if (!m) throw new Error("Subscriptions are available in the Google Play version of DutyConnect.");
  const sku = PRODUCTS[plan];
  const [prod] = await m.fetchProducts({ skus: [sku], type: "subs" });
  const offers: any[] = prod?.subscriptionOfferDetailsAndroid ?? [];
  const offer = (foundingEligible && offers.find((o) => o.offerId === FOUNDING_OFFER_ID)) || offers.find((o) => !o.offerId) || offers[0];
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
