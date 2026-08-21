import {
  FlutterError,
  eggCreateSchema,
  eggImportSchema,
  eggUpdateSchema,
  nestCreateSchema,
  nestUpdateSchema,
} from "@flutter-software/shared";
import { Egg, Nest, Server } from "./db/models";

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function assertObjectId(id: string, label: string) {
  if (!/^[a-fA-F0-9]{24}$/.test(id)) throw FlutterError.notFound(`${label} not found`);
}

async function serverCountsByEgg() {
  const servers = await Server.find({}, "eggId").lean();
  const counts = new Map<string, number>();
  for (const server of servers) {
    const eggId = String(server.eggId ?? "");
    if (!eggId) continue;
    counts.set(eggId, (counts.get(eggId) ?? 0) + 1);
  }
  return counts;
}

export function publicEgg(
  egg: {
    _id: { toString(): string };
    nestId: { toString(): string };
    name: string;
    description: string;
    dockerImage: string;
    startup: string;
    stopCommand: string;
    installScript: string;
    installImage: string;
    variables: unknown;
    createdAt: Date;
  },
  serverCount = 0,
) {
  return {
    id: egg._id.toString(),
    nestId: egg.nestId.toString(),
    name: egg.name,
    description: egg.description,
    dockerImage: egg.dockerImage,
    startup: egg.startup,
    stopCommand: egg.stopCommand,
    installScript: egg.installScript,
    installImage: egg.installImage,
    variables: Array.isArray(egg.variables)
      ? egg.variables.map((item) => {
          const variable = (item ?? {}) as Record<string, unknown>;
          return {
            key: asString(variable.key),
            default: asString(variable.default),
            description: asString(variable.description),
          };
        })
      : [],
    serverCount,
    createdAt: egg.createdAt,
  };
}

function publicNest(
  nest: { _id: { toString(): string }; name: string; description: string; createdAt: Date },
  eggs: ReturnType<typeof publicEgg>[],
) {
  return {
    id: nest._id.toString(),
    name: nest.name,
    description: nest.description,
    eggCount: eggs.length,
    eggs,
    createdAt: nest.createdAt,
  };
}

export async function listNests() {
  const [nests, eggs, counts] = await Promise.all([
    Nest.find().sort({ name: 1 }),
    Egg.find().sort({ name: 1 }),
    serverCountsByEgg(),
  ]);
  return nests.map((nest) => {
    const nestEggs = eggs
      .filter((egg) => egg.nestId.toString() === nest._id.toString())
      .map((egg) => publicEgg(egg, counts.get(egg._id.toString()) ?? 0));
    return publicNest(nest, nestEggs);
  });
}

export async function getNest(id: string) {
  assertObjectId(id, "Nest");
  const nest = await Nest.findById(id);
  if (!nest) throw FlutterError.notFound("Nest not found");
  const [eggs, counts] = await Promise.all([Egg.find({ nestId: nest._id }).sort({ name: 1 }), serverCountsByEgg()]);
  return publicNest(
    nest,
    eggs.map((egg) => publicEgg(egg, counts.get(egg._id.toString()) ?? 0)),
  );
}

export async function createNest(body: unknown) {
  const parsed = nestCreateSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid nest", parsed.error.flatten());
  }
  const row = await Nest.create({
    name: parsed.data.name,
    description: parsed.data.description ?? "",
  });
  return publicNest(row, []);
}

export async function updateNest(id: string, body: unknown) {
  assertObjectId(id, "Nest");
  const parsed = nestUpdateSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid nest", parsed.error.flatten());
  }
  const nest = await Nest.findById(id);
  if (!nest) throw FlutterError.notFound("Nest not found");
  if (parsed.data.name !== undefined) nest.name = parsed.data.name;
  if (parsed.data.description !== undefined) nest.description = parsed.data.description;
  await nest.save();
  return getNest(id);
}

