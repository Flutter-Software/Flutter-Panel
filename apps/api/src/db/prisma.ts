import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

config({ path: resolve(process.cwd(), "../../.env") });
config();

// Mongoose is what the API actually reads/writes. Prisma is the collection
// map in prisma/schema.prisma — we keep a client around so `prisma generate`
// stays honest and /health 503s if that client is out of date.
const prisma = new PrismaClient();

export async function pingPrisma() {
  await prisma.$runCommandRaw({ ping: 1 });
}
