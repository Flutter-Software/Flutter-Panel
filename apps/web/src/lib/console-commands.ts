import type { ServerRecord } from "@/lib/types";

export type ConsoleCommand = {
  command: string;
  description: string;
};

const MINECRAFT = [
  { command: "help", description: "List commands" },
  { command: "list", description: "Online players" },
  { command: "say", description: "Broadcast a message" },
  { command: "me", description: "Emote in chat" },
  { command: "msg", description: "Private message a player" },
  { command: "kick", description: "Kick a player" },
  { command: "ban", description: "Ban a player" },
  { command: "ban-ip", description: "Ban an IP" },
  { command: "pardon", description: "Unban a player" },
  { command: "pardon-ip", description: "Unban an IP" },
  { command: "op", description: "Grant operator" },
  { command: "deop", description: "Revoke operator" },
  { command: "whitelist", description: "Manage the whitelist" },
  { command: "whitelist add", description: "Add a player" },
  { command: "whitelist remove", description: "Remove a player" },
  { command: "whitelist list", description: "Show the whitelist" },
  { command: "whitelist on", description: "Enable the whitelist" },
  { command: "whitelist off", description: "Disable the whitelist" },
  { command: "whitelist reload", description: "Reload whitelist.json" },
  { command: "save-all", description: "Write the world to disk" },
  { command: "save-off", description: "Disable autosave" },
  { command: "save-on", description: "Enable autosave" },
  { command: "stop", description: "Stop the server" },
  { command: "reload", description: "Reload datapacks" },
  { command: "gamemode", description: "Set a player's gamemode" },
  { command: "defaultgamemode", description: "Default gamemode for new players" },
  { command: "difficulty", description: "Set difficulty" },
  { command: "time set", description: "Set world time" },
  { command: "time query", description: "Query world time" },
  { command: "weather", description: "Set weather" },
  { command: "xp", description: "Give experience" },
  { command: "give", description: "Give an item" },
  { command: "tp", description: "Teleport" },
  { command: "kill", description: "Kill a player or entity" },
  { command: "clear", description: "Clear inventory" },
  { command: "effect", description: "Give or clear effects" },
  { command: "enchant", description: "Enchant a held item" },
  { command: "gamerule", description: "Set a gamerule" },
  { command: "seed", description: "Show the world seed" },
  { command: "setworldspawn", description: "Set world spawn" },
  { command: "spawnpoint", description: "Set a player spawn" },
  { command: "worldborder", description: "World border" },
] as const satisfies ConsoleCommand[];

const PAPER = [
  { command: "plugins", description: "List plugins" },
  { command: "version", description: "Server and plugin versions" },
  { command: "paper", description: "Paper commands" },
  { command: "spigot", description: "Spigot commands" },
  { command: "bukkit", description: "Bukkit commands" },
  { command: "timings", description: "Timings reports" },
] as const satisfies ConsoleCommand[];

const ZOMBOID = [
  { command: "help", description: "List commands" },
  { command: "players", description: "Online players" },
  { command: "servermsg", description: "Broadcast a message" },
  { command: "save", description: "Save the world" },
  { command: "quit", description: "Stop the server" },
  { command: "kickuser", description: "Kick a player" },
  { command: "banuser", description: "Ban a player" },
  { command: "unbanuser", description: "Unban a player" },
  { command: "adduser", description: "Create a user" },
  { command: "grantadmin", description: "Grant admin" },
  { command: "removeadmin", description: "Revoke admin" },
  { command: "setaccesslevel", description: "Set access level" },
  { command: "addusertowhitelist", description: "Whitelist a player" },
  { command: "removeuserfromwhitelist", description: "Remove from whitelist" },
  { command: "addalltowhitelist", description: "Whitelist everyone online" },
  { command: "showoptions", description: "Show server options" },
  { command: "changeoption", description: "Change a server option" },
  { command: "reloadoptions", description: "Reload options" },
  { command: "godmode", description: "Toggle god mode" },
  { command: "invisible", description: "Toggle invisibility" },
  { command: "noclip", description: "Toggle noclip" },
  { command: "teleport", description: "Teleport a player" },
  { command: "teleportto", description: "Teleport to coordinates" },
  { command: "createhorde", description: "Spawn a horde" },
  { command: "startrain", description: "Start rain" },
  { command: "stoprain", description: "Stop rain" },
] as const satisfies ConsoleCommand[];

