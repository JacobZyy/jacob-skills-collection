import { PrismaClient } from "@prisma/client";

// Single PrismaClient per process. Imported eagerly so that DATABASE_URL must
// already have been injected via injectDatabaseUrl() before this module loads.
// Server boot (index.ts) is the single entry point that enforces ordering.
//
// Why a top-level singleton: Prisma's docs warn that instantiating multiple
// clients exhausts the connection pool. SQLite has effectively one writer
// anyway, so we centralize here and pass the instance into every handler /
// runner function.
export const prisma = new PrismaClient();

export type Prisma = typeof prisma;
