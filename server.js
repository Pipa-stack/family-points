/* Family Points — servidor.
   Sirve la web y una API para que cada familia tenga su espacio compartido,
   identificado por un código (p. ej. FAM-XY7K2QZ9).

   Almacenamiento: PostgreSQL si hay DATABASE_URL (Railway); si no, en memoria
   (solo desarrollo local). En producción sin BD el arranque falla a propósito.

   Guardado por operación: en vez de reemplazar todo el estado en cada cambio
   (que hacía que dos móviles se pisaran), cada turno se añade/edita/borra de
   forma atómica (SELECT ... FOR UPDATE), así los cambios simultáneos no se
   pierden. */
"use strict";

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // Railway está detrás de un proxy: necesario para rate-limit por IP

// Cabeceras de seguridad (CSP a medida: todo es self; se permiten estilos en
// línea porque coloreamos elementos con element.style, y data: para el favicon).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      styleSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      manifestSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
}));

app.use(express.json({ limit: "2mb" }));

const PUBLIC_DIR = path.join(__dirname, "public");
const INDEX = path.join(PUBLIC_DIR, "index.html");
const PORT = process.env.PORT || 3000;

// Límites de peticiones ------------------------------------------------------
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 3000, standardHeaders: "draft-7", legacyHeaders: false });
const createLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 40, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "too_many_families" } });
app.use("/api", apiLimiter);

// ---------------------------------------------------------------------------
// Saneado (la API nunca confía en el cliente)
// ---------------------------------------------------------------------------
const uid = () => crypto.randomBytes(4).toString("hex");
const isTime = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const numOr = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
const str = (v, max) => String(v == null ? "" : v).slice(0, max);

function cleanSettings(s) {
  s = s || {};
  return {
    pointsPerHour: numOr(s.pointsPerHour, 1),
    dayStart: isTime(s.dayStart) ? s.dayStart : "06:00",
    dayEnd: isTime(s.dayEnd) ? s.dayEnd : "22:00",
    perChild: !!s.perChild,
  };
}
const cleanMember = (m) => ({ id: str(m && m.id, 40) || uid(), name: str(m && m.name, 24) || "Sin nombre" });
const cleanChild = (c) => ({ id: str(c && c.id, 40) || uid(), name: str(c && c.name, 24) || "Peque" });
function cleanShift(sh) {
  sh = sh || {};
  return {
    id: str(sh.id, 40) || uid(),
    date: isDate(sh.date) ? sh.date : new Date().toISOString().slice(0, 10),
    memberId: str(sh.memberId, 40),
    start: isTime(sh.start) ? sh.start : "",
    end: isTime(sh.end) ? sh.end : "",
    kids: sh.kids != null && sh.kids !== "" && Number.isFinite(Number(sh.kids)) ? Math.max(0, Math.floor(Number(sh.kids))) : null,
    note: str(sh.note, 120),
  };
}

function defaultState() {
  return {
    settings: cleanSettings({}),
    members: [{ id: uid(), name: "Papá" }, { id: uid(), name: "Mamá" }],
    children: [{ id: uid(), name: "Peque" }],
    shifts: [],
  };
}

function sanitize(data) {
  if (!data || typeof data !== "object") return null;
  const base = defaultState();
  const members = Array.isArray(data.members) ? data.members.slice(0, 30).map(cleanMember) : [];
  return {
    settings: cleanSettings(data.settings),
    members: members.length ? members : base.members,
    children: Array.isArray(data.children) ? data.children.slice(0, 30).map(cleanChild) : [],
    shifts: Array.isArray(data.shifts) ? data.shifts.slice(0, 5000).map(cleanShift) : [],
  };
}

// ---------------------------------------------------------------------------
// Código de familia (8 caracteres, sin ambiguos → ~1,1e12 combinaciones)
// ---------------------------------------------------------------------------
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode() {
  const bytes = crypto.randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
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
      kind: "postgres",
      async get(code) {
        const r = await pool.query("SELECT data, updated_at FROM families WHERE code = $1", [code]);
        return r.rows[0] ? { data: r.rows[0].data, updatedAt: r.rows[0].updated_at.toISOString() } : null;
      },
      async create(code, data) {
        const r = await pool.query("INSERT INTO families (code, data) VALUES ($1, $2) RETURNING updated_at", [code, data]);
        return { updatedAt: r.rows[0].updated_at.toISOString() };
      },
      async replace(code, data) {
        const r = await pool.query("UPDATE families SET data = $2, updated_at = now() WHERE code = $1 RETURNING updated_at", [code, data]);
        return r.rows[0] ? { updatedAt: r.rows[0].updated_at.toISOString() } : null;
      },
      // Lectura-modificación-escritura atómica para evitar cambios perdidos.
      async mutate(code, fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const r = await client.query("SELECT data FROM families WHERE code = $1 FOR UPDATE", [code]);
          if (!r.rows[0]) { await client.query("ROLLBACK"); return null; }
          const newData = await fn(r.rows[0].data);
          const u = await client.query("UPDATE families SET data = $2, updated_at = now() WHERE code = $1 RETURNING updated_at", [code, newData]);
          await client.query("COMMIT");
          return { data: newData, updatedAt: u.rows[0].updated_at.toISOString() };
        } catch (e) {
          await client.query("ROLLBACK").catch(() => {});
          throw e;
        } finally {
          client.release();
        }
      },
    };
    console.log("Almacenamiento: PostgreSQL");
  } else {
    if (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === "production") {
      console.error("FATAL: no hay DATABASE_URL en producción. Añade PostgreSQL y la variable DATABASE_URL.");
      process.exit(1);
    }
    const mem = new Map();
    store = {
      kind: "memory",
      async get(code) { const v = mem.get(code); return v ? { data: v.data, updatedAt: v.updatedAt } : null; },
      async create(code, data) { const updatedAt = new Date().toISOString(); mem.set(code, { data, updatedAt }); return { updatedAt }; },
      async replace(code, data) { if (!mem.has(code)) return null; const updatedAt = new Date().toISOString(); mem.set(code, { data, updatedAt }); return { updatedAt }; },
      async mutate(code, fn) {
        const v = mem.get(code);
        if (!v) return null;
        const newData = await fn(v.data);
        const updatedAt = new Date().toISOString();
        mem.set(code, { data: newData, updatedAt });
        return { data: newData, updatedAt };
      },
    };
    console.log("Almacenamiento: EN MEMORIA (sin DATABASE_URL) — solo desarrollo");
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: "server_error" });
});