const VALHEIM = [
  { command: "help", description: "List commands" },
  { command: "info", description: "Server info" },
  { command: "kick", description: "Kick a player" },
  { command: "ban", description: "Ban a player" },
  { command: "unban", description: "Unban a player" },
  { command: "banned", description: "List bans" },
  { command: "save", description: "Save the world" },
  { command: "shutdown", description: "Stop the server" },
] as const satisfies ConsoleCommand[];

const PALWORLD = [
  { command: "ShowPlayers", description: "Online players" },
  { command: "Info", description: "Server info" },
  { command: "Broadcast", description: "Broadcast a message" },
  { command: "KickPlayer", description: "Kick a player" },
  { command: "BanPlayer", description: "Ban a player" },
  { command: "TeleportToPlayer", description: "Teleport to a player" },
  { command: "Save", description: "Save the world" },
  { command: "Shutdown", description: "Stop after a delay" },
  { command: "DoExit", description: "Stop immediately" },
] as const satisfies ConsoleCommand[];

const RUST = [
  { command: "status", description: "Online players" },
  { command: "say", description: "Broadcast a message" },
  { command: "kick", description: "Kick a player" },
  { command: "ban", description: "Ban a player" },
  { command: "unban", description: "Unban a player" },
  { command: "ownerid", description: "Grant owner" },
  { command: "moderatorid", description: "Grant moderator" },
  { command: "removeowner", description: "Revoke owner" },
  { command: "removemoderator", description: "Revoke moderator" },
  { command: "save", description: "Save the world" },
  { command: "server.writecfg", description: "Write config" },
  { command: "quit", description: "Stop the server" },
  { command: "restart", description: "Restart the server" },
] as const satisfies ConsoleCommand[];

const ARK = [
  { command: "ListPlayers", description: "Online players" },
  { command: "Broadcast", description: "Broadcast a message" },
  { command: "KickPlayer", description: "Kick a player" },
  { command: "BanPlayer", description: "Ban a player" },
  { command: "UnbanPlayer", description: "Unban a player" },
  { command: "SetMessageOfTheDay", description: "Set MOTD" },
  { command: "DestroyWildDinos", description: "Wipe wild dinos" },
  { command: "saveworld", description: "Save the world" },
  { command: "DoExit", description: "Stop the server" },
] as const satisfies ConsoleCommand[];

const TERRARIA = [
  { command: "help", description: "List commands" },
  { command: "playing", description: "Online players" },
  { command: "say", description: "Broadcast a message" },
  { command: "kick", description: "Kick a player" },
  { command: "ban", description: "Ban a player" },
  { command: "password", description: "Set join password" },
  { command: "version", description: "Server version" },
  { command: "maxplayers", description: "Player cap" },
  { command: "motd", description: "Message of the day" },
  { command: "save", description: "Save the world" },
  { command: "settle", description: "Settle liquids" },
  { command: "time", description: "Show time" },
  { command: "dawn", description: "Set dawn" },
  { command: "noon", description: "Set noon" },
  { command: "dusk", description: "Set dusk" },
  { command: "midnight", description: "Set midnight" },
  { command: "exit", description: "Save and stop" },
  { command: "exit-nosave", description: "Stop without saving" },
] as const satisfies ConsoleCommand[];

const SOURCE = [
  { command: "status", description: "Online players" },
  { command: "users", description: "Userids" },
  { command: "say", description: "Broadcast a message" },
  { command: "kick", description: "Kick a player" },
  { command: "banid", description: "Ban a Steam ID" },
  { command: "map", description: "Change map" },
  { command: "changelevel", description: "Change level" },
  { command: "mp_restartgame", description: "Restart the round" },
  { command: "mp_warmup_end", description: "End warmup" },
  { command: "bot_kick", description: "Kick bots" },
  { command: "stats", description: "Server stats" },
  { command: "heartbeat", description: "Force a master-server ping" },
  { command: "_restart", description: "Restart the process" },
  { command: "quit", description: "Stop the server" },
] as const satisfies ConsoleCommand[];

