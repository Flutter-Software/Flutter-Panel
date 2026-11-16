import type { ReactNode } from "react";
import { AccountSettingsNav } from "./settings-nav";

export default function AccountSettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <h1 className="text-[31px] font-semibold">Account settings</h1>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
        <AccountSettingsNav />
        {children}
      </div>
    </div>
  );
}
