import mongoose, { Schema, type Model } from "mongoose";

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, default: "user" },
    totpSecret: { type: String, default: null },
    totpEnabled: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: true },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const locationSchema = new Schema({
  shortCode: { type: String, required: true, unique: true, lowercase: true, trim: true },
  description: { type: String, default: "" },
  createdAt: { type: Date, required: true, default: Date.now },
});

const nodeSchema = new Schema({
  locationId: { type: Schema.Types.ObjectId, ref: "Location", required: true, index: true },
  name: { type: String, required: true },
  description: { type: String, default: "" },
  fqdn: { type: String, required: true },
  public: { type: Boolean, default: true },
  scheme: { type: String, default: "https" },
  behindProxy: { type: Boolean, default: false },
  daemonBase: { type: String, default: "/var/lib/flutter/volumes" },
  memoryMb: { type: Number, required: true },
  diskMb: { type: Number, required: true },
  memoryOverallocate: { type: Number, default: 0 },
  diskOverallocate: { type: Number, default: 0 },
  daemonPort: { type: Number, default: 8080 },
  sftpPort: { type: Number, default: 2022 },
  tokenHash: { type: String, default: null },
  tokenPrefix: { type: String, default: null },
  daemonToken: { type: String, default: null },
  daemonListenUrl: { type: String, default: null },
  lastHeartbeatAt: { type: Date, default: null },
  createdAt: { type: Date, required: true, default: Date.now },
});

const allocationSchema = new Schema({
  nodeId: { type: Schema.Types.ObjectId, ref: "Node", required: true, index: true },
  ip: { type: String, required: true },
  alias: { type: String, default: "" },
  port: { type: Number, required: true },
  notes: { type: String, default: "" },
  serverId: { type: Schema.Types.ObjectId, ref: "Server", default: null, index: true },
  createdAt: { type: Date, required: true, default: Date.now },
});

allocationSchema.index({ ip: 1, port: 1 }, { unique: true });

const nestSchema = new Schema({
  name: { type: String, required: true },
  description: { type: String, default: "" },
  createdAt: { type: Date, required: true, default: Date.now },
});

const eggSchema = new Schema({
  nestId: { type: Schema.Types.ObjectId, ref: "Nest", required: true, index: true },
  name: { type: String, required: true },
  description: { type: String, default: "" },
  dockerImage: { type: String, required: true },
  startup: { type: String, default: "" },
  stopCommand: {
    type: String,
    required: true,
    default: "stop",
    set: (value: string) => (typeof value === "string" && value.trim() ? value : "stop"),
  },
  installScript: { type: String, default: "" },
  installImage: { type: String, default: "alpine:3.20" },
  variables: { type: Schema.Types.Mixed, default: [] },
  createdAt: { type: Date, required: true, default: Date.now },
});

const serverSchema = new Schema(
  {
    uuid: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    nodeId: { type: Schema.Types.ObjectId, ref: "Node", required: true, index: true },
    eggId: { type: Schema.Types.ObjectId, ref: "Egg", required: true, index: true },
    allocationId: { type: Schema.Types.ObjectId, ref: "Allocation", required: true, unique: true },
    memoryMb: { type: Number, required: true },
    diskMb: { type: Number, required: true },
    cpuPercent: { type: Number, required: true, default: 100 },
    status: { type: String, required: true, default: "offline" },
    environment: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

const subuserSchema = new Schema(
  {
    serverId: { type: Schema.Types.ObjectId, ref: "Server", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    permissions: { type: [String], default: [] },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    inviteTokenHash: { type: String, default: null, index: true },
    inviteExpiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

subuserSchema.index({ serverId: 1, email: 1 }, { unique: true });

const panelSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "panel" },
    smtp: {
      enabled: { type: Boolean, default: false },
      host: { type: String, default: "" },
      port: { type: Number, default: 587 },
      username: { type: String, default: "" },
      password: { type: String, default: "" },
      encryption: { type: String, default: "starttls" },
      fromEmail: { type: String, default: "" },
      fromName: { type: String, default: "Flutter" },
    },
  },
  { timestamps: true },
);

function modelOf(name: string, schema: Schema): Model<any> {
  if (mongoose.models[name]) mongoose.deleteModel(name);
  return mongoose.model(name, schema);
}

export const User = modelOf("User", userSchema);
export const Session = modelOf("Session", sessionSchema);
export const Location = modelOf("Location", locationSchema);
export const Node = modelOf("Node", nodeSchema);
export const Allocation = modelOf("Allocation", allocationSchema);
export const Nest = modelOf("Nest", nestSchema);
export const Egg = modelOf("Egg", eggSchema);
export const Server = modelOf("Server", serverSchema);
export const Subuser = modelOf("Subuser", subuserSchema);
export const PanelSettings = modelOf("PanelSettings", panelSettingsSchema);
