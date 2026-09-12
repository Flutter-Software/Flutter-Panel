import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(root, ".env") });

const API = (process.env.API_INTERNAL_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");
const DUMP_PATH = process.env.FLUTTER_PTERO_DUMP || "";
const LOGIN = process.env.FLUTTER_ADMIN_EMAIL || process.env.FLUTTER_ADMIN_USERNAME || "";
const PASSWORD = process.env.FLUTTER_ADMIN_PASSWORD || "";

const cookies = new Map();
let csrf = "";

function fail(message) {
  console.error(`[migrate-pterodactyl] ${message}`);
  process.exit(1);
}

function storeCookies(response) {
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const line of lines) {
    const pair = String(line).split(";", 1)[0];
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    cookies.set(name, value);
    if (name === "flutter_csrf") csrf = value;
  }
}

function cookieHeader() {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function api(method, path, body) {
  const headers = { cookie: cookieHeader() };
  if (csrf) headers["x-flutter-csrf"] = csrf;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${API}/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  storeCookies(response);
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const message = json?.error?.message || json?.message || text || `${response.status}`;
    throw new Error(`${method} ${path}: ${message}`);
  }
  return json;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clip(value, max) {
  return String(value ?? "").slice(0, max);
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || (text[0] !== "{" && text[0] !== "[")) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function firstDockerImage(dockerImages, fallback) {
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
  if (Array.isArray(dockerImages)) {
    const first = dockerImages.find((value) => typeof value === "string" && value.trim());
    return first ? first.trim() : "";
  }
  if (dockerImages && typeof dockerImages === "object") {
    for (const value of Object.values(dockerImages)) {
      if (typeof value === "string" && value.trim()) return value.trim();
      if (value && typeof value === "object" && typeof value.image === "string" && value.image.trim()) {
        return value.image.trim();
      }
    }
  }
  return "";
}

function eggPayload(egg, variables) {
  if (egg?.scripts && (egg.docker_image || egg.docker_images || egg.startup)) {
    return egg;
  }
  const dockerImages = parseMaybeJson(egg.docker_images);
  const configStop = parseMaybeJson(egg.config_stop || egg.stop || "stop");
  return {
    id: egg.id,
    uuid: egg.uuid,
    nest_id: egg.nest_id,
    name: egg.name || "Imported egg",
    description: egg.description || "",
    docker_image: firstDockerImage(dockerImages, egg.docker_image || egg.image || ""),
    docker_images: dockerImages,
    startup: egg.startup || "",
    config: egg.config && typeof egg.config === "object" ? egg.config : { stop: configStop },
    scripts: {
      installation: {
        script: egg.script_install || egg.scripts?.installation?.script || "",
        container: egg.script_container || egg.scripts?.installation?.container || "alpine:3.20",
      },
    },
    variables: variables.map((variable) => ({
      name: variable.name || "",
      description: variable.description || "",
      env_variable: variable.env_variable || variable.env || "",
      default_value: variable.default_value ?? "",
    })),
    requiresAllocation: true,
  };
}

function normalizeDump(dump) {
  const eggVariables = Array.isArray(dump.egg_variables) ? dump.egg_variables : [];
  const varsByEgg = new Map();
  for (const variable of eggVariables) {
    const list = varsByEgg.get(variable.egg_id) || [];
    list.push(variable);
    varsByEgg.set(variable.egg_id, list);
  }

  const varById = new Map(eggVariables.map((variable) => [variable.id, variable]));
  const envByServer = new Map();
  for (const row of dump.server_variables || []) {
    const variable = varById.get(row.variable_id) || {};
    const key = String(variable.env_variable || variable.env || "").trim();
    if (!key) continue;
    const env = envByServer.get(row.server_id) || {};
    env[key] = String(row.variable_value ?? "");
    envByServer.set(row.server_id, env);
  }

  return {
    ...dump,
    eggs: (dump.eggs || []).map((egg) => eggPayload(egg, varsByEgg.get(egg.id) || [])),
    servers: (dump.servers || []).map((server) => ({
      ...server,
      environment:
        server.environment && typeof server.environment === "object"
          ? server.environment
          : envByServer.get(server.id) || {},
    })),
    allocations: (dump.allocations || []).map((allocation) => ({
      ...allocation,
      alias: allocation.alias || allocation.ip_alias || "",
    })),
  };
}

async function waitForNode() {
  for (let i = 0; i < 60; i += 1) {
    const payload = await api("GET", "/admin/nodes");
    const nodes = payload?.data?.nodes ?? [];
    const local = nodes.find((node) => node.name === "Local") ?? nodes[0];
    if (local?.online && local?.id) return local;
    await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
  }
  fail("Local node daemon did not come online");
}

function localNodeIds(dump) {
  const uuid = String(dump.localNodeUuid || "").toLowerCase();
  const nodes = Array.isArray(dump.nodes) ? dump.nodes : [];
  if (!uuid) {
    console.error("[migrate-pterodactyl] no local Wings UUID; importing every server onto this node");
    return nodes.map((node) => node.id);
  }
  const matched = nodes.filter((node) => String(node.uuid || "").toLowerCase() === uuid).map((node) => node.id);
  if (!matched.length) {
    console.error("[migrate-pterodactyl] Wings UUID did not match a panel node; importing every server onto this node");
    return nodes.map((node) => node.id);
  }
  return matched;
}

async function main() {
  if (!DUMP_PATH) fail("FLUTTER_PTERO_DUMP is required");
  if (!LOGIN || !PASSWORD) fail("admin login and password are required");

  const dump = normalizeDump(JSON.parse(await readFile(DUMP_PATH, "utf8")));
  await api("GET", "/health");
  await api("POST", "/auth/login", { login: LOGIN, password: PASSWORD });
  if (!csrf) {
    await api("GET", "/auth/setup");
  }
  if (!cookies.get("flutter_session")) fail("login did not establish a session");

  const node = await waitForNode();
  const allowedNodeIds = new Set(localNodeIds(dump));
  const nestIdByLegacy = new Map();
  const eggIdByLegacy = new Map();
  const allocationIdByLegacy = new Map();

  let nestsImported = 0;
  let eggsImported = 0;
  let serversCreated = 0;
  let skippedRemote = 0;
  const errors = [];

  const existingNests = (await api("GET", "/admin/nests"))?.data?.nests ?? [];
  const nestByName = new Map(existingNests.map((nest) => [String(nest.name).toLowerCase(), nest]));

  for (const nest of dump.nests ?? []) {
    const name = clip(nest.name || "Imported", 64) || "Imported";
    const key = name.toLowerCase();
    let row = nestByName.get(key);
    if (!row) {
      const created = await api("POST", "/admin/nests", {
        name,
        description: clip(nest.description || "Imported from Pterodactyl/Pelican", 240),
      });
      row = created?.data?.nest;
      if (row) nestByName.set(key, row);
      nestsImported += 1;
    }
    if (row?.id != null && nest.id != null) nestIdByLegacy.set(nest.id, row.id);
  }

  const fallbackNest =
    nestByName.get("imported") ||
    [...nestByName.values()][0] ||
    (await api("POST", "/admin/nests", { name: "Imported", description: "Imported from Pterodactyl/Pelican" }))?.data
      ?.nest;

  for (const egg of dump.eggs ?? []) {
    const nestId = nestIdByLegacy.get(egg.nest_id) || fallbackNest?.id;
    if (!nestId) {
      errors.push(`egg ${egg.name || egg.id}: missing nest`);
      continue;
    }
    try {
      const created = await api("POST", "/admin/eggs/import", { nestId, egg });
      const row = created?.data?.egg;
      if (row?.id != null && egg.id != null) eggIdByLegacy.set(egg.id, row.id);
      eggsImported += 1;
    } catch (error) {
      errors.push(`egg ${egg.name || egg.id}: ${error instanceof Error ? error.message : error}`);
    }
  }

  const allocationByKey = new Map();
  for (const allocation of node.allocations ?? []) {
    allocationByKey.set(`${allocation.ip}:${allocation.port}`, allocation);
  }

  const createAllocation = async (ip, port, alias = "", notes = "") => {
    const key = `${ip}:${port}`;
    if (allocationByKey.has(key)) return allocationByKey.get(key);
    const created = await api("POST", `/admin/nodes/${node.id}/allocations`, {
      ip,
      alias,
      ports: String(port),
      notes,
    });
    const rows = created?.data?.allocations ?? [];
    const row = rows.find((item) => Number(item.port) === Number(port)) || rows[0];
    if (row) allocationByKey.set(key, row);
    return row;
  };

  const allocById = new Map((dump.allocations ?? []).map((row) => [row.id, row]));

  for (const server of dump.servers ?? []) {
    if (allowedNodeIds.size && server.node_id != null && !allowedNodeIds.has(server.node_id)) {
      skippedRemote += 1;
      continue;
    }
    const eggId = eggIdByLegacy.get(server.egg_id);
    if (!eggId) {
      errors.push(`server ${server.name}: egg was not imported`);
      continue;
    }
    const legacyAlloc = allocById.get(server.allocation_id);
    let allocation = null;
    if (legacyAlloc?.port) {
      const ip = !legacyAlloc.ip || legacyAlloc.ip === "127.0.0.1" ? "0.0.0.0" : String(legacyAlloc.ip);
      try {
        allocation = await createAllocation(ip, Number(legacyAlloc.port), legacyAlloc.alias || "", "Imported");
        if (allocation?.id && legacyAlloc.id != null) allocationIdByLegacy.set(legacyAlloc.id, allocation.id);
      } catch (error) {
        errors.push(`allocation ${legacyAlloc.ip}:${legacyAlloc.port}: ${error instanceof Error ? error.message : error}`);
      }
    }

    const environment = asRecord(server.environment);
    const body = {
      name: clip(server.name || `server-${server.id}`, 64),
      description: clip(server.description || "", 240),
      eggId,
      nodeId: node.id,
      memoryMb: Math.max(0, Number(server.memory) || 0),
      diskMb: Math.max(0, Number(server.disk) || 0),
      cpuPercent: Math.max(0, Math.min(800, Number(server.cpu) || 100)),
      environment,
    };
    if (allocation?.id) body.allocationId = allocation.id;
    if (server.image) body.dockerImage = String(server.image).slice(0, 255);
    if (server.startup) body.startup = String(server.startup).slice(0, 2000);

    try {
      await api("POST", "/admin/servers", body);
      serversCreated += 1;
    } catch (error) {
      errors.push(`server ${server.name}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(
    JSON.stringify({
      nestsImported,
      eggsImported,
      serversCreated,
      skippedRemote,
      errors,
    }),
  );
}

main().catch((error) => {
  console.error("[migrate-pterodactyl] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