export async function deleteNest(id: string) {
  assertObjectId(id, "Nest");
  const nest = await Nest.findById(id);
  if (!nest) throw FlutterError.notFound("Nest not found");
  const eggs = await Egg.find({ nestId: nest._id }, "_id");
  const eggIds = eggs.map((egg) => egg._id);
  const servers = eggIds.length ? await Server.countDocuments({ eggId: { $in: eggIds } }) : 0;
  if (servers > 0) {
    throw FlutterError.conflict("Move or delete servers using eggs in this nest first");
  }
  await Egg.deleteMany({ nestId: nest._id });
  await nest.deleteOne();
  return { ok: true };
}

export async function getEgg(id: string) {
  assertObjectId(id, "Egg");
  const egg = await Egg.findById(id);
  if (!egg) throw FlutterError.notFound("Egg not found");
  const serverCount = await Server.countDocuments({ eggId: egg._id });
  return publicEgg(egg, serverCount);
}

export async function createEgg(body: unknown) {
  const parsed = eggCreateSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid egg", parsed.error.flatten());
  }
  const nest = await Nest.findById(parsed.data.nestId);
  if (!nest) throw FlutterError.notFound("Nest not found");
  const row = await Egg.create(parsed.data);
  return publicEgg(row);
}

export async function updateEgg(id: string, body: unknown) {
  assertObjectId(id, "Egg");
  const parsed = eggUpdateSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid egg", parsed.error.flatten());
  }
  const egg = await Egg.findById(id);
  if (!egg) throw FlutterError.notFound("Egg not found");
  if (parsed.data.nestId) {
    const nest = await Nest.findById(parsed.data.nestId);
    if (!nest) throw FlutterError.notFound("Nest not found");
    egg.nestId = nest._id;
  }
  if (parsed.data.name !== undefined) egg.name = parsed.data.name;
  if (parsed.data.description !== undefined) egg.description = parsed.data.description;
  if (parsed.data.dockerImage !== undefined) egg.dockerImage = parsed.data.dockerImage;
  if (parsed.data.startup !== undefined) egg.startup = parsed.data.startup;
  if (parsed.data.stopCommand !== undefined) egg.stopCommand = parsed.data.stopCommand;
  if (parsed.data.installScript !== undefined) egg.installScript = parsed.data.installScript;
  if (parsed.data.installImage !== undefined) egg.installImage = parsed.data.installImage;
  if (parsed.data.variables !== undefined) {
    egg.variables = parsed.data.variables;
    egg.markModified("variables");
  }
  await egg.save();
  const serverCount = await Server.countDocuments({ eggId: egg._id });
  return publicEgg(egg, serverCount);
}

export async function deleteEgg(id: string) {
  assertObjectId(id, "Egg");
  const egg = await Egg.findById(id);
  if (!egg) throw FlutterError.notFound("Egg not found");
  const servers = await Server.countDocuments({ eggId: egg._id });
  if (servers > 0) {
    throw FlutterError.conflict("Move or delete servers using this egg first");
  }
  await egg.deleteOne();
  return { ok: true };
}

function unwrapImportedEgg(raw: Record<string, unknown>): Record<string, unknown> {
  const nested = raw.egg;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const egg = nested as Record<string, unknown>;
    if ("name" in egg || "docker_images" in egg || "docker_image" in egg || "startup" in egg) {
      return egg;
    }
  }
  return raw;
}

function pickDockerImage(raw: Record<string, unknown>): string {
  if (typeof raw.docker_image === "string" && raw.docker_image.trim()) {
    return raw.docker_image.trim();
  }
  if (typeof raw.image === "string" && raw.image.trim()) {
    return raw.image.trim();
  }
  const images = raw.docker_images;
  if (images && typeof images === "object" && !Array.isArray(images)) {
    const values = Object.values(images as Record<string, unknown>).filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    if (values[0]) return values[0].trim();
  }
  return "";
}

function pickStopFrom(stop: unknown): string {
  if (typeof stop === "string" && stop.trim()) return stop.trim();
  if (!stop || typeof stop !== "object") return "";
  const rec = stop as Record<string, unknown>;
  const type = String(rec.type ?? "").toLowerCase();
  const value = String(rec.value ?? rec.signal ?? rec.command ?? "").trim();
  if (!value) return "";
  if (type === "signal") {
    const name = value.toUpperCase().replace(/^SIG/, "");
    return `SIG${name}`;
  }
  return value;
}

