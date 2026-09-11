export type DeviceKind = "desktop" | "mobile" | "tablet" | "unknown";

export type ClientHints = {
  ua?: string | null;
  mobile?: string | null;
  platform?: string | null;
  platformVersion?: string | null;
  model?: string | null;
};

export type DeviceSummary = {
  label: string;
  device: string;
  browser: string;
  os: string;
  kind: DeviceKind;
};

export type HeaderReader = (name: string) => string | null | undefined;

const BRAND_RANK = [
  "Google Chrome",
  "Microsoft Edge",
  "Brave",
  "Opera",
  "Vivaldi",
  "Firefox",
  "Safari",
  "Samsung Internet",
  "Chromium",
];

function unquote(value: string | null | undefined) {
  return (value ?? "").trim().replace(/^"|"$/g, "").replace(/^\?/, "").trim();
}

function firstNumber(value: string) {
  const match = /(\d+)/.exec(value);
  return match ? Number(match[1]) : null;
}

export function clientHintsFrom(header: HeaderReader): ClientHints {
  const read = (name: string) => header(name) ?? header(name.toLowerCase()) ?? null;
  const platform = unquote(read("sec-ch-ua-platform"));
  const platformVersion = unquote(read("sec-ch-ua-platform-version"));
  const model = unquote(read("sec-ch-ua-model"));
  const ua = (read("sec-ch-ua") ?? "").trim();
  const mobile = unquote(read("sec-ch-ua-mobile"));
  return {
    ua: ua || null,
    mobile: mobile || null,
    platform: platform || null,
    platformVersion: platformVersion || null,
    model: model && model !== "K" ? model : null,
  };
}

export function hasClientHints(hints: ClientHints | null | undefined) {
  if (!hints) return false;
  return Boolean(hints.ua || hints.mobile || hints.platform || hints.platformVersion || hints.model);
}

function brandFromHints(uaHint: string | null | undefined) {
  if (!uaHint) return null;
  const brands: string[] = [];
  for (const match of uaHint.matchAll(/"([^"]+)"/g)) {
    const brand = match[1]?.trim();
    if (!brand || /^not[_ ]a[_ ]brand$/i.test(brand)) continue;
    brands.push(brand);
  }
  if (!brands.length) return null;
  for (const preferred of BRAND_RANK) {
    const hit = brands.find((brand) => brand.toLowerCase() === preferred.toLowerCase());
    if (hit) return hit === "Google Chrome" ? "Chrome" : hit === "Microsoft Edge" ? "Edge" : hit;
  }
  return brands[0] ?? null;
}

