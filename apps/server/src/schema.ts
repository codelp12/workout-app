// Drizzle table definitions. Run `pnpm --filter @workout-app/server db:generate`
// after changing this file and commit the generated migration in `drizzle/`.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Throwaway Phase 0 spike (#21); replaced by the core schema in Epic B (#26).
export const spikeNotes = sqliteTable("spike_note", {
  id: text("id").primaryKey(),
  opId: text("op_id").notNull().unique(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
  receivedAt: integer("received_at").notNull(),
});

// Single-user sign-in (#29). One row, id 1.
export const account = sqliteTable("account", {
  id: integer("id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// `id` is the SHA-256 of the cookie token, so a copy of the DB can't be used to sign in.
export const authSession = sqliteTable("auth_session", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
