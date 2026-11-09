export type PowerLayout = "standard" | "header";

export const POWER_LAYOUT_STORAGE_KEY = "flutter-power-layout";
export const POWER_LAYOUT_ATTR = "data-power-layout";

/** Runs before first paint so the saved layout applies without a flash of the other one. */
export const POWER_LAYOUT_BOOTSTRAP_SCRIPT = `(function(){try{document.documentElement.setAttribute("${POWER_LAYOUT_ATTR}",localStorage.getItem("${POWER_LAYOUT_STORAGE_KEY}")==="header"?"header":"standard");}catch(e){}})();`;
