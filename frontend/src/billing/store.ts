/** Which store this build is for. Set EXPO_PUBLIC_STORE=aptoide for the Aptoide APK; default is Google Play.
 *  Each build only ever uses its own store's billing (store policies forbid mixing). */
export const STORE: "play" | "aptoide" = process.env.EXPO_PUBLIC_STORE === "aptoide" ? "aptoide" : "play";
export const STORE_NAME = STORE === "aptoide" ? "Aptoide" : "Google Play";
