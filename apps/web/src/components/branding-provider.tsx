"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { DEFAULT_CONSOLE_TAG, DEFAULT_SITE_NAME, normalizeConsoleTag } from "@flutter-software/shared";

export { DEFAULT_CONSOLE_TAG, DEFAULT_SITE_NAME };
export const DEFAULT_LOGO_SRC = "/flutter-logo.png";

export type Branding = {
  siteName: string;
  consoleTag: string;
  logoSrc: string;
  hasLogo: boolean;
};

type BrandingState = Branding & {
  reload: () => Promise<void>;
};

const BrandingContext = createContext<BrandingState | null>(null);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>({
    siteName: DEFAULT_SITE_NAME,
    consoleTag: DEFAULT_CONSOLE_TAG,
    logoSrc: DEFAULT_LOGO_SRC,
    hasLogo: false,
  });

  const reload = useCallback(async () => {
    try {
      const result = await api<{
        data: { siteName: string; consoleTag?: string; logoUrl: string | null; hasLogo?: boolean };
      }>("/api/v1/branding");
      setBranding({
        siteName: result.data.siteName?.trim() || DEFAULT_SITE_NAME,
        consoleTag: normalizeConsoleTag(result.data.consoleTag),
        logoSrc: result.data.logoUrl || DEFAULT_LOGO_SRC,
        hasLogo: Boolean(result.data.hasLogo),
      });
    } catch {
      setBranding({
        siteName: DEFAULT_SITE_NAME,
        consoleTag: DEFAULT_CONSOLE_TAG,
        logoSrc: DEFAULT_LOGO_SRC,
        hasLogo: false,
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    document.title = branding.siteName;
    for (const rel of ["icon", "apple-touch-icon"]) {
      let link = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement("link");
        link.rel = rel;
        document.head.appendChild(link);
      }
      link.href = branding.logoSrc;
    }
  }, [branding]);

  const value = useMemo(() => ({ ...branding, reload }), [branding, reload]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  const value = useContext(BrandingContext);
  if (!value) {
    return {
      siteName: DEFAULT_SITE_NAME,
      consoleTag: DEFAULT_CONSOLE_TAG,
      logoSrc: DEFAULT_LOGO_SRC,
      hasLogo: false,
      reload: async () => undefined,
    };
  }
  return value;
}