function pickStopCommand(raw: Record<string, unknown>): string {
  const config = raw.config;
  if (typeof config === "string") {
    try {
      const parsed = JSON.parse(config) as Record<string, unknown>;
      const fromConfig = pickStopFrom(parsed.stop);
      if (fromConfig) return fromConfig;
    } catch {
      /* ignore malformed config JSON */
    }
  }
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const fromConfig = pickStopFrom((config as Record<string, unknown>).stop);
    if (fromConfig) return fromConfig;
  }
  return "stop";
}

function pickInstall(raw: Record<string, unknown>): { script: string; image: string } {
  const scripts = (raw.scripts ?? {}) as Record<string, unknown>;
  const installation = (scripts.installation ?? {}) as Record<string, unknown>;
  return {
    script: asString(installation.script),
    image: asString(installation.container, "alpine:3.20") || "alpine:3.20",
  };
}

function mapImportedVariables(raw: Record<string, unknown>) {
  const variablesRaw = Array.isArray(raw.variables) ? raw.variables : [];
  return variablesRaw
    .map((item) => {
      const variable = (item ?? {}) as Record<string, unknown>;
      const key = asString(variable.env_variable || variable.key)
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, "_");
      return {
        key,
        default: asString(variable.default_value ?? variable.default),
        description: asString(variable.description || variable.name),
      };
    })
    .filter((variable) => /^[A-Z][A-Z0-9_]*$/.test(variable.key));
}

export async function importEgg(body: unknown) {
  const parsed = eggImportSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid egg import", parsed.error.flatten());
  }
  const nest = await Nest.findById(parsed.data.nestId);
  if (!nest) throw FlutterError.notFound("Nest not found");

  const raw = unwrapImportedEgg(parsed.data.egg);
  const dockerImage = pickDockerImage(raw);
  if (!dockerImage) {
    throw FlutterError.validation("Egg JSON is missing docker_image / docker_images");
  }

  const install = pickInstall(raw);
  const row = await Egg.create({
    nestId: parsed.data.nestId,
    name: asString(raw.name, "Imported egg") || "Imported egg",
    description: asString(raw.description),
    dockerImage,
    startup: asString(raw.startup),
    stopCommand: pickStopCommand(raw) || "stop",
    installScript: install.script,
    installImage: install.image,
    variables: mapImportedVariables(raw),
  });
  return publicEgg(row);
}

export async function seedDefaults() {
  let generic = await Nest.findOne({ name: "Generic" });
  if (!generic) {
    generic = await Nest.create({
      name: "Generic",
      description: "Utility images for testing the Flutter daemon.",
    });
  }
  if (!(await Egg.findOne({ nestId: generic._id, name: "Sleep" }))) {
    await Egg.create({
      nestId: generic._id,
      name: "Sleep",
      description: "busybox loop — used to verify install/power without a game JAR.",
      dockerImage: "busybox:1.36",
      startup: 'while true; do echo "[flutter] $(date -u +%H:%M:%S) running"; sleep 5; done',
      stopCommand: "stop",
      installScript: "echo installed > /mnt/server/.flutter-installed",
      installImage: "alpine:3.20",
      variables: [],
    });
  }

  let minecraft = await Nest.findOne({ name: "Minecraft" });
  if (!minecraft) {
    minecraft = await Nest.create({
      name: "Minecraft",
      description: "Minecraft Java Edition.",
    });
  }
  if (!(await Egg.findOne({ nestId: minecraft._id, name: "Vanilla" }))) {
    await Egg.create({
      nestId: minecraft._id,
      name: "Vanilla",
      description: "itzg Minecraft Java image. Accepts the EULA via environment.",
      dockerImage: "itzg/minecraft-server:java21",
      startup: "",
      stopCommand: "stop",
      installScript: "",
      installImage: "alpine:3.20",
      variables: [
        { key: "EULA", default: "TRUE", description: "Must be TRUE to accept the Minecraft EULA" },
        { key: "TYPE", default: "VANILLA", description: "Server type" },
        { key: "VERSION", default: "LATEST", description: "Minecraft version" },
        { key: "MEMORY", default: "2G", description: "JVM memory" },
      ],
    });
  }
}
