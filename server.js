const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const initSqlJs = require('sql.js');

const app          = express();
const PORT         = process.env.PORT || 3000;
const API_KEY      = 'tcg_09d5d779be554c6f9c18e8ac7ba9629b';
const JUSTTCG_BASE = 'https://api.justtcg.com/v1';
const DB_FILE      = path.join(__dirname, 'cards.db');

/* ── uploads ── */
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${Math.round(Math.random()*1e6)}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only images allowed'))
});

/* ══════════════════════════════════════════════════
   sql.js helpers
══════════════════════════════════════════════════ */
let DB;
let _saveTimer;

function saveDb() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      const data = DB.export();
      fs.writeFileSync(DB_FILE, Buffer.from(data));
    } catch (e) { console.error('DB save error:', e.message); }
  }, 300);
}

function dbAll(sql, params = []) {
  const stmt = DB.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function dbGet(sql, params = []) {
  return dbAll(sql, params)[0] || null;
}

function dbRun(sql, params = []) {
  DB.run(sql, params);
  saveDb();
  const r = DB.exec('SELECT last_insert_rowid() AS id');
  return { lastInsertRowid: r[0]?.values[0]?.[0] || null };
}

/* ── JustTCG proxy helper ── */
async function jtcg(endpoint, params = {}) {
  const url = new URL(JUSTTCG_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { 'x-api-key': API_KEY } });
  if (!res.ok) throw new Error(`JustTCG ${res.status}: ${res.statusText}`);
  return res.json();
}

