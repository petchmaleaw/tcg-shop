const express   = require('express');
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');
const XLSX      = require('xlsx');
const initSqlJs = require('sql.js');

const app          = express();
const PORT         = process.env.PORT || 3000;
const API_KEY      = 'tcg_09d5d779be554c6f9c18e8ac7ba9629b';
const JUSTTCG_BASE = 'https://api.justtcg.com/v1';
const DB_FILE      = path.join(__dirname, 'cards.db');

/* ── Uploads ── */
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const diskStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${Math.round(Math.random()*1e6)}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(null, false)
});

const uploadXlsx = multer({
  storage: diskStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.originalname.match(/\.(xlsx|xls)$/i) ? cb(null, true) : cb(new Error('Only .xlsx files allowed'))
});

/* ══════════════════════════════════════════════════
   sql.js helpers
══════════════════════════════════════════════════ */
let DB;
let _saveTimer;

function saveDb() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DB_FILE, Buffer.from(DB.export())); }
    catch (e) { console.error('DB save error:', e.message); }
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
function dbGet(sql, params = []) { return dbAll(sql, params)[0] || null; }
function dbRun(sql, params = []) {
  DB.run(sql, params);
  saveDb();
  const r = DB.exec('SELECT last_insert_rowid() AS id');
  return { lastInsertRowid: r[0]?.values[0]?.[0] || null };
}

/* ── JustTCG proxy ── */
async function jtcg(endpoint, params = {}) {
  const url = new URL(JUSTTCG_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { 'x-api-key': API_KEY } });
  if (!res.ok) throw new Error(`JustTCG ${res.status}`);
  return res.json();
}

/* ══════════════════════════════════════════════════
   Auth helpers
══════════════════════════════════════════════════ */
const adminSessions  = new Map();
const memberSessions = new Map();

function hashPwd(pw) {
  return crypto.pbkdf2Sync(pw, 'tcg-shop-salt-v1', 10000, 32, 'sha256').toString('hex');
}
function genToken() { return crypto.randomBytes(32).toString('hex'); }