// Crear una familia nueva
app.post("/api/family", createLimiter, wrap(async (req, res) => {
  let code;
  for (let i = 0; i < 6; i++) { code = randomCode(); if (!(await store.get(code))) break; }
  const data = defaultState();
  const { updatedAt } = await store.create(code, data);
  res.status(201).json({ code, data, updatedAt });
}));

// Leer el estado de una familia
app.get("/api/family/:code", wrap(async (req, res) => {
  const row = await store.get(normalizeCode(req.params.code));
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json({ code: normalizeCode(req.params.code), data: row.data, updatedAt: row.updatedAt });
}));

// Reemplazo completo (solo para importar / vaciar: sobrescrituras intencionadas)
app.put("/api/family/:code", wrap(async (req, res) => {
  const code = normalizeCode(req.params.code);
  const data = sanitize(req.body && req.body.data);
  if (!data) return res.status(400).json({ error: "bad_data" });
  const saved = await store.replace(code, data);
  if (!saved) return res.status(404).json({ error: "not_found" });
  res.json({ code, updatedAt: saved.updatedAt });
}));

// Guardar reglas + miembros + peques (no toca los turnos)
app.put("/api/family/:code/config", wrap(async (req, res) => {
  const code = normalizeCode(req.params.code);
  const b = req.body || {};
  const result = await store.mutate(code, (data) => {
    const d = data && typeof data === "object" ? data : defaultState();
    if (b.settings) d.settings = cleanSettings(b.settings);
    if (Array.isArray(b.members)) { const m = b.members.slice(0, 30).map(cleanMember); d.members = m.length ? m : d.members; }
    if (Array.isArray(b.children)) d.children = b.children.slice(0, 30).map(cleanChild);
    return d;
  });
  if (!result) return res.status(404).json({ error: "not_found" });
  res.json({ code, updatedAt: result.updatedAt });
}));

// Añadir o actualizar un turno (upsert por id) — operación atómica
app.post("/api/family/:code/shifts", wrap(async (req, res) => {
  const code = normalizeCode(req.params.code);
  const raw = req.body && req.body.shift;
  if (!raw || typeof raw !== "object") return res.status(400).json({ error: "bad_shift" });
  const shift = cleanShift(raw);
  const result = await store.mutate(code, (data) => {
    const d = data && typeof data === "object" ? data : defaultState();
    if (!Array.isArray(d.shifts)) d.shifts = [];
    const i = d.shifts.findIndex((s) => s.id === shift.id);
    if (i >= 0) d.shifts[i] = shift;
    else if (d.shifts.length < 5000) d.shifts.push(shift);
    return d;
  });
  if (!result) return res.status(404).json({ error: "not_found" });
  res.json({ code, shift, updatedAt: result.updatedAt });
}));

// Borrar un turno — operación atómica
app.delete("/api/family/:code/shifts/:id", wrap(async (req, res) => {
  const code = normalizeCode(req.params.code);
  const id = str(req.params.id, 40);
  const result = await store.mutate(code, (data) => {
    const d = data && typeof data === "object" ? data : defaultState();
    d.shifts = Array.isArray(d.shifts) ? d.shifts.filter((s) => s.id !== id) : [];
    return d;
  });
  if (!result) return res.status(404).json({ error: "not_found" });
  res.json({ code, updatedAt: result.updatedAt });
}));

app.get("/api/health", (req, res) => res.json({ ok: true, storage: store.kind }));

// ---------------------------------------------------------------------------
// Web estática + SPA
// ---------------------------------------------------------------------------
app.use(express.static(PUBLIC_DIR));
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api")) return res.sendFile(INDEX);
  next();
});

// Manejo de errores genérico (incluye body-parser: JSON malformado, payload
// grande). Evita filtrar trazas de pila/rutas en cualquier entorno.
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "payload_too_large" });
  if (err.type === "entity.parse.failed" || err.status === 400) return res.status(400).json({ error: "bad_json" });
  console.error(err);
  res.status(500).json({ error: "server_error" });
});

// ---------------------------------------------------------------------------
initStore()
  .then(() => app.listen(PORT, () => console.log(`Family Points en http://localhost:${PORT}`)))
  .catch((err) => {
    console.error("No se pudo iniciar el almacenamiento:", err);
    process.exit(1);
  });