function browserFromUa(ua: string) {
  if (/EdgA?\/|EdgiOS\//i.test(ua)) return "Edge";
  if (/OPR\/|Opera/i.test(ua)) return "Opera";
  if (/SamsungBrowser\//i.test(ua)) return "Samsung Internet";
  if (/FxiOS\/|Firefox\//i.test(ua)) return "Firefox";
  if (/CriOS\//i.test(ua) || (/Chrome\//i.test(ua) && !/Chromium/i.test(ua))) return "Chrome";
  if (/Safari\//i.test(ua) && !/Chrome|Chromium|Android/i.test(ua)) return "Safari";
  if (/Chromium/i.test(ua)) return "Chromium";
  return null;
}

function androidModelFromUa(ua: string) {
  const match = /Android [^;)]*;\s*([^;)]+?)(?:\s+Build\/|; wv|; Mobile|\)|$)/i.exec(ua);
  const model = match?.[1]?.trim();
  if (!model) return null;
  if (/^(?:K|Mobile|Tablet|wv|U|en-us|en-US)$/i.test(model)) return null;
  return model.replace(/\s+/g, " ");
}

function osFromHints(hints: ClientHints | null | undefined, ua: string) {
  const platform = hints?.platform?.toLowerCase() ?? "";
  const version = hints?.platformVersion ?? "";
  const major = firstNumber(version);
  if (platform.includes("win")) {
    return major != null && major >= 13 ? "Windows 11" : major != null && major > 0 ? "Windows 10" : osFromUa(ua);
  }
  if (platform.includes("mac") || platform.includes("macos")) {
    return major ? `macOS ${major}` : "macOS";
  }
  if (platform.includes("android")) return major ? `Android ${major}` : osFromUa(ua);
  if (platform.includes("ios") || platform.includes("iphone") || platform.includes("ipad")) {
    return major ? `iOS ${major}` : osFromUa(ua);
  }
  if (platform.includes("cros") || platform.includes("chrome os")) return "Chrome OS";
  if (platform.includes("linux")) return "Linux";
  return osFromUa(ua);
}

function osFromUa(ua: string) {
  if (/Windows NT 10\.0/i.test(ua)) return "Windows";
  if (/Windows NT 6\.3/i.test(ua)) return "Windows 8.1";
  if (/Windows NT 6\.2/i.test(ua)) return "Windows 8";
  if (/Windows NT 6\.1/i.test(ua)) return "Windows 7";
  if (/Windows NT 6\.0/i.test(ua)) return "Windows Vista";
  if (/Windows NT 5\.1/i.test(ua)) return "Windows XP";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  const android = /Android (\d+)/i.exec(ua);
  if (android) return `Android ${android[1]}`;
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) {
    const ios = /OS (\d+)/i.exec(ua);
    return ios ? `iOS ${ios[1]}` : "iOS";
  }
  if (/CrOS/i.test(ua)) return "Chrome OS";
  if (/Linux/i.test(ua)) return "Linux";
  return "";
}

function kindFrom(ua: string, hints: ClientHints | null | undefined): DeviceKind {
  if (hints?.mobile === "1") return /iPad|Tablet|Android(?!.*Mobile)/i.test(ua) ? "tablet" : "mobile";
  if (/iPad/i.test(ua) || /Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
  if (/iPhone|iPod/i.test(ua) || /Mobile/i.test(ua) || /Android/i.test(ua)) return "mobile";
  if (ua || hints?.platform) return "desktop";
  return "unknown";
}

function deviceName(ua: string, hints: ClientHints | null | undefined, os: string, kind: DeviceKind) {
  const model = hints?.model?.trim();
  if (model) return model;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/iPod/i.test(ua)) return "iPod";
  const android = androidModelFromUa(ua);
  if (android) return android;
  if (/CrOS/i.test(ua) || /chrome os/i.test(hints?.platform ?? "")) return "Chromebook";
  if (kind === "tablet" && /Android/i.test(os)) return "Android tablet";
  if (kind === "mobile" && /Android/i.test(os)) return "Android phone";
  if (/Windows/i.test(os)) return "Windows PC";
  if (/macOS/i.test(os)) return "Mac";
  if (/Linux/i.test(os)) return "Linux PC";
  if (os) return os;
  return "Unknown device";
}

function placeName(device: string, os: string) {
  const generic = new Set([
    "Windows PC",
    "Mac",
    "Linux PC",
    "Android phone",
    "Android tablet",
    "Chromebook",
    "Unknown device",
  ]);
  if (device && !generic.has(device)) return device;
  if (os) return os;
  return device || "Unknown device";
}

export function describeDevice(userAgent?: string | null, hints?: ClientHints | null): DeviceSummary {
  const ua = userAgent ?? "";
  const browser = brandFromHints(hints?.ua) || browserFromUa(ua) || "Unknown browser";
  const os = osFromHints(hints, ua);
  const kind = kindFrom(ua, hints);
  const device = deviceName(ua, hints, os, kind);
  const place = placeName(device, os);
  const label =
    browser === "Unknown browser"
      ? place
      : place === "Unknown device"
        ? browser
        : `${browser} on ${place}`;
  return { label, device, browser, os: os || place, kind };
}

/** One-line description for emails and logs. */
export function describeUserAgent(userAgent?: string, hints?: ClientHints | null) {
  return describeDevice(userAgent, hints).label;
}