function getCookies(req) {
  const c = {};
  (req.headers.cookie || '').split(';').forEach(s => {
    const i = s.indexOf('=');
    if (i > 0) c[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  });
  return c;
}

function requireAdmin(req, res, next) {
  const token = getCookies(req).admin_token;
  const s = token && adminSessions.get(token);
  if (!s || Date.now() > s.expires) {
    if (token) adminSessions.delete(token);
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ admin' });
  }
  next();
}

function optionalMember(req, res, next) {
  const token = getCookies(req).member_token;
  const s = token && memberSessions.get(token);
  if (s && Date.now() <= s.expires) req.memberId = s.memberId;
  next();
}

function requireMember(req, res, next) {
  const token = getCookies(req).member_token;
  const s = token && memberSessions.get(token);
  if (!s || Date.now() > s.expires) {
    if (token) memberSessions.delete(token);
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  }
  req.memberId = s.memberId;
  next();
}

/* ══════════════════════════════════════════════════
   Routes
══════════════════════════════════════════════════ */
function setupRoutes() {
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  /* Protect /admin.html — redirect to login if not authenticated */
  app.use('/admin.html', (req, res, next) => {
    const token = getCookies(req).admin_token;
    const s = token && adminSessions.get(token);
    if (!s || Date.now() > s.expires) return res.redirect('/admin-login.html');
    next();
  });

  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/uploads', express.static(uploadsDir));

  /* ── Admin auth ── */
  app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const stored = dbGet("SELECT value FROM settings WHERE key='admin_password_hash'");
    if (hashPwd(password) !== (stored?.value || hashPwd('admin')))
      return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
    const token = genToken();
    adminSessions.set(token, { expires: Date.now() + 8 * 3600 * 1000 });
    res.setHeader('Set-Cookie', `admin_token=${token}; HttpOnly; Path=/; Max-Age=28800; SameSite=Lax`);
    res.json({ success: true });
  });

  app.post('/api/admin/logout', (req, res) => {
    adminSessions.delete(getCookies(req).admin_token);
    res.setHeader('Set-Cookie', 'admin_token=; HttpOnly; Path=/; Max-Age=0');
    res.json({ success: true });
  });

  app.get('/api/admin/me', (req, res) => {
    const token = getCookies(req).admin_token;
    const s = token && adminSessions.get(token);
    res.json({ authenticated: !!(s && Date.now() <= s.expires) });
  });

  app.put('/api/admin/password', requireAdmin, (req, res) => {
    const { current_password, new_password } = req.body;
    const stored = dbGet("SELECT value FROM settings WHERE key='admin_password_hash'");
    if (hashPwd(current_password) !== (stored?.value || hashPwd('admin')))
      return res.status(401).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    dbRun("INSERT OR REPLACE INTO settings(key,value)VALUES('admin_password_hash',?)", [hashPwd(new_password)]);
    res.json({ success: true });
  });

  /* ── Member auth ── */
  function validatePasswordStrength(pw) {
    if (!pw || pw.length < 6) return 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
    if (!/[A-Z]/.test(pw)) return 'รหัสผ่านต้องมีตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว';
    if (!/[a-z]/.test(pw)) return 'รหัสผ่านต้องมีตัวพิมพ์เล็กอย่างน้อย 1 ตัว';
    if (!/[0-9]/.test(pw)) return 'รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว';
    return null;
  }

  app.post('/api/auth/register', (req, res) => {
    const { username, name, phone, address, password } = req.body;
    if (!username || !name || !password) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username))
      return res.status(400).json({ error: 'Username ใช้ได้เฉพาะ a-z, A-Z, 0-9, _ และ 3-30 ตัว' });
    if (dbGet('SELECT id FROM members WHERE username=?', [username]))
      return res.status(400).json({ error: 'Username นี้ถูกใช้แล้ว' });
    const pwErr = validatePasswordStrength(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    const { lastInsertRowid } = dbRun(
      'INSERT INTO members(username,name,phone,address,password_hash)VALUES(?,?,?,?,?)',
      [username, name, phone || null, address || null, hashPwd(password)]
    );
    const token = genToken();
    memberSessions.set(token, { memberId: lastInsertRowid, expires: Date.now() + 7 * 86400 * 1000 });
    res.setHeader('Set-Cookie', `member_token=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`);
    res.json({ success: true, name });
  });

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const m = dbGet('SELECT * FROM members WHERE username=?', [username]);
    if (!m || hashPwd(password) !== m.password_hash)
      return res.status(401).json({ error: 'Username หรือรหัสผ่านไม่ถูกต้อง' });
    const token = genToken();
    memberSessions.set(token, { memberId: m.id, expires: Date.now() + 7 * 86400 * 1000 });
    res.setHeader('Set-Cookie', `member_token=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`);
    res.json({ success: true, name: m.name, username: m.username, phone: m.phone });
  });

  app.post('/api/auth/logout', (req, res) => {
    memberSessions.delete(getCookies(req).member_token);
    res.setHeader('Set-Cookie', 'member_token=; HttpOnly; Path=/; Max-Age=0');
    res.json({ success: true });
  });

  app.get('/api/auth/me', optionalMember, (req, res) => {
    if (!req.memberId) return res.json({ authenticated: false });
    const m = dbGet('SELECT id,username,name,phone,address FROM members WHERE id=?', [req.memberId]);
    res.json({ authenticated: true, ...m });
  });

  /* ── Member: profile ── */
  app.put('/api/member/profile', requireMember, (req, res) => {
    const { name, phone, address } = req.body;
    if (!name) return res.status(400).json({ error: 'ชื่อ-นามสกุลจำเป็น' });
    dbRun('UPDATE members SET name=?,phone=?,address=? WHERE id=?',
      [name, phone || null, address || null, req.memberId]);
    res.json({ success: true });
  });

  app.put('/api/member/password', requireMember, (req, res) => {
    const { current_password, new_password } = req.body;
    const m = dbGet('SELECT password_hash FROM members WHERE id=?', [req.memberId]);
    if (!m || hashPwd(current_password) !== m.password_hash)
      return res.status(401).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    if (!new_password || new_password.length < 4)
      return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร' });
    dbRun('UPDATE members SET password_hash=? WHERE id=?', [hashPwd(new_password), req.memberId]);
    res.json({ success: true });
  });

  /* ── Member: order history ── */
  app.get('/api/member/orders', requireMember, (req, res) => {
    const orders = dbAll('SELECT * FROM orders WHERE member_id=? ORDER BY created_at DESC', [req.memberId]);
    orders.forEach(o => o.items = dbAll('SELECT * FROM order_items WHERE order_id=?', [o.id]));
    res.json({ data: orders });
  });

  /* ── Public APIs ── */
  let cachedGames = null;
  app.get('/api/games', async (req, res) => {
    try {
      if (cachedGames) return res.json(cachedGames);
      cachedGames = await jtcg('/games');
      res.json(cachedGames);
    } catch {
      res.json({ data: [
        { id: 'pokemon', name: 'Pokemon' },
        { id: 'pokemon-japan', name: 'Pokemon Japan' },
        { id: 'yugioh', name: 'YuGiOh' },
        { id: 'one-piece-card-game', name: 'One Piece Card Game' },
        { id: 'riftbound-league-of-legends-trading-card-game', name: 'Riftbound: League of Legends Trading Card Game' }
      ]});
    }
  });

  app.get('/api/listings', (req, res) => {
    const { game, q, in_stock } = req.query;
    let sql = `SELECT id,card_id,card_name,card_code,COALESCE(custom_image,card_image) AS image,
               price_thb,game,game_id,set_name,in_stock,stock_qty FROM listings WHERE 1=1`;
    const p = [];
    if (game)                { sql += ' AND game_id=?';                              p.push(game); }
    if (q)                   { sql += ' AND (card_name LIKE ? OR card_code LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
    if (in_stock !== undefined) { sql += ' AND in_stock=?';                          p.push(in_stock === 'true' ? 1 : 0); }
    res.json({ data: dbAll(sql + ' ORDER BY created_at DESC', p) });
  });

  app.get('/api/categories', (req, res) => {
    res.json({ data: dbAll(`
      SELECT game, game_id, SUM(cnt) AS count FROM (
        SELECT game, game_id, COUNT(*) AS cnt FROM listings
        WHERE game IS NOT NULL AND game!='' GROUP BY game_id
        UNION ALL
        SELECT game, game_id, COUNT(*) AS cnt FROM cards_library
        WHERE game IS NOT NULL AND game!='' GROUP BY game_id
      ) GROUP BY game_id ORDER BY count DESC`) });
  });

  app.get('/api/search', (req, res) => {
    const { q = '', game = '', limit = 60, offset = 0 } = req.query;
    const lim  = Math.min(parseInt(limit) || 60, 200);
    const off  = parseInt(offset) || 0;
    const like = q    ? `%${q}%` : null;
    const gid  = game ? game     : null;

    const rows = dbAll(`
      SELECT listing_id,card_name,card_code,image,price_thb,game,game_id,set_name,in_stock,is_listed,stock_qty
      FROM (
        SELECT l.id AS listing_id,l.card_name,l.card_code,
               COALESCE(l.custom_image,l.card_image) AS image,
               l.price_thb,l.game,l.game_id,l.set_name,l.in_stock,1 AS is_listed,l.stock_qty
        FROM listings l
        WHERE (? IS NULL OR l.card_name LIKE ? OR l.card_code LIKE ?)
          AND (? IS NULL OR l.game_id=?)
        UNION ALL
        SELECT NULL,cl.name,cl.card_number,cl.image_url,NULL,cl.game,cl.game_id,cl.set_name,0,0,0
        FROM cards_library cl
        WHERE cl.id NOT IN (SELECT card_id FROM listings WHERE card_id IS NOT NULL)
          AND (? IS NULL OR cl.name LIKE ? OR cl.card_number LIKE ?)
          AND (? IS NULL OR cl.game_id=?)
      )
      ORDER BY is_listed DESC, card_name ASC
      LIMIT ? OFFSET ?
    `, [like,like,like, gid,gid, like,like,like, gid,gid, lim, off]);

    const total = (dbAll(`
      SELECT COUNT(*) AS c FROM (
        SELECT id FROM listings
        WHERE (? IS NULL OR card_name LIKE ? OR card_code LIKE ?) AND (? IS NULL OR game_id=?)
        UNION ALL
        SELECT id FROM cards_library
        WHERE id NOT IN (SELECT card_id FROM listings WHERE card_id IS NOT NULL)
          AND (? IS NULL OR name LIKE ? OR card_number LIKE ?) AND (? IS NULL OR game_id=?)
      )
    `, [like,like,like, gid,gid, like,like,like, gid,gid])[0]?.c) || 0;

    res.json({ data: rows, total, limit: lim, offset: off });
  });

  /* ── Card listings (all prices for one card) ── */
  app.get('/api/card-listings', (req, res) => {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'name required' });
    const rows = dbAll(`
      SELECT l.id AS listing_id,
             COALESCE(l.custom_image,l.card_image,cl.image_url) AS image,
             l.card_name, l.card_code, l.price_thb,
             l.seller_name, l.game, l.game_id, l.set_name,
             l.in_stock, l.stock_qty
      FROM listings l
      LEFT JOIN cards_library cl ON l.card_id = cl.id
      WHERE LOWER(l.card_name) = LOWER(?) AND l.in_stock=1 AND (l.stock_qty IS NULL OR l.stock_qty>0)
      ORDER BY l.price_thb ASC
    `, [name]);
    /* Also get card meta from library if exists */
    const meta = dbGet(`SELECT image_url,game,set_name FROM cards_library WHERE LOWER(name)=LOWER(?) LIMIT 1`, [name]);
    res.json({ data: rows, meta: meta || null });
  });

  /* ── Cart validate ── */
  app.post('/api/cart/validate', (req, res) => {
    const items = req.body.items || [];
    res.json({ items: items.map(item => {
      const l = dbGet(
        'SELECT id,card_name,price_thb,in_stock,stock_qty,COALESCE(custom_image,card_image) AS image FROM listings WHERE id=?',
        [item.id]
      );
      if (!l) return { ...item, status: 'not_found', available: 0 };
      if (!l.in_stock || (l.stock_qty || 0) < 1)
        return { ...item, listing: l, status: 'out_of_stock', available: 0 };
      const qty = Math.min(item.qty, l.stock_qty);
      return { ...item, listing: l, status: qty < item.qty ? 'reduced' : 'ok', available: l.stock_qty, qty };
    })});
  });

  /* ── Orders (public) ── */
  app.post('/api/orders', optionalMember, (req, res) => {
    const { member_name, member_email, member_phone, member_address, items, note } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'ไม่มีสินค้าในคำสั่งซื้อ' });
    const total = items.reduce((s, i) => s + i.price_thb * i.qty, 0);
    let addr = member_address || null;
    if (!addr && req.memberId) {
      const m = dbGet('SELECT address FROM members WHERE id=?', [req.memberId]);
      addr = m?.address || null;
    }
    const { lastInsertRowid: orderId } = dbRun(
      'INSERT INTO orders(member_id,member_name,member_email,member_phone,member_address,total_thb,note)VALUES(?,?,?,?,?,?,?)',
      [req.memberId || null, member_name || null, member_email || null, member_phone || null, addr, total, note || null]
    );
    items.forEach(item => dbRun(
      'INSERT INTO order_items(order_id,listing_id,card_name,card_code,price_thb,qty,image)VALUES(?,?,?,?,?,?,?)',
      [orderId, item.id, item.card_name, item.card_code || '', item.price_thb, item.qty, item.image || '']
    ));
    res.json({ success: true, orderId });
  });

  /* ── Admin: orders ── */
  function recalcOrderTotal(orderId) {
    const items = dbAll('SELECT price_thb,qty FROM order_items WHERE order_id=?', [orderId]);
    const total = items.reduce((s, i) => s + i.price_thb * i.qty, 0);
    dbRun('UPDATE orders SET total_thb=? WHERE id=?', [total, orderId]);
  }

  function fetchOrderWithItems(orderId) {
    const o = dbGet('SELECT * FROM orders WHERE id=?', [orderId]);
    if (!o) return null;
    o.items = dbAll(`
      SELECT oi.*, COALESCE(l.stock_qty,0) AS current_stock,
             COALESCE(l.card_name, oi.card_name) AS card_name
      FROM order_items oi
      LEFT JOIN listings l ON oi.listing_id = l.id
      WHERE oi.order_id=?`, [orderId]);
    return o;
  }

  app.get('/api/admin/orders', requireAdmin, (req, res) => {
    const orders = dbAll('SELECT * FROM orders ORDER BY created_at DESC');
    orders.forEach(o => o.items = dbAll('SELECT * FROM order_items WHERE order_id=?', [o.id]));
    res.json({ data: orders });
  });

  app.get('/api/admin/orders/:id', requireAdmin, (req, res) => {
    const o = fetchOrderWithItems(req.params.id);
    if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์' });
    res.json(o);
  });

  app.put('/api/admin/orders/:id', requireAdmin, (req, res) => {
    const { status, note } = req.body;
    dbRun('UPDATE orders SET status=?,note=? WHERE id=?', [status, note || null, req.params.id]);
    res.json({ success: true });
  });

  /* ── Admin: order items ── */
  app.put('/api/admin/order-items/:itemId', requireAdmin, (req, res) => {
    const qty = parseInt(req.body.qty);
    if (!qty || qty < 1) return res.status(400).json({ error: 'จำนวนต้องมากกว่า 0' });
    const item = dbGet('SELECT * FROM order_items WHERE id=?', [req.params.itemId]);
    if (!item) return res.status(404).json({ error: 'ไม่พบรายการ' });
    if (item.listing_id) {
      const l = dbGet('SELECT stock_qty FROM listings WHERE id=?', [item.listing_id]);
      if (l && qty > l.stock_qty)
        return res.status(400).json({ error: `สต๊อกมีเพียง ${l.stock_qty} ชิ้น` });
    }
    dbRun('UPDATE order_items SET qty=? WHERE id=?', [qty, req.params.itemId]);
    recalcOrderTotal(item.order_id);
    res.json({ success: true });
  });

  app.delete('/api/admin/order-items/:itemId', requireAdmin, (req, res) => {
    const item = dbGet('SELECT order_id FROM order_items WHERE id=?', [req.params.itemId]);
    if (!item) return res.status(404).json({ error: 'ไม่พบรายการ' });
    dbRun('DELETE FROM order_items WHERE id=?', [req.params.itemId]);
    recalcOrderTotal(item.order_id);
    res.json({ success: true });
  });

  app.post('/api/admin/orders/:orderId/items', requireAdmin, (req, res) => {
    const { listing_id, qty } = req.body;
    const n = parseInt(qty);
    if (!listing_id || !n || n < 1) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
    const l = dbGet('SELECT * FROM listings WHERE id=?', [listing_id]);
    if (!l) return res.status(404).json({ error: 'ไม่พบสินค้า' });
    if (n > (l.stock_qty || 0)) return res.status(400).json({ error: `สต๊อกมีเพียง ${l.stock_qty || 0} ชิ้น` });
    dbRun(
      'INSERT INTO order_items(order_id,listing_id,card_name,card_code,price_thb,qty,image)VALUES(?,?,?,?,?,?,?)',
      [req.params.orderId, listing_id, l.card_name, l.card_code||'',
       l.price_thb, n, l.custom_image||l.card_image||'']
    );
    recalcOrderTotal(req.params.orderId);
    res.json({ success: true });
  });

  app.post('/api/admin/orders/:id/deduct-stock', requireAdmin, (req, res) => {
    const orderId = req.params.id;
    if (!dbGet('SELECT id FROM orders WHERE id=?', [orderId]))
      return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อ' });
    const errors = [];
    dbAll('SELECT * FROM order_items WHERE order_id=?', [orderId]).forEach(item => {
      if (!item.listing_id) return;
      const l = dbGet('SELECT stock_qty FROM listings WHERE id=?', [item.listing_id]);
      if (!l) { errors.push(`ไม่พบ listing ID ${item.listing_id}`); return; }
      const newQty = Math.max(0, (l.stock_qty || 0) - item.qty);
      dbRun("UPDATE listings SET stock_qty=?,in_stock=?,updated_at=datetime('now') WHERE id=?",
        [newQty, newQty > 0 ? 1 : 0, item.listing_id]);
    });
    dbRun("UPDATE orders SET status='confirmed' WHERE id=?", [orderId]);
    res.json({ success: true, errors });
  });

  /* ── Admin: listings CRUD ── */
  app.get('/api/admin/listings', requireAdmin, (req, res) => {
    const { q, limit } = req.query;
    const lim = Math.min(parseInt(limit) || 200, 200);
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      return res.json({ data: dbAll(
        'SELECT * FROM listings WHERE card_name LIKE ? OR card_code LIKE ? ORDER BY card_name LIMIT ?',
        [like, like, lim]
      )});
    }
    res.json({ data: dbAll('SELECT * FROM listings ORDER BY created_at DESC LIMIT ?', [lim]) });
  });

  app.post('/api/admin/listings', requireAdmin, upload.single('custom_image'), (req, res) => {
    try {
      const { card_id, card_name, card_code, card_image, reference_price_usd,
              price_thb, seller_name, game, game_id, set_name, in_stock, stock_qty,
              foil, condition } = req.body;
      if (!card_name || !price_thb) return res.status(400).json({ error: 'card_name และ price_thb จำเป็น' });
      const custom_image = req.file ? `/uploads/${req.file.filename}` : null;
      const result = dbRun(`
        INSERT INTO listings(card_id,card_name,card_code,card_image,custom_image,
          reference_price_usd,price_thb,seller_name,game,game_id,set_name,in_stock,stock_qty,foil,condition)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [card_id||null, card_name, card_code||null, card_image||null, custom_image,
         parseFloat(reference_price_usd)||0, parseFloat(price_thb),
         seller_name||null, game||null, game_id||null, set_name||null,
         in_stock === 'false' ? 0 : 1, parseInt(stock_qty) || 1,
         foil === 'true' || foil === '1' ? 1 : 0, condition || null]);
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/admin/listings/:id', requireAdmin, upload.single('custom_image'), (req, res) => {
    try {
      const { id } = req.params;
      if (!dbGet('SELECT id FROM listings WHERE id=?', [id]))
        return res.status(404).json({ error: 'ไม่พบรายการ' });
      const { card_name, card_code, price_thb, seller_name, in_stock, stock_qty } = req.body;
      const stockVal = in_stock === 'true' ? 1 : 0;
      const qtyVal   = parseInt(stock_qty) || 0;
      if (req.file) {
        dbRun(`UPDATE listings SET card_name=?,card_code=?,price_thb=?,seller_name=?,in_stock=?,
               stock_qty=?,custom_image=?,updated_at=datetime('now') WHERE id=?`,
          [card_name, card_code||null, parseFloat(price_thb), seller_name||null,
           stockVal, qtyVal, `/uploads/${req.file.filename}`, id]);
      } else {
        dbRun(`UPDATE listings SET card_name=?,card_code=?,price_thb=?,seller_name=?,
               in_stock=?,stock_qty=?,updated_at=datetime('now') WHERE id=?`,
          [card_name, card_code||null, parseFloat(price_thb), seller_name||null, stockVal, qtyVal, id]);
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/admin/listings/:id', requireAdmin, (req, res) => {
    dbRun('DELETE FROM listings WHERE id=?', [req.params.id]);
    res.json({ success: true });
  });

  /* ── Admin: search (hybrid) ── */
  app.get('/api/admin/search', requireAdmin, async (req, res) => {
    try {
      const { q, game, set, limit = 20 } = req.query;
      let sql = 'SELECT * FROM cards_library WHERE 1=1';
      const p = [];
      if (game) { sql += ' AND game_id=?';                               p.push(game); }
      if (q)    { sql += ' AND (name LIKE ? OR card_number LIKE ?)';     p.push(`%${q}%`, `%${q}%`); }
      if (set)  { sql += ' AND set_name LIKE ?';                         p.push(`%${set}%`); }
      sql += ' LIMIT ?'; p.push(parseInt(limit));
      const local = dbAll(sql, p);
      if (local.length) return res.json({ data: local.map(c => ({
        id: c.id, name: c.name, number: c.card_number, rarity: c.rarity,
        tcgplayerId: c.tcgplayer_id, image_url: c.image_url, product_url: c.product_url,
        set: { name: c.set_name }, game: { name: c.game, id: c.game_id },
        price: c.min_price_usd, variants_summary: c.variants_summary
      }))});
      res.json(await jtcg('/cards', { name: q, game, set, limit }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── Admin: import XLSX ── */
  app.post('/api/admin/import-xlsx', requireAdmin, uploadXlsx.single('xlsx_file'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์' });
      const wb    = XLSX.readFile(req.file.path);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows  = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      const getCol = (r, ...keys) => {
        for (const k of keys) if (r[k] !== undefined && String(r[k]).trim()) return String(r[k]).trim();
        return '';
      };

      const stmt = DB.prepare(`INSERT INTO listings
        (card_id,card_name,card_code,card_image,price_thb,seller_name,
         game,game_id,set_name,in_stock,stock_qty)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`);

      let inserted = 0, skipped = 0;
      const not_found = [];

      for (const r of rows) {
        const cardName   = getCol(r,'ชื่อการ์ด','card_name','Card Name','name');
        const priceRaw   = getCol(r,'ราคา','ราคาขาย','price','price_thb','Price');
        const qtyRaw     = getCol(r,'จำนวน','สต๊อก','qty','stock_qty','Qty','Stock');
        const sellerName = getCol(r,'ชื่อผู้ขาย','seller','seller_name','Seller') || 'Admin';

        if (!cardName || !priceRaw) { skipped++; continue; }
        const price = parseFloat(priceRaw);
        const qty   = parseInt(qtyRaw) || 1;
        if (isNaN(price) || price < 0) { skipped++; continue; }

        /* Look up card info from library — exact then LIKE */
        let lib = dbGet('SELECT * FROM cards_library WHERE LOWER(name)=LOWER(?)', [cardName]);
        if (!lib) lib = dbGet('SELECT * FROM cards_library WHERE LOWER(name) LIKE LOWER(?)', [`%${cardName}%`]);

        stmt.run([
          lib?.id || null,
          lib?.name || cardName,
          lib?.card_number || null,
          lib?.image_url || null,
          price,
          sellerName,
          lib?.game || null,
          lib?.game_id || null,
          lib?.set_name || null,
          qty > 0 ? 1 : 0,
          qty,
        ]);
        if (!lib) not_found.push(cardName);
        inserted++;
      }
      stmt.free();
      try { fs.unlinkSync(req.file.path); } catch {}
      fs.writeFileSync(DB_FILE, Buffer.from(DB.export()));
      res.json({ success: true, inserted, skipped, total: rows.length, not_found });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── Admin: bulk add listings ── */
  app.post('/api/admin/listings/bulk', requireAdmin, (req, res) => {
    try {
      const { seller_name, cards } = req.body;
      if (!Array.isArray(cards) || !cards.length)
        return res.status(400).json({ error: 'cards array จำเป็น' });
      const stmt = DB.prepare(`INSERT INTO listings
        (card_id,card_name,card_code,card_image,price_thb,seller_name,
         game,game_id,set_name,in_stock,stock_qty,foil,condition)
        VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)`);
      let inserted = 0, skipped = 0;
      for (const c of cards) {
        if (!c.card_name || !c.price_thb) { skipped++; continue; }
        const price = parseFloat(c.price_thb);
        if (isNaN(price) || price < 0) { skipped++; continue; }
        let lib = dbGet('SELECT * FROM cards_library WHERE LOWER(name)=LOWER(?)', [c.card_name]);
        if (!lib) lib = dbGet('SELECT * FROM cards_library WHERE LOWER(name) LIKE LOWER(?)', [`%${c.card_name}%`]);
        stmt.run([
          lib?.id || null, lib?.name || c.card_name, lib?.card_number || null,
          lib?.image_url || null, price, seller_name || null,
          lib?.game || null, lib?.game_id || null, lib?.set_name || null,
          parseInt(c.qty) || 1, c.foil ? 1 : 0, c.condition || null,
        ]);
        inserted++;
      }
      stmt.free();
      saveDb();
      res.json({ success: true, inserted, skipped });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── Image proxy ── */
  app.get('/api/image-proxy', async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) return res.status(400).send('missing url');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const r = await fetch(decodeURIComponent(url), {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.google.com/' }
      });
      clearTimeout(timer);
      if (!r.ok) return res.status(r.status).send('upstream error');
      res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      if (e.name === 'AbortError') return res.status(504).send('proxy timeout');
      res.status(500).send('proxy error');
    }
  });

  /* ── Settings ── */
  app.get('/api/settings', (req, res) => {
    const obj = {};
    dbAll("SELECT key,value FROM settings WHERE key!='admin_password_hash'")
      .forEach(r => (obj[r.key] = r.value));
    res.json(obj);
  });

  app.put('/api/settings', requireAdmin, (req, res) => {
    for (const [k, v] of Object.entries(req.body))
      if (k !== 'admin_password_hash')
        dbRun('INSERT OR REPLACE INTO settings(key,value)VALUES(?,?)', [k, String(v)]);
    res.json({ success: true });
  });
}

/* ══════════════════════════════════════════════════
   Start
══════════════════════════════════════════════════ */
async function start() {
  console.log('⏳ Initializing database...');
  const SQL = await initSqlJs();
  DB = fs.existsSync(DB_FILE)
    ? new SQL.Database(fs.readFileSync(DB_FILE))
    : new SQL.Database();
  console.log(fs.existsSync(DB_FILE) ? '📂 Loaded existing database' : '🆕 Created new database');

  DB.exec(`
    CREATE TABLE IF NOT EXISTS listings(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT, card_name TEXT NOT NULL, card_code TEXT,
      card_image TEXT, custom_image TEXT,
      reference_price_usd REAL DEFAULT 0, price_thb REAL NOT NULL,
      seller_name TEXT, game TEXT, game_id TEXT, set_name TEXT,
      in_stock INTEGER DEFAULT 1, stock_qty INTEGER DEFAULT 1,
      created_at TEXT DEFAULT(datetime('now')), updated_at TEXT DEFAULT(datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cards_library(
      id TEXT PRIMARY KEY, tcgplayer_id TEXT, name TEXT NOT NULL,
      card_number TEXT, set_name TEXT, rarity TEXT,
      image_url TEXT, product_url TEXT,
      min_price_usd REAL DEFAULT 0, max_price_usd REAL DEFAULT 0,
      game TEXT, game_id TEXT, variants_summary TEXT,
      created_at TEXT DEFAULT(datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS members(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      phone TEXT, password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT(datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS orders(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER, member_name TEXT, member_email TEXT, member_phone TEXT,
      total_thb REAL, status TEXT DEFAULT 'pending', note TEXT,
      created_at TEXT DEFAULT(datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS order_items(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL, listing_id INTEGER,
      card_name TEXT, card_code TEXT, price_thb REAL, qty INTEGER DEFAULT 1, image TEXT
    );
  `);

  try { DB.exec('ALTER TABLE listings ADD COLUMN stock_qty INTEGER DEFAULT 1'); } catch {}
  try { DB.exec('ALTER TABLE listings ADD COLUMN foil INTEGER DEFAULT 0'); } catch {}
  try { DB.exec('ALTER TABLE listings ADD COLUMN condition TEXT'); } catch {}
  try { DB.exec('ALTER TABLE members ADD COLUMN address TEXT'); } catch {}
  try { DB.exec('ALTER TABLE members ADD COLUMN username TEXT'); } catch {}
  try { DB.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_members_username ON members(username) WHERE username IS NOT NULL'); } catch {}
  try { DB.exec('ALTER TABLE orders ADD COLUMN member_address TEXT'); } catch {}

  [['usd_thb_rate','36'], ['shop_name','TCG SHOP'],
   ['banner_text','ร้านฝากขายการ์ดสะสม คุณภาพเยี่ยม ราคาดี'], ['facebook_page','']
  ].forEach(([k, v]) => DB.run('INSERT OR IGNORE INTO settings(key,value)VALUES(?,?)', [k, v]));

  saveDb();
  setupRoutes();
  app.listen(PORT, () => {
    console.log(`\n✅  Server:  http://localhost:${PORT}`);
    console.log(`🛠️  Admin:   http://localhost:${PORT}/admin.html\n`);
  });
}

start().catch(e => { console.error('Startup error:', e); process.exit(1); });
