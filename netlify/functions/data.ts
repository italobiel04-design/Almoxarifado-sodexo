import type { Config } from "@netlify/functions";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { documents } from "../../db/schema.js";

const COLLECTIONS = ["usuarios", "rh", "produtos", "movimentacoes", "emprestimos", "pedidos", "lavanderia"];

const DEFAULT_USERS = [
  { id: "usr-adm", nome: "Administrador SODEXO", perfil: "GESTAO", senha: "123", permEntradaSaida: true, permPedidos: true, permEmprestimo: true },
  { id: "usr-colab1", nome: "João Almoxarife (Colaborador)", perfil: "COLABORADOR", senha: "123", permEntradaSaida: true, permPedidos: false, permEmprestimo: true },
  { id: "usr-cc-matriz", nome: "Centro Custo - Matriz (Sede)", perfil: "CENTRO_CUSTO", senha: "123", permEntradaSaida: true, permPedidos: true, permEmprestimo: true },
  { id: "usr-cc-obra", nome: "Centro Custo - Operação Norte", perfil: "CENTRO_CUSTO", senha: "123", permEntradaSaida: true, permPedidos: true, permEmprestimo: true },
];

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function stripId(data: Record<string, unknown>) {
  const { id: _id, ...rest } = data ?? {};
  return rest;
}

// Cria os perfis padrão no servidor (uma única vez) para evitar que vários
// navegadores abertos ao mesmo tempo tentem semear os usuários em paralelo.
async function ensureDefaultUsers() {
  const existing = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.collection, "usuarios"))
    .limit(1);
  if (existing.length > 0) return;
  await db
    .insert(documents)
    .values(DEFAULT_USERS.map((u) => ({ collection: "usuarios", id: u.id, data: stripId(u) })))
    .onConflictDoNothing();
}

async function listAll() {
  await ensureDefaultUsers();
  const rows = await db.select().from(documents).orderBy(documents.createdAt);
  const result: Record<string, Record<string, unknown>[]> = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
  for (const row of rows) {
    if (!result[row.collection]) continue;
    result[row.collection].push({ ...row.data, id: row.id });
  }
  return result;
}

export default async (req: Request) => {
  try {
    if (req.method === "GET") {
      return json(await listAll());
    }

    if (req.method !== "POST") {
      return json({ error: "Método não permitido" }, 405);
    }

    const body = await req.json();
    const { op, col, id } = body ?? {};

    if (op === "movimentacao") {
      // Atualiza o estoque de forma atômica no banco para que lançamentos
      // simultâneos de usuários diferentes não sobrescrevam um ao outro.
      const { movId, produtoId, mov } = body;
      if (typeof movId !== "string" || !movId || !mov) return json({ error: "Movimentação inválida" }, 400);
      const qtd = Number(mov.qtd) || 0;
      const delta = mov.tipo === "ENTRADA" ? qtd : -qtd;

      await db.transaction(async (tx) => {
        if (typeof produtoId === "string" && produtoId) {
          await tx
            .update(documents)
            .set({
              data: sql`jsonb_set(${documents.data}, '{qtd}', to_jsonb(GREATEST(0, COALESCE((${documents.data}->>'qtd')::numeric, 0) + ${delta}::numeric)))`,
              updatedAt: new Date(),
            })
            .where(and(eq(documents.collection, "produtos"), eq(documents.id, produtoId)));
        }
        await tx.insert(documents).values({ collection: "movimentacoes", id: movId, data: stripId(mov) });
      });
      return json(await listAll());
    }

    if (!COLLECTIONS.includes(col) || typeof id !== "string" || !id) {
      return json({ error: "Coleção ou identificador inválido" }, 400);
    }

    const where = and(eq(documents.collection, col), eq(documents.id, id));

    if (op === "set") {
      const data = stripId(body.data);
      await db
        .insert(documents)
        .values({ collection: col, id, data })
        .onConflictDoUpdate({
          target: [documents.collection, documents.id],
          set: {
            data: body.merge ? sql`${documents.data} || ${JSON.stringify(data)}::jsonb` : data,
            updatedAt: new Date(),
          },
        });
    } else if (op === "update") {
      const updated = await db
        .update(documents)
        .set({ data: sql`${documents.data} || ${JSON.stringify(stripId(body.data))}::jsonb`, updatedAt: new Date() })
        .where(where)
        .returning({ id: documents.id });
      if (updated.length === 0) return json({ error: "Registro não encontrado" }, 404);
    } else if (op === "delete") {
      await db.delete(documents).where(where);
    } else {
      return json({ error: "Operação inválida" }, 400);
    }

    return json(await listAll());
  } catch (err) {
    console.error("Erro na API de dados:", err);
    return json({ error: "Falha ao acessar o banco de dados" }, 500);
  }
};

export const config: Config = {
  path: "/api/data",
};