/* ══════════════════════════════════════════════════
   Routes
══════════════════════════════════════════════════ */
function setupRoutes() {
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/uploads', express.static(uploadsDir));

  /* ── Public ── */
  let cachedGames = null;
  app.get('/api/games', async (req, res) => {
    try {
      if (cachedGames) {
        return res.json(cachedGames);
      }
      cachedGames = await jtcg('/games');
      res.json(cachedGames);
    } catch (e) {
      console.warn('⚠️ JustTCG Games API failed, using local fallback:', e.message);
      const fallbackGames = [
        { id: 'pokemon', name: 'Pokemon' },
        { id: 'pokemon-japan', name: 'Pokemon Japan' },
        { id: 'yugioh', name: 'YuGiOh' },
        { id: 'one-piece-card-game', name: 'One Piece Card Game' },
        { id: 'riftbound-league-of-legends-trading-card-game', name: 'Riftbound: League of Legends Trading Card Game' }
      ];
      res.json({ data: fallbackGames });
    }
  });

  app.get('/api/listings', (req, res) => {
    const { game, q, in_stock } = req.query;
    let sql = `SELECT id, card_id, card_name, card_code,
                 COALESCE(custom_image, card_image) AS image,
                 price_thb, game, game_id, set_name, in_stock
               FROM listings WHERE 1=1`;
    const p = [];
    if (game)              { sql += ' AND game_id = ?';                            p.push(game); }
    if (q)                 { sql += ' AND (card_name LIKE ? OR card_code LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
    if (in_stock !== undefined) { sql += ' AND in_stock = ?';                      p.push(in_stock === 'true' ? 1 : 0); }
    sql += ' ORDER BY created_at DESC';
    res.json({ data: dbAll(sql, p) });
  });

  /* ── Admin: JustTCG search (Hybrid local database + API fallback) ── */
  app.get('/api/admin/search', async (req, res) => {
    try {
      const { q, game, set, limit = 20 } = req.query;

      // 1. Search in local cards_library first
      let localSql = 'SELECT * FROM cards_library WHERE 1=1';
      const localParams = [];

      if (game) {
        localSql += ' AND game_id = ?';
        localParams.push(game);
      }
      if (q) {
        localSql += ' AND (name LIKE ? OR card_number LIKE ?)';
        localParams.push(`%${q}%`, `%${q}%`);
      }
      if (set) {
        localSql += ' AND set_name LIKE ?';
        localParams.push(`%${set}%`);
      }
      localSql += ' LIMIT ?';
      localParams.push(parseInt(limit));

      const localRows = dbAll(localSql, localParams);

      if (localRows.length > 0) {
        console.log(`🔍 Local DB search matched ${localRows.length} cards.`);
        const formattedCards = localRows.map(card => ({
          id: card.id,
          name: card.name,
          number: card.card_number,
          rarity: card.rarity,
          tcgplayerId: card.tcgplayer_id,
          image_url: card.image_url,
          product_url: card.product_url,
          set: { name: card.set_name },
          game: { name: card.game, id: card.game_id },
          price: card.min_price_usd,
          variants_summary: card.variants_summary
        }));
        return res.json({ data: formattedCards });
      }

      // 2. Fallback to live JustTCG API if no local results found
      console.log(`🌐 Fallback to JustTCG API for search query: "${q}"`);
      res.json(await jtcg('/cards', { name: q, game, set, limit }));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /* ── Admin: listings CRUD ── */
  app.get('/api/admin/listings', (req, res) => {
    res.json({ data: dbAll('SELECT * FROM listings ORDER BY created_at DESC') });
  });

  app.post('/api/admin/listings', upload.single('custom_image'), (req, res) => {
    try {
      const {
        card_id, card_name, card_code, card_image,
        reference_price_usd, price_thb,
        seller_name, game, game_id, set_name, in_stock
      } = req.body;
      if (!card_name || !price_thb)
        return res.status(400).json({ error: 'card_name และ price_thb จำเป็น' });
      const custom_image = req.file ? `/uploads/${req.file.filename}` : null;
      const result = dbRun(`
        INSERT INTO listings
          (card_id,card_name,card_code,card_image,custom_image,
           reference_price_usd,price_thb,seller_name,game,game_id,set_name,in_stock)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [card_id||null, card_name, card_code||null, card_image||null, custom_image,
         parseFloat(reference_price_usd)||0, parseFloat(price_thb),
         seller_name||null, game||null, game_id||null, set_name||null,
         in_stock === 'false' ? 0 : 1]
      );
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/admin/listings/:id', upload.single('custom_image'), (req, res) => {
    try {
      const { id } = req.params;
      if (!dbGet('SELECT id FROM listings WHERE id = ?', [id]))
        return res.status(404).json({ error: 'ไม่พบรายการ' });
      const { card_name, card_code, price_thb, seller_name, in_stock } = req.body;
      const stock = in_stock === 'true' ? 1 : 0;
      if (req.file) {
        dbRun(`UPDATE listings SET card_name=?,card_code=?,price_thb=?,seller_name=?,
               in_stock=?,custom_image=?,updated_at=datetime('now') WHERE id=?`,
          [card_name, card_code||null, parseFloat(price_thb), seller_name||null,
           stock, `/uploads/${req.file.filename}`, id]);
      } else {
        dbRun(`UPDATE listings SET card_name=?,card_code=?,price_thb=?,seller_name=?,
               in_stock=?,updated_at=datetime('now') WHERE id=?`,
          [card_name, card_code||null, parseFloat(price_thb), seller_name||null, stock, id]);
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/admin/listings/:id', (req, res) => {
    dbRun('DELETE FROM listings WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  /* ── Categories: รวมจาก listings + cards_library ── */
  app.get('/api/categories', (req, res) => {
    const rows = dbAll(`
      SELECT game, game_id, SUM(cnt) AS count FROM (
        SELECT game, game_id, COUNT(*) AS cnt FROM listings
        WHERE game IS NOT NULL AND game != '' GROUP BY game_id
        UNION ALL
        SELECT game, game_id, COUNT(*) AS cnt FROM cards_library
        WHERE game IS NOT NULL AND game != '' GROUP BY game_id
      ) GROUP BY game_id ORDER BY count DESC
    `);
    res.json({ data: rows });
  });

  /* ── Combined search: listings + cards_library ── */
  app.get('/api/search', (req, res) => {
    const { q = '', game = '', limit = 60, offset = 0 } = req.query;
    const lim  = Math.min(parseInt(limit)  || 60, 200);
    const off  = parseInt(offset) || 0;
    const like = q    ? `%${q}%`  : null;
    const gid  = game ? game      : null;

    const rows = dbAll(`
      SELECT listing_id, card_name, card_code, image,
             price_thb, game, game_id, set_name, in_stock, is_listed
      FROM (
        /* ── การ์ดในรายการขาย ── */
        SELECT l.id            AS listing_id,
               l.card_name,
               l.card_code,
               COALESCE(l.custom_image, l.card_image) AS image,
               l.price_thb,
               l.game,  l.game_id,  l.set_name,
               l.in_stock,
               1 AS is_listed
        FROM listings l
        WHERE (? IS NULL OR l.card_name LIKE ? OR l.card_code LIKE ?)
          AND (? IS NULL OR l.game_id = ?)

        UNION ALL

        /* ── การ์ดในคลัง ยังไม่ได้ลงขาย → in_stock = 0 ── */
        SELECT NULL               AS listing_id,
               cl.name            AS card_name,
               cl.card_number     AS card_code,
               cl.image_url       AS image,
               NULL               AS price_thb,
               cl.game, cl.game_id, cl.set_name,
               0                  AS in_stock,
               0                  AS is_listed
        FROM cards_library cl
        WHERE cl.id NOT IN (
          SELECT card_id FROM listings WHERE card_id IS NOT NULL
        )
          AND (? IS NULL OR cl.name LIKE ? OR cl.card_number LIKE ?)
          AND (? IS NULL OR cl.game_id = ?)
      )
      ORDER BY is_listed DESC, card_name ASC
      LIMIT ? OFFSET ?
    `, [like,like,like, gid,gid,
        like,like,like, gid,gid,
        lim, off]);

    /* count total for pagination */
    const total = (dbAll(`
      SELECT COUNT(*) AS c FROM (
        SELECT id FROM listings
        WHERE (? IS NULL OR card_name LIKE ? OR card_code LIKE ?)
          AND (? IS NULL OR game_id = ?)
        UNION ALL
        SELECT id FROM cards_library
        WHERE id NOT IN (SELECT card_id FROM listings WHERE card_id IS NOT NULL)
          AND (? IS NULL OR name LIKE ? OR card_number LIKE ?)
          AND (? IS NULL OR game_id = ?)
      )
    `, [like,like,like, gid,gid,
        like,like,like, gid,gid])[0]?.c) || 0;

    res.json({ data: rows, total, limit: lim, offset: off });
  });

  /* ── Image proxy (bypass CORS / hotlink protection) ── */
  app.get('/api/image-proxy', async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) return res.status(400).send('missing url');
      const decoded = decodeURIComponent(url);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      const r = await fetch(decoded, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer':    'https://www.google.com/'
        }
      });
      clearTimeout(timer);

      if (!r.ok) return res.status(r.status).send('upstream error');
      const ct = r.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const buf = await r.arrayBuffer();
      res.send(Buffer.from(buf));
    } catch (e) {
      if (e.name === 'AbortError') return res.status(504).send('proxy timeout');
      res.status(500).send('proxy error');
    }
  });

  /* ── Settings ── */
  app.get('/api/settings', (req, res) => {
    const rows = dbAll('SELECT key, value FROM settings');
    const obj = {};
    rows.forEach(r => (obj[r.key] = r.value));
    res.json(obj);
  });

  app.put('/api/settings', (req, res) => {
    for (const [k, v] of Object.entries(req.body))
      dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, String(v)]);
    res.json({ success: true });
  });
}

/* ══════════════════════════════════════════════════
   Start
══════════════════════════════════════════════════ */
async function start() {
  console.log('⏳ Initializing database...');
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    DB = new SQL.Database(fs.readFileSync(DB_FILE));
    console.log('📂 Loaded existing database');
  } else {
    DB = new SQL.Database();
    console.log('🆕 Created new database');
  }

  DB.exec(`
    CREATE TABLE IF NOT EXISTS listings (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id             TEXT,
      card_name           TEXT NOT NULL,
      card_code           TEXT,
      card_image          TEXT,
      custom_image        TEXT,
      reference_price_usd REAL    DEFAULT 0,
      price_thb           REAL    NOT NULL,
      seller_name         TEXT,
      game                TEXT,
      game_id             TEXT,
      set_name            TEXT,
      in_stock            INTEGER DEFAULT 1,
      created_at          TEXT    DEFAULT (datetime('now')),
      updated_at          TEXT    DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards_library (
      id                  TEXT PRIMARY KEY,
      tcgplayer_id        TEXT,
      name                TEXT NOT NULL,
      card_number         TEXT,
      set_name            TEXT,
      rarity              TEXT,
      image_url           TEXT,
      product_url         TEXT,
      min_price_usd       REAL DEFAULT 0,
      max_price_usd       REAL DEFAULT 0,
      game                TEXT,
      game_id             TEXT,
      variants_summary    TEXT,
      created_at          TEXT DEFAULT (datetime('now'))
    );
  `);

  const defaults = {
    usd_thb_rate: '36',
    shop_name:    'TCG SHOP',
    banner_text:  'ร้านฝากขายการ์ดสะสม คุณภาพเยี่ยม ราคาดี'
  };
  for (const [k, v] of Object.entries(defaults))
    DB.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [k, v]);

  saveDb();
  setupRoutes();

  app.listen(PORT, () => {
    console.log(`\n✅  Server:  http://localhost:${PORT}`);
    console.log(`🛠️  Admin:   http://localhost:${PORT}/admin.html\n`);
  });
}

start().catch(e => { console.error('Startup error:', e); process.exit(1); });
