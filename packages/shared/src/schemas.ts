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

export const verifyEmailSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const resendVerifySchema = z.object({
  email: z.string().email(),
});

export const inviteCompleteSchema = z.object({
  token: z.string().min(16).max(200),
  username: registerSchema.shape.username,
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
    confirmPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const updateProfileSchema = z.object({
  username: registerSchema.shape.username,
  email: z.string().email(),
});

export const totpCodeSchema = z
  .string()
  .transform((value) => value.replace(/\D/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit authenticator code"));

export const totpSetupSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const totpEnableSchema = z.object({
  code: totpCodeSchema,
});

export const totpDisableSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  code: totpCodeSchema,
});

export const totpLoginSchema = z.object({
  token: z.string().min(16).max(2000),
  code: totpCodeSchema,
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

export const brandingUpdateSchema = z.object({
  siteName: z.string().trim().min(1).max(48),
  logo: z
    .object({
      mime: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
      data: z.string().min(1).max(3_000_000),
    })
    .nullable()
    .optional(),
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
  cpuCores: z.number().int().min(1).max(256).optional().default(8),
  memoryOverallocate: z.number().int().min(-1).max(1000).optional().default(0),
  diskOverallocate: z.number().int().min(-1).max(1000).optional().default(0),
  daemonPort: z.number().int().min(1).max(65535).optional().default(8080),
  sftpPort: z.number().int().min(1).max(65535).optional().default(2022),
  uploadLimitMb: z.number().int().min(1).max(2048).optional().default(250),
  maintenanceMode: z.boolean().optional().default(false),
});

export const nodeUpdateSchema = z.object({
  locationId: objectIdSchema.optional(),
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "1–100 chars: a–z, 0–9, dashes")
    .optional(),
  description: z.string().max(240).optional(),
  public: z.boolean().optional(),
  fqdn: z.string().min(1).max(255).optional(),
  scheme: z.enum(["https", "http"]).optional(),
  behindProxy: z.boolean().optional(),
  daemonBase: z.string().min(1).max(255).optional(),
  memoryMb: z.number().int().positive().optional(),
  diskMb: z.number().int().positive().optional(),
  cpuCores: z.number().int().min(1).max(256).optional(),
  memoryOverallocate: z.number().int().min(-1).max(1000).optional(),
  diskOverallocate: z.number().int().min(-1).max(1000).optional(),
  daemonPort: z.number().int().min(1).max(65535).optional(),
  sftpPort: z.number().int().min(1).max(65535).optional(),
  uploadLimitMb: z.number().int().min(1).max(2048).optional(),
  maintenanceMode: z.boolean().optional(),
});

export const daemonConfigSaveSchema = z.object({
  content: z.string().min(2).max(100_000),
});

export const allocationCreateSchema = z.object({
  ip: z.string().min(1).max(64),
  alias: z.string().max(255).optional().default(""),
  ports: z.string().min(1).max(500),
  notes: z.string().max(240).optional().default(""),
});

export const allocationUpdateSchema = z
  .object({
    notes: z.string().max(240).optional(),
    alias: z.string().max(255).optional(),
    primary: z.boolean().optional(),
  })
  .refine((data) => data.notes !== undefined || data.alias !== undefined || data.primary === true, {
    message: "Nothing to update",
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
  egg: z.any(),
});

export const serverCreateSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(240).optional().default(""),
  eggId: objectIdSchema,
  nodeId: objectIdSchema,
  allocationId: objectIdSchema,
  allocationIds: z.array(objectIdSchema).max(50).optional().default([]),
  ownerId: objectIdSchema.optional(),
  memoryMb: z.number().int().min(0).max(16_777_216),
  diskMb: z.number().int().min(0).max(16_777_216),
  cpuPercent: z.number().int().min(0).max(800).optional().default(100),
  cpuPinning: z.number().int().min(0).max(256).optional().default(0),
  databaseLimit: z.number().int().min(0).max(50).optional().default(0),
  backupsEnabled: z.boolean().optional().default(true),
  dockerImage: z.string().min(1).max(255).optional(),
  startup: z.string().max(2000).optional(),
  stopCommand: z.string().max(120).optional(),
  environment: z.record(z.string()).optional().default({}),
});

export const serverUpdateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(240).optional(),
  ownerId: objectIdSchema.optional(),
  allocationId: objectIdSchema.optional(),
  allocationIds: z.array(objectIdSchema).max(50).optional(),
  memoryMb: z.number().int().min(0).max(16_777_216).optional(),
  diskMb: z.number().int().min(0).max(16_777_216).optional(),
  cpuPercent: z.number().int().min(0).max(800).optional(),
  cpuPinning: z.number().int().min(0).max(256).optional(),
  databaseLimit: z.number().int().min(0).max(50).optional(),
  backupsEnabled: z.boolean().optional(),
  environment: z.record(z.string()).optional(),
});

