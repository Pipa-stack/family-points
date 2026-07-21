/* Family Points — servidor.
   Sirve la web y una API mínima para que cada familia tenga su espacio
   compartido, identificado por un código (p. ej. FAM-XY7K2Q).
   Almacenamiento: PostgreSQL si hay DATABASE_URL (Railway); si no, en memoria
   (útil para desarrollo local; los datos se pierden al reiniciar). */
"use strict";

const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

const PUBLIC_DIR = path.join(__dirname, "public");
const INDEX = path.join(PUBLIC_DIR, "index.html");
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Estado por defecto y saneado (la API no confía en el cliente)
// ---------------------------------------------------------------------------
const uid = () => crypto.randomBytes(4).toString("hex");
const isTime = (v) => typeof v === "string" && /^\d{2}:\d{2}$/.test(v);
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const numOr = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
const str = (v, max) => String(v == null ? "" : v).slice(0, max);

function defaultState() {
  return {
    settings: { pointsPerHour: 1, dayStart: "06:00", dayEnd: "22:00", perChild: false },
    members: [
      { id: uid(), name: "Papá" },
      { id: uid(), name: "Mamá" },
    ],
    children: [{ id: uid(), name: "Peque" }],
    shifts: [],
  };
}

function sanitize(data) {
  if (!data || typeof data !== "object") return null;
  const base = defaultState();
  const s = data.settings || {};
  const members = Array.isArray(data.members) ? data.members.slice(0, 30) : [];
  const children = Array.isArray(data.children) ? data.children.slice(0, 30) : [];
  const shifts = Array.isArray(data.shifts) ? data.shifts.slice(0, 5000) : [];
  return {
    settings: {
      pointsPerHour: numOr(s.pointsPerHour, 1),
      dayStart: isTime(s.dayStart) ? s.dayStart : "06:00",
      dayEnd: isTime(s.dayEnd) ? s.dayEnd : "22:00",
      perChild: !!s.perChild,
    },
    members: members.length
      ? members.map((m) => ({ id: str(m.id, 40) || uid(), name: str(m.name, 24) || "Sin nombre" }))
      : base.members,
    children: children.map((c) => ({ id: str(c.id, 40) || uid(), name: str(c.name, 24) || "Peque" })),
    shifts: shifts.map((sh) => ({
      id: str(sh.id, 40) || uid(),
      date: isDate(sh.date) ? sh.date : new Date().toISOString().slice(0, 10),
      memberId: str(sh.memberId, 40),
      start: isTime(sh.start) ? sh.start : "",
      end: isTime(sh.end) ? sh.end : "",
      kids: Number.isFinite(Number(sh.kids)) && sh.kids !== null && sh.kids !== "" ? Math.max(0, Math.floor(Number(sh.kids))) : null,
      note: str(sh.note, 120),
    })),
  };
}

// ---------------------------------------------------------------------------
// Código de familia (sin caracteres ambiguos)
// ---------------------------------------------------------------------------
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode() {
  const bytes = crypto.randomBytes(6);
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return "FAM-" + s;
}
const normalizeCode = (c) => String(c || "").trim().toUpperCase().replace(/\s+/g, "");

// ---------------------------------------------------------------------------
// Almacenamiento
// ---------------------------------------------------------------------------
let store;

async function initStore() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require("pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS families (
        code       TEXT PRIMARY KEY,
        data       JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    store = {
      async get(code) {
        const r = await pool.query("SELECT data, updated_at FROM families WHERE code = $1", [code]);
        return r.rows[0] ? { data: r.rows[0].data, updatedAt: r.rows[0].updated_at.toISOString() } : null;
      },
      async create(code, data) {
        const r = await pool.query(
          "INSERT INTO families (code, data) VALUES ($1, $2) RETURNING updated_at",
          [code, data]
        );
        return { updatedAt: r.rows[0].updated_at.toISOString() };
      },
      async save(code, data) {
        const r = await pool.query(
          "UPDATE families SET data = $2, updated_at = now() WHERE code = $1 RETURNING updated_at",
          [code, data]
        );
        return r.rows[0] ? { updatedAt: r.rows[0].updated_at.toISOString() } : null;
      },
    };
    console.log("Almacenamiento: PostgreSQL");
  } else {
    const mem = new Map();
    store = {
      async get(code) {
        const v = mem.get(code);
        return v ? { data: v.data, updatedAt: v.updatedAt } : null;
      },
      async create(code, data) {
        const updatedAt = new Date().toISOString();
        mem.set(code, { data, updatedAt });
        return { updatedAt };
      },
      async save(code, data) {
        if (!mem.has(code)) return null;
        const updatedAt = new Date().toISOString();
        mem.set(code, { data, updatedAt });
        return { updatedAt };
      },
    };
    console.log("Almacenamiento: EN MEMORIA (sin DATABASE_URL) — los datos se pierden al reiniciar");
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: "server_error" });
});

// Crear una familia nueva -> devuelve su código y estado inicial
app.post("/api/family", wrap(async (req, res) => {
  let code;
  for (let i = 0; i < 6; i++) {
    code = randomCode();
    if (!(await store.get(code))) break;
  }
  const data = defaultState();
  const { updatedAt } = await store.create(code, data);
  res.status(201).json({ code, data, updatedAt });
}));

// Leer el estado de una familia
app.get("/api/family/:code", wrap(async (req, res) => {
  const code = normalizeCode(req.params.code);
  const row = await store.get(code);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json({ code, data: row.data, updatedAt: row.updatedAt });
}));

// Guardar el estado completo de una familia
app.put("/api/family/:code", wrap(async (req, res) => {
  const code = normalizeCode(req.params.code);
  const data = sanitize(req.body && req.body.data);
  if (!data) return res.status(400).json({ error: "bad_data" });
  const saved = await store.save(code, data);
  if (!saved) return res.status(404).json({ error: "not_found" });
  res.json({ code, updatedAt: saved.updatedAt });
}));

app.get("/api/health", (req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// Web estática + SPA (rutas /f/CODIGO sirven la app)
// ---------------------------------------------------------------------------
app.use(express.static(PUBLIC_DIR));
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api")) return res.sendFile(INDEX);
  next();
});

// ---------------------------------------------------------------------------
initStore()
  .then(() => app.listen(PORT, () => console.log(`Family Points en http://localhost:${PORT}`)))
  .catch((err) => {
    console.error("No se pudo iniciar el almacenamiento:", err);
    process.exit(1);
  });
