import { pgTable, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";

// Armazena todos os registros do almoxarifado (usuários, produtos, movimentações etc.)
// agrupados por coleção, preservando o formato de documento usado pela interface.
export const documents = pgTable(
  "documents",
  {
    collection: text().notNull(),
    id: text().notNull(),
    data: jsonb().notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.collection, t.id] })]
);
