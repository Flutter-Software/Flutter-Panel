import type { ReactNode } from "react";
import { AccountSettingsNav } from "./settings-nav";

export default function AccountSettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Account</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Settings</h1>
      </div>
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <AccountSettingsNav />
        {children}
      </div>
    </div>
  );
}
