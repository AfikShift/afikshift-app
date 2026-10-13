// AfikShift design tokens. Keys match the "color" block of /app/design_guidelines.json.
// Light + dark themes; the device setting decides.
import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FFFFFF",
  onSurface: "#111827",
  surfaceSecondary: "#F4F5F7",
  onSurfaceSecondary: "#374151",
  surfaceTertiary: "#E5E7EB",
  onSurfaceTertiary: "#4B5563",
  surfaceInverse: "#0A192F",
  onSurfaceInverse: "#FFFFFF",
  muted: "#6B7280",

  brand: "#0A192F",
  onBrand: "#FFFFFF",
  brandPrimary: "#0A192F",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#008080",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#E0F2F2",
  onBrandTertiary: "#004D4D",

  // Hero card (navy in both schemes)
  hero: "#0A192F",
  onHero: "#FFFFFF",
  onHeroMuted: "#9FB3C8",
  heroAccent: "#2DD4BF",

  dutyBed: "#008080",
  dutyBedSoft: "#E0F2F2",
  dutyConstant: "#0A192F",
  dutyConstantSoft: "#E3E8F0",
  dutyOther: "#6B7280",
  dutyOtherSoft: "#EEF0F3",
  night: "#4F46E5",
  day: "#D97706",

  success: "#0E9F6E",
  onSuccess: "#FFFFFF",
  successSoft: "#E3F7EF",
  warning: "#B45309",
  onWarning: "#FFFFFF",
  warningSoft: "#FEF3E2",
  error: "#DC2626",
  onError: "#FFFFFF",
  errorSoft: "#FDECEC",
  info: "#008080",
  onInfo: "#FFFFFF",

  border: "#E5E7EB",
  borderStrong: "#D1D5DB",
  divider: "#F3F4F6",
};

export type ThemeColors = typeof light;

const dark: ThemeColors = {
  surface: "#0A111F",
  onSurface: "#F3F4F6",
  surfaceSecondary: "#121C2E",
  onSurfaceSecondary: "#D1D5DB",
  surfaceTertiary: "#1C2840",
  onSurfaceTertiary: "#AEB6C4",
  surfaceInverse: "#F3F4F6",
  onSurfaceInverse: "#0A111F",
  muted: "#8B95A7",

  brand: "#14B8A6",
  onBrand: "#04201D",
  brandPrimary: "#14B8A6",
  onBrandPrimary: "#04201D",
  brandSecondary: "#2DD4BF",
  onBrandSecondary: "#04201D",
  brandTertiary: "#0F2E33",
  onBrandTertiary: "#7FE3D6",

  hero: "#13233D",
  onHero: "#FFFFFF",
  onHeroMuted: "#9FB3C8",
  heroAccent: "#2DD4BF",

  dutyBed: "#2DD4BF",
  dutyBedSoft: "#0F2E33",
  dutyConstant: "#7BA7E0",
  dutyConstantSoft: "#16243B",
  dutyOther: "#9CA3AF",
  dutyOtherSoft: "#1E2635",
  night: "#A5B4FC",
  day: "#FBBF24",

  success: "#34D399",
  onSuccess: "#05261A",
  successSoft: "#0F2A22",
  warning: "#FBBF24",
  onWarning: "#2A1B02",
  warningSoft: "#2E2410",
  error: "#F87171",
  onError: "#2A0505",
  errorSoft: "#341616",
  info: "#2DD4BF",
  onInfo: "#04201D",

  border: "#1F2A40",
  borderStrong: "#2D3B57",
  divider: "#18233A",
};

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light, dark };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const fonts = {
  regular: "PJS-Regular",
  medium: "PJS-Medium",
  semibold: "PJS-SemiBold",
  bold: "PJS-Bold",
  extrabold: "PJS-ExtraBold",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };
export const type = { sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, display: 32 };