export const powerActionSchema = z.enum(["start", "stop", "restart", "kill"]);
export type PowerAction = z.infer<typeof powerActionSchema>;

const cronFieldSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[\d*,/\-A-Za-z]+$/, "Invalid cron field");

export const scheduleCronSchema = z.object({
  minute: cronFieldSchema.default("*"),
  hour: cronFieldSchema.default("*"),
  dayOfMonth: cronFieldSchema.default("*"),
  month: cronFieldSchema.default("*"),
  dayOfWeek: cronFieldSchema.default("*"),
});

export const scheduleTaskActionSchema = z.enum(["power", "command", "backup"]);
export type ScheduleTaskAction = z.infer<typeof scheduleTaskActionSchema>;

export const scheduleTaskSchema = z
  .object({
    id: z.string().optional(),
    action: scheduleTaskActionSchema,
    payload: z.string().max(500).default(""),
    timeOffset: z.number().int().min(0).max(900).default(0),
    continueOnFailure: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.action === "power" && !powerActionSchema.safeParse(data.payload).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose start, stop, restart, or kill",
        path: ["payload"],
      });
    }
    if (data.action === "command" && !data.payload.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Command is required",
        path: ["payload"],
      });
    }
  });

export const scheduleUpsertSchema = z.object({
  name: z.string().trim().min(1).max(64),
  enabled: z.boolean().optional().default(true),
  onlyWhenOnline: z.boolean().optional().default(false),
  cron: scheduleCronSchema,
  tasks: z.array(scheduleTaskSchema).min(1).max(10),
});

export const heartbeatSchema = z.object({
  nodeId: objectIdSchema,
  listenUrl: z.string().url(),
  version: z.string().min(1).max(32).optional(),
  system: z
    .object({
      hostname: z.string().max(255).optional(),
      platform: z.string().max(64).optional(),
      release: z.string().max(64).optional(),
      arch: z.string().max(32).optional(),
      cpuThreads: z.number().int().min(1).max(8192).optional(),
      totalMemoryMb: z.number().int().min(0).optional(),
    })
    .optional(),
});

export const LAST_EXIT_KINDS = ["oom", "killed", "crash", "install_failed"] as const;
export type LastExitKind = (typeof LAST_EXIT_KINDS)[number];

export const lastExitSchema = z.object({
  kind: z.enum(LAST_EXIT_KINDS),
  code: z.number().int().optional(),
  message: z.string().max(500),
  at: z.string().min(1).max(40),
});
export type LastExit = z.infer<typeof lastExitSchema>;

export const daemonServerStateSchema = z.object({
  nodeId: objectIdSchema,
  status: z.enum(["offline", "starting", "running", "stopping"]).optional(),
  install: z
    .object({
      ok: z.boolean(),
      error: z.string().max(2000).optional(),
    })
    .optional(),
  lastExit: lastExitSchema.nullable().optional(),
});

export const databaseHostCreateSchema = z.object({
  name: z.string().trim().min(1).max(64),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535).optional().default(3306),
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  publicHost: z.string().trim().max(255).optional().default(""),
  publicPort: z.number().int().min(0).max(65535).optional().default(0),
  nodeIds: z.array(objectIdSchema).max(200).optional().default([]),
  maxDatabases: z.number().int().min(0).max(10_000).optional().default(0),
});

export const databaseHostUpdateSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  host: z.string().trim().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().trim().min(1).max(64).optional(),
  password: z.union([z.string().min(1).max(256), z.literal("")]).optional(),
  publicHost: z.string().trim().max(255).optional(),
  publicPort: z.number().int().min(0).max(65535).optional(),
  nodeIds: z.array(objectIdSchema).max(200).optional(),
  maxDatabases: z.number().int().min(0).max(10_000).optional(),
});

export const databaseHostTestSchema = z.object({
  hostId: objectIdSchema.optional(),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535).optional().default(3306),
  username: z.string().trim().min(1).max(64),
  password: z.union([z.string().max(256), z.literal("")]).optional().default(""),
});

export const serverDatabaseCreateSchema = z.object({
  hostId: objectIdSchema,
  name: z
    .string()
    .trim()
    .min(1)
    .max(48)
    .regex(/^[a-zA-Z0-9_]+$/, "Use letters, numbers, and underscores"),
  remote: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9._%\-:]+$/, "Use an IP, hostname, or %")
    .optional()
    .default("%"),
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
