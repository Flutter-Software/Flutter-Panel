import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./constants";
import { SERVER_PERMISSIONS } from "./permissions";

export const roleSchema = z.enum(["admin", "user"]);
export type UserRole = z.infer<typeof roleSchema>;

export const objectIdSchema = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, "Must be a Mongo ObjectId");

export const publicUserSchema = z.object({
  id: objectIdSchema,
  username: z.string(),
  email: z.string().email(),
  role: roleSchema,
  totpEnabled: z.boolean(),
  createdAt: z.string(),
});

export type PublicUser = z.infer<typeof publicUserSchema>;

export const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, "Username may only contain letters, numbers, and underscores"),
  email: z.string().email(),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

export const adminUserCreateSchema = z.object({
  username: registerSchema.shape.username,
  email: z.string().email(),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  role: roleSchema.optional().default("user"),
});

export const adminUserUpdateSchema = z.object({
  username: registerSchema.shape.username,
  email: z.string().email(),
  password: z
    .union([z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH), z.literal("")])
    .optional(),
  role: roleSchema,
});

export const loginSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  remember: z.boolean().optional(),
});

export const inviteCompleteSchema = z.object({
  token: z.string().min(16).max(200),
  username: registerSchema.shape.username,
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

export const serverPermissionSchema = z.enum(SERVER_PERMISSIONS);

export const subuserUpsertSchema = z.object({
  identifier: z.string().min(1).max(255),
  permissions: z.array(serverPermissionSchema).default([]),
});

export const subuserUpdateSchema = z.object({
  permissions: z.array(serverPermissionSchema),
});

export const smtpEncryptionSchema = z.enum(["none", "starttls", "tls"]);
export type SmtpEncryption = z.infer<typeof smtpEncryptionSchema>;

export const smtpSettingsSchema = z
  .object({
    enabled: z.boolean(),
    host: z.string().max(255).default(""),
    port: z.number().int().min(1).max(65535).default(587),
    username: z.string().max(255).default(""),
    password: z.union([z.string().max(512), z.literal("")]).optional(),
    encryption: smtpEncryptionSchema.default("starttls"),
    fromEmail: z.string().max(255).default(""),
    fromName: z.string().max(120).default("Flutter"),
  })
  .superRefine((data, ctx) => {
    if (!data.enabled) return;
    if (!data.host.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "SMTP host is required", path: ["host"] });
    }
    if (!z.string().email().safeParse(data.fromEmail.trim()).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A valid from address is required",
        path: ["fromEmail"],
      });
    }
  });

export const smtpTestSchema = z.object({
  to: z.string().email(),
  enabled: z.boolean().optional(),
  host: z.string().max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().max(255).optional(),
  password: z.union([z.string().max(512), z.literal("")]).optional(),
  encryption: smtpEncryptionSchema.optional(),
  fromEmail: z.string().max(255).optional(),
  fromName: z.string().max(120).optional(),
});

export const locationCreateSchema = z.object({
  shortCode: z.string().min(1).max(16),
  description: z.string().max(120).optional().default(""),
});

export const locationUpdateSchema = z.object({
  shortCode: z.string().min(1).max(16).optional(),
  description: z.string().max(120).optional(),
});

export const nodeCreateSchema = z.object({
  locationId: objectIdSchema,
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "1–100 chars: a–z, 0–9, dashes"),
  description: z.string().max(240).optional().default(""),
  public: z.boolean().optional().default(true),
  fqdn: z.string().min(1).max(255),
  scheme: z.enum(["https", "http"]).optional().default("https"),
  behindProxy: z.boolean().optional().default(false),
  daemonBase: z.string().min(1).max(255).optional().default("/var/lib/flutter/volumes"),
  memoryMb: z.number().int().positive(),
  diskMb: z.number().int().positive(),
  memoryOverallocate: z.number().int().min(-1).max(1000).optional().default(0),
  diskOverallocate: z.number().int().min(-1).max(1000).optional().default(0),
  daemonPort: z.number().int().min(1).max(65535).optional().default(8080),
  sftpPort: z.number().int().min(1).max(65535).optional().default(2022),
});

export const allocationCreateSchema = z.object({
  ip: z.string().min(1).max(64),
  alias: z.string().max(255).optional().default(""),
  ports: z.string().min(1).max(500),
  notes: z.string().max(240).optional().default(""),
});

export const nestCreateSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(240).optional().default(""),
});

export const nestUpdateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(240).optional(),
});

export const eggVariableSchema = z.object({
  key: z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*$/),
  default: z.string().max(512).default(""),
  description: z.string().max(240).optional().default(""),
});

export const eggCreateSchema = z.object({
  nestId: objectIdSchema,
  name: z.string().min(1).max(64),
  description: z.string().max(240).optional().default(""),
  dockerImage: z.string().min(1).max(255),
  startup: z.string().max(2000).optional().default(""),
  stopCommand: z.string().max(120).optional().default("stop"),
  installScript: z.string().max(20_000).optional().default(""),
  installImage: z.string().max(255).optional().default("alpine:3.20"),
  variables: z.array(eggVariableSchema).optional().default([]),
});

export const eggUpdateSchema = eggCreateSchema.partial();

export const eggImportSchema = z.object({
  nestId: objectIdSchema,
  egg: z.record(z.unknown()),
});

export const serverCreateSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(240).optional().default(""),
  eggId: objectIdSchema,
  nodeId: objectIdSchema,
  allocationId: objectIdSchema,
  ownerId: objectIdSchema.optional(),
  memoryMb: z.number().int().positive(),
  diskMb: z.number().int().positive(),
  cpuPercent: z.number().int().positive().max(800).optional().default(100),
  environment: z.record(z.string()).optional().default({}),
});

export const serverUpdateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(240).optional(),
  ownerId: objectIdSchema.optional(),
  allocationId: objectIdSchema.optional(),
  memoryMb: z.number().int().positive().optional(),
  diskMb: z.number().int().positive().optional(),
  cpuPercent: z.number().int().positive().max(800).optional(),
  environment: z.record(z.string()).optional(),
});

export const powerActionSchema = z.enum(["start", "stop", "restart", "kill"]);
export type PowerAction = z.infer<typeof powerActionSchema>;

export const heartbeatSchema = z.object({
  nodeId: objectIdSchema,
  listenUrl: z.string().url(),
  version: z.string().min(1).max(32).optional(),
});

export const serverStatusSchema = z.enum([
  "offline",
  "installing",
  "install_failed",
  "starting",
  "running",
  "stopping",
]);
export type ServerStatus = z.infer<typeof serverStatusSchema>;