const FIVEM = [
  { command: "status", description: "Online players" },
  { command: "say", description: "Broadcast a message" },
  { command: "ensure", description: "Start or restart a resource" },
  { command: "start", description: "Start a resource" },
  { command: "stop", description: "Stop a resource" },
  { command: "restart", description: "Restart a resource" },
  { command: "refresh", description: "Refresh resources" },
  { command: "clientkick", description: "Kick a player" },
  { command: "quit", description: "Stop the server" },
] as const satisfies ConsoleCommand[];

function haystack(server: Pick<ServerRecord, "egg" | "dockerImage" | "startup">) {
  return `${server.egg} ${server.dockerImage ?? ""} ${server.startup ?? ""}`.toLowerCase();
}

function has(hay: string, ...needles: string[]) {
  return needles.some((needle) => {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(hay);
  });
}

function merge(lists: readonly ConsoleCommand[][]) {
  const seen = new Set<string>();
  const out: ConsoleCommand[] = [];
  for (const list of lists) {
    for (const item of list) {
      const key = item.command.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export function commandsForServer(server: Pick<ServerRecord, "egg" | "dockerImage" | "startup" | "stopCommand">) {
  const hay = haystack(server);
  const lists: ConsoleCommand[][] = [];

  const paper = has(hay, "paper", "papermc", "spigot", "purpur", "bukkit", "folia", "pufferfish");
  const minecraft = paper || has(hay, "minecraft", "fabric", "forge", "neoforge", "quilt", "mohist", "arclight", "itzg/minecraft");
  if (paper) lists.push([...PAPER]);
  if (minecraft) lists.push([...MINECRAFT]);
  else if (has(hay, "zomboid", "projectzomboid")) lists.push([...ZOMBOID]);
  else if (has(hay, "valheim")) lists.push([...VALHEIM]);
  else if (has(hay, "palworld")) lists.push([...PALWORLD]);
  else if (has(hay, "rust", "oxide")) lists.push([...RUST]);
  else if (has(hay, "ark", "asa", "arkse")) lists.push([...ARK]);
  else if (has(hay, "terraria", "tshock")) lists.push([...TERRARIA]);
  else if (has(hay, "fivem", "fxserver", "citizenfx", "txadmin")) lists.push([...FIVEM]);
  else if (has(hay, "cs2", "csgo", "gmod", "garrysmod", "tf2", "l4d", "l4d2", "srcds", "insurgency", "dods")) {
    lists.push([...SOURCE]);
  }

  const stop = server.stopCommand?.trim();
  if (stop) lists.push([{ command: stop, description: "Stop the server" }]);
  return merge(lists);
}

export function filterConsoleCommands(commands: ConsoleCommand[], query: string, limit = 8) {
  const raw = query.replace(/^\s+/, "");
  const q = raw.replace(/^\/+/, "").toLowerCase();
  if (!q) return commands.slice(0, limit);
  const ranked: { item: ConsoleCommand; rank: number }[] = [];
  for (const item of commands) {
    const cmd = item.command.toLowerCase();
    if (cmd === q) continue;
    if (cmd.startsWith(q)) ranked.push({ item, rank: 0 });
    else if (cmd.split(/\s+/).some((token) => token.startsWith(q))) ranked.push({ item, rank: 1 });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.item.command.localeCompare(b.item.command));
  return ranked.slice(0, limit).map((row) => row.item);
}

export function completeConsoleCommand(current: string, suggestion: string) {
  const leading = current.match(/^\s*/)?.[0] ?? "";
  const usedSlash = /^\s*\//.test(current);
  const body = usedSlash && !suggestion.startsWith("/") ? `/${suggestion}` : suggestion;
  const standalone =
    /^(help|list|save-all|save-off|save-on|stop|quit|plugins|version|seed|players|status|save|playing|info|banned|DoExit|settle|dawn|noon|dusk|midnight|heartbeat|_restart|reloadoptions|showoptions)$/i.test(
      suggestion,
    );
  return `${leading}${body}${standalone ? "" : " "}`;
}
