import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { ColorSchemeScript, mantineHtmlProps } from "@mantine/core";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth-provider";
import { BrandingProvider } from "@/components/branding-provider";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
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

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark`}
      {...mantineHtmlProps}
      data-mantine-color-scheme="dark"
    >
      <head>
        <ColorSchemeScript defaultColorScheme="dark" />
      </head>
      <body className="bg-background font-sans text-foreground">
        <ThemeProvider>
          <BrandingProvider>
            <AuthProvider>{children}</AuthProvider>
          </BrandingProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
