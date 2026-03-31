/**
 * BlazeTrack — Backend
 * Node.js + Express + SQLite
 *
 * Instalar: npm install
 * Rodar:    node server.js
 */

const express = require('express');
const sqlite3 = require('better-sqlite3');
const axios   = require('axios');
const path    = require('path');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ────────────────────────────────────────────
   BANCO DE DADOS
──────────────────────────────────────────── */
const db = new sqlite3('./blaze_data.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS double_rounds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    blaze_id   TEXT UNIQUE,
    color      TEXT,
    roll       INTEGER,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS crash_rounds (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    blaze_id    TEXT UNIQUE,
    crash_point REAL,
    created_at  TEXT
  );
`);

console.log('[DB] Banco de dados inicializado');

/* ────────────────────────────────────────────
   COLETA DE DADOS — BLAZE API
──────────────────────────────────────────── */

const BLAZE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Origin': 'https://blaze.com',
  'Referer': 'https://blaze.com/pt/games/double',
  'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Connection': 'keep-alive',
};

/* ── Double ── */
async function fetchDoubleFromBlaze() {
  try {
    const res = await axios.get(
      'https://blaze.com/api/roulette_games/recent?page=1&limit=60',
      { headers: BLAZE_HEADERS, timeout: 10000, withCredentials: false }
    );

    const rounds = res.data;
    const insert = db.prepare(`
      INSERT OR IGNORE INTO double_rounds (blaze_id, color, roll, created_at)
      VALUES (@blaze_id, @color, @roll, @created_at)
    `);

    let inserted = 0;
    for (const r of rounds) {
      // color: 0 = branco, 1-7 = vermelho, 8-14 = preto
      let color;
      if (r.roll === 0) color = 'white';
      else if (r.roll >= 1 && r.roll <= 7) color = 'red';
      else color = 'black';

      const result = insert.run({
        blaze_id:   String(r.id),
        color:      color,
        roll:       r.roll,
        created_at: r.created_at
      });
      if (result.changes) inserted++;
    }

    if (inserted) console.log(`[Double] ${inserted} novas rodadas salvas`);

  } catch (err) {
    console.error('[Double] Erro ao buscar da Blaze:', err.message);
  }
}

/* ── Crash ── */
async function fetchCrashFromBlaze() {
  try {
    const res = await axios.get(
      'https://blaze.com/api/crash_games/recent?page=1&limit=60',
      { headers: BLAZE_HEADERS, timeout: 10000, withCredentials: false }
    );

    const rounds = res.data;
    const insert = db.prepare(`
      INSERT OR IGNORE INTO crash_rounds (blaze_id, crash_point, created_at)
      VALUES (@blaze_id, @crash_point, @created_at)
    `);

    let inserted = 0;
    for (const r of rounds) {
      const result = insert.run({
        blaze_id:    String(r.id),
        crash_point: parseFloat(r.crash_point),
        created_at:  r.created_at
      });
      if (result.changes) inserted++;
    }

    if (inserted) console.log(`[Crash] ${inserted} novas rodadas salvas`);

  } catch (err) {
    console.error('[Crash] Erro ao buscar da Blaze:', err.message);
  }
}

/* Coleta a cada 5 segundos */
async function startPolling() {
  console.log('[Polling] Iniciando coleta de dados...');
  await fetchDoubleFromBlaze();
  await fetchCrashFromBlaze();
  setInterval(fetchDoubleFromBlaze, 5000);
  setInterval(fetchCrashFromBlaze,  5000);
}

/* ────────────────────────────────────────────
   API ROUTES
──────────────────────────────────────────── */
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

/* ── Double: últimas 100 rodadas ── */
app.get('/api/double/recent', (req, res) => {
  const rows = db.prepare(`
    SELECT color, roll, created_at
    FROM double_rounds
    ORDER BY created_at DESC
    LIMIT 100
  `).all();
  res.json(rows);
});

/* ── Double: histórico com filtros ── */
app.get('/api/double/history', (req, res) => {
  const { date, color } = req.query;

  // data padrão = hoje
  const target = date || new Date().toISOString().split('T')[0];

  let sql = `
    SELECT color, roll, created_at
    FROM double_rounds
    WHERE DATE(created_at) = ?
  `;
  const params = [target];

  if (color) {
    sql += ' AND color = ?';
    params.push(color);
  }

  sql += ' ORDER BY created_at DESC LIMIT 500';

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

/* ── Crash: últimas 100 velas ── */
app.get('/api/crash/recent', (req, res) => {
  const rows = db.prepare(`
    SELECT crash_point, created_at
    FROM crash_rounds
    ORDER BY created_at DESC
    LIMIT 100
  `).all();
  res.json(rows);
});

/* ── Crash: histórico com filtros ── */
app.get('/api/crash/history', (req, res) => {
  const { date, min, max } = req.query;
  const target = date || new Date().toISOString().split('T')[0];

  let sql = `
    SELECT crash_point, created_at
    FROM crash_rounds
    WHERE DATE(created_at) = ?
  `;
  const params = [target];

  if (min) { sql += ' AND crash_point >= ?'; params.push(parseFloat(min)); }
  if (max) { sql += ' AND crash_point <= ?'; params.push(parseFloat(max)); }

  sql += ' ORDER BY created_at DESC LIMIT 500';

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

/* ── Stats gerais ── */
app.get('/api/stats', (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const doubleStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN color='red'   THEN 1 ELSE 0 END) as reds,
      SUM(CASE WHEN color='black' THEN 1 ELSE 0 END) as blacks,
      SUM(CASE WHEN color='white' THEN 1 ELSE 0 END) as whites
    FROM double_rounds
    WHERE DATE(created_at) = ?
  `).get(today);

  const crashStats = db.prepare(`
    SELECT
      COUNT(*)        as total,
      AVG(crash_point) as avg,
      MAX(crash_point) as max,
      MIN(crash_point) as min
    FROM crash_rounds
    WHERE DATE(created_at) = ?
  `).get(today);

  res.json({ double: doubleStats, crash: crashStats, date: today });
});

/* ────────────────────────────────────────────
   START
──────────────────────────────────────────── */
app.listen(PORT, async () => {
  console.log(`\n🚀 BlazeTrack rodando em http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log('');
  await startPolling();
});
