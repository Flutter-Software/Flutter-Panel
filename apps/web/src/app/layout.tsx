import type { ReactNode } from "react";
import type { Viewport } from "next";
import localFont from "next/font/local";
import { ColorSchemeScript, mantineHtmlProps } from "@mantine/core";
import { ThemeProvider } from "@/components/theme-provider";
import { MotionProvider } from "@/components/motion-provider";
import { AuthProvider } from "@/components/auth-provider";
import { PanelSocketProvider } from "@/components/panel-socket";
import { BrandingProvider } from "@/components/branding-provider";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { ToastProvider } from "@/components/toast";
import { TelemetryErrors } from "@/components/telemetry-errors";
import { MOTION_BOOTSTRAP_SCRIPT } from "@/lib/motion";
import { POWER_LAYOUT_BOOTSTRAP_SCRIPT } from "@/lib/power-layout";
import "./globals.css";

/*
 * Type (see DESIGN.md):
 *  - Barlow Semi Condensed: display. Page titles, section titles, unit names.
 *    Condensed like the printed legends on server hardware.
 *  - IBM Plex Sans: body and UI. Legible over long sessions, tabular figures.
 *  - IBM Plex Mono: real machine text only (console, addresses, paths, code).
 *
 * Self-hosted from ../fonts (Latin subset WOFF2 from Fontsource, SIL OFL 1.1;
 * licenses sit next to the files). Deliberately not next/font/google: that
 * downloads from Google during `next build`, so every self-update on a
 * customer's server depended on Google's CSS. When Google served a font URL
 * without a file extension, Next's loader crashed
 * (`Cannot read properties of null (reading '1')`) and the update failed.
 * Local files make the build offline-safe and identical everywhere.
 *
 * To add a weight: copy `<family>-latin-<weight>-normal.woff2` from the
 * matching @fontsource package into ../fonts and add a `src` entry below.
 */
const barlow = localFont({
  src: [
    { path: "../fonts/barlow-semi-condensed-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/barlow-semi-condensed-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-barlow",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const plexSans = localFont({
  src: [
    { path: "../fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-sans",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const plexMono = localFont({
  src: [
    { path: "../fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
  // Arial-based metric matching would distort a monospace fallback.
  adjustFontFallback: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

export const metadata = {
  title: "Flutter",
  description:
    "Self-hosted game-server control panel. Flutter is the product name — not Google Flutter.",
  icons: {
    icon: "/flutter-logo.png",
    apple: "/flutter-logo.png",
  },
};

/**
 * `viewport-fit=cover` lets the panel use the full screen on notched phones;
 * globals.css and the sheets/toasts pad themselves with env(safe-area-inset-*).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${plexSans.variable} ${plexMono.variable} dark`}
      {...mantineHtmlProps}
      data-mantine-color-scheme="dark"
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOTSTRAP_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: POWER_LAYOUT_BOOTSTRAP_SCRIPT }} />
        <ColorSchemeScript defaultColorScheme="dark" />
      </head>
      <body className="bg-background font-sans text-foreground">
        <MotionProvider>
          <ThemeProvider>
            <BrandingProvider>
              <AuthProvider>
                <PanelSocketProvider>
                  <ConfirmProvider>
                    <ToastProvider>
                      <TelemetryErrors />
                      {children}
                    </ToastProvider>
                  </ConfirmProvider>
                </PanelSocketProvider>
              </AuthProvider>
            </BrandingProvider>
          </ThemeProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
