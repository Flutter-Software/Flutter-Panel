import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

config({ path: resolve(process.cwd(), "../../.env") });
config();

export const prisma = new PrismaClient();

export async function pingPrisma() {
  await prisma.$runCommandRaw({ ping: 1 });
}
