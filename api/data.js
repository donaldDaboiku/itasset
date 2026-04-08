const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DB_DIR =
  process.env.ITASSET_DB_DIR || path.join(process.cwd(), "data");
const DB_PATH =
  process.env.ITASSET_DB_PATH || path.join(DB_DIR, "itassettrack.sqlite");

function ensureDb() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      event_date TEXT,
      action TEXT,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      task_date TEXT,
      staff TEXT,
      dept TEXT,
      category TEXT,
      status TEXT,
      duration_hours REAL,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT,
      role TEXT,
      status TEXT,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

function applyCors(req, res) {
  const origin = process.env.ITASSET_ALLOWED_ORIGIN || req.headers.origin || "null";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function json(req, res, status, payload) {
  if (typeof res.status === "function") {
    res.status(status);
  } else {
    res.statusCode = status;
  }
  res.setHeader("Content-Type", "application/json");
  applyCors(req, res);
  res.end(JSON.stringify(payload));
}

function parseMaybeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

function deriveRowId(prefix, row, index) {
  if (row && row.id) return String(row.id);
  const base = [
    prefix,
    index,
    row && (row.date || row.event_date || row.username || row.serial || row.staff),
    row && (row.action || row.title || row.name || row.tag),
  ]
    .filter(Boolean)
    .join("_");
  return base || `${prefix}_${index}`;
}

function getRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      return Object.fromEntries(new URLSearchParams(req.body));
    }
  }
  return req.body;
}

function getPresentedToken(req, body) {
  const auth = String(req.headers.authorization || "");
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  return req.headers["x-sync-token"] || "";
}

function sanitizeUserRow(user) {
  const clean = { ...(user || {}) };
  delete clean.password;
  return clean;
}

function writeSnapshot(db, payload) {
  const now = new Date().toISOString();
  const devices = Array.isArray(payload.devices) ? payload.devices : [];
  const history = Array.isArray(payload.history) ? payload.history : [];
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  const users = Array.isArray(payload.users)
    ? payload.users.map((row) => sanitizeUserRow(row))
    : [];
  const settings = payload.settings || {};

  const insertDevice = db.prepare(
    "INSERT INTO devices (id, data, updated_at) VALUES (?, ?, ?)",
  );
  const insertHistory = db.prepare(
    "INSERT INTO history (id, sort_order, event_date, action, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertTask = db.prepare(
    "INSERT INTO tasks (id, task_date, staff, dept, category, status, duration_hours, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertUser = db.prepare(
    "INSERT INTO users (id, username, role, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const upsertMeta = db.prepare(
    "INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
  );

  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM devices");
    db.exec("DELETE FROM history");
    db.exec("DELETE FROM tasks");
    db.exec("DELETE FROM users");

    devices.forEach((row, index) => {
      insertDevice.run(
        deriveRowId("device", row, index),
        JSON.stringify(row),
        row.updatedAt || now,
      );
    });

    history.forEach((row, index) => {
      insertHistory.run(
        deriveRowId("history", row, index),
        index,
        row.date || "",
        row.action || "",
        JSON.stringify(row),
        row.updatedAt || row.date || now,
      );
    });

    tasks.forEach((row, index) => {
      insertTask.run(
        deriveRowId("task", row, index),
        row.date || "",
        row.staff || "",
        row.dept || "",
        row.category || "",
        row.status || "",
        parseFloat(row.durationHours) || 0,
        JSON.stringify(row),
        row.updatedAt || now,
      );
    });

    users.forEach((row, index) => {
      insertUser.run(
        deriveRowId("user", row, index),
        row.username || "",
        row.role || "",
        row.status || "",
        JSON.stringify(sanitizeUserRow(row)),
        row.lastLogin || row.updatedAt || now,
      );
    });

    upsertMeta.run("settings", JSON.stringify(settings), now);
    upsertMeta.run("last_sync", now, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function readSnapshot(db) {
  const deviceRows = db
    .prepare("SELECT data FROM devices ORDER BY updated_at ASC")
    .all();
  const historyRows = db
    .prepare("SELECT data FROM history ORDER BY sort_order ASC")
    .all();
  const taskRows = db
    .prepare(
      "SELECT data FROM tasks ORDER BY COALESCE(task_date, updated_at) DESC, updated_at DESC",
    )
    .all();
  const userRows = db
    .prepare("SELECT data FROM users ORDER BY username ASC, updated_at ASC")
    .all();
  const settingsRow = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get("settings");

  return {
    devices: deviceRows.map((row) => parseMaybeJson(row.data, {})),
    history: historyRows.map((row) => parseMaybeJson(row.data, {})),
    tasks: taskRows.map((row) => parseMaybeJson(row.data, {})),
    users: userRows.map((row) => sanitizeUserRow(parseMaybeJson(row.data, {}))),
    settings: settingsRow ? parseMaybeJson(settingsRow.value, {}) : {},
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    applyCors(req, res);
    res.end();
    return;
  }

  let db;
  try {
    const body = getRequestBody(req);
    const requiredToken = process.env.ITASSET_SYNC_TOKEN;
    if (!requiredToken) {
      json(req, res, 500, {
        error: "Server not configured: missing ITASSET_SYNC_TOKEN",
      });
      return;
    }
    const presentedToken = getPresentedToken(req, body);
    if (!presentedToken || presentedToken !== requiredToken) {
      json(req, res, 401, { error: "Unauthorized" });
      return;
    }
    db = ensureDb();
    const action =
      (req.query && req.query.action) || body.action || (req.method === "GET" ? "read" : "write");

    if (req.method === "GET" && action === "read") {
      json(req, res, 200, readSnapshot(db));
      return;
    }

    if (req.method === "POST" && action === "write") {
      const incoming =
        typeof body.data === "string" ? parseMaybeJson(body.data, {}) : body.data || {};
      writeSnapshot(db, incoming);
      json(req, res, 200, { ok: true, storage: "sqlite" });
      return;
    }

    json(req, res, 405, { error: "Method not allowed" });
  } catch (error) {
    json(req, res, 500, {
      error: "Database sync failed",
      detail: error && error.message ? error.message : String(error),
    });
  } finally {
    try {
      if (db) db.close();
    } catch (e) {}
  }
};
