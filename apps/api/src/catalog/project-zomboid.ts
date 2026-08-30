import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Seeded Project Zomboid dedicated-server egg (Steam app 380870). */

export const PROJECT_ZOMBOID_NEST = {
  name: "Project Zomboid",
  description: "The Indie Stone dedicated server (SteamCMD).",
};

const installScript = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "project-zomboid-install.sh"),
  "utf8",
);

export const PROJECT_ZOMBOID_EGG = {
  name: "Dedicated",
  description:
    "SteamCMD dedicated server. Primary allocation is DefaultPort (UDP 16261); add UDPPort (16262) as an extra allocation. Give the JVM 4-8 GB.",
  dockerImage: "ghcr.io/parkervcp/steamcmd:debian",
  startup: "bash ./zomboid-start.sh",
  stopCommand: "quit",
  installImage: "ghcr.io/parkervcp/installers:debian",
  installScript,
  variables: [
    { key: "SERVER_NAME", default: "Flutter", description: "Internal world / config name (no spaces)" },
    { key: "PUBLIC_NAME", default: "Flutter Zomboid", description: "Name shown in the server browser" },
    { key: "ADMIN_USER", default: "admin", description: "In-game admin username" },
    { key: "ADMIN_PASSWORD", default: "changeme", description: "In-game admin password. Change this before going public." },
    { key: "SERVER_PASSWORD", default: "", description: "Join password (empty = public)" },
    {
      key: "STEAM_PORT",
      default: "",
      description: "UDPPort. Empty uses the first extra allocation, or query port + 1",
    },
    { key: "MAX_PLAYERS", default: "16", description: "Max players (needs extra UDP ports above UDPPort)" },
    { key: "WORKSHOP_ITEMS", default: "", description: "Comma-separated Steam Workshop IDs" },
    { key: "MODS", default: "", description: "Comma-separated mod IDs from those workshop items" },
    { key: "SRCDS_APPID", default: "380870", description: "Steam dedicated-server app ID" },
    { key: "SRCDS_BETAID", default: "", description: "Steam beta branch (blank = default). Reinstall after change" },
    { key: "AUTO_UPDATE", default: "0", description: "Set to 1 to run SteamCMD before each start" },
  ],
};
