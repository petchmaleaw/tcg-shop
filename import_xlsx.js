/**
 * import_xlsx.js — นำเข้าการ์ดจาก .xlsx เข้า cards_library
 * Usage: node import_xlsx.js <path-to-xlsx>
 */
const XLSX      = require('xlsx');
const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');

const XLSX_FILE = process.argv[2] || path.join(__dirname, 'riftbound_cards.xlsx');
const DB_FILE   = path.join(__dirname, 'cards.db');

async function run() {
  // ── อ่าน xlsx ──
  console.log(`📖 อ่านไฟล์: ${XLSX_FILE}`);
  const wb    = XLSX.readFile(XLSX_FILE);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows  = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  console.log(`   พบ ${rows.length} แถว, sheet: "${wb.SheetNames[0]}"`);

  // ── เปิด DB ──
  const SQL = await initSqlJs();
  const DB  = new SQL.Database(fs.readFileSync(DB_FILE));

  // สร้าง table ถ้ายังไม่มี (safety)
  DB.exec(`
    CREATE TABLE IF NOT EXISTS cards_library (
      id               TEXT PRIMARY KEY,
      tcgplayer_id     TEXT,
      name             TEXT NOT NULL,
      card_number      TEXT,
      set_name         TEXT,
      rarity           TEXT,
      image_url        TEXT,
      product_url      TEXT,
      min_price_usd    REAL DEFAULT 0,
      max_price_usd    REAL DEFAULT 0,
      game             TEXT,
      game_id          TEXT,
      variants_summary TEXT,
      created_at       TEXT DEFAULT (datetime('now'))
    );
  `);

  // ── map คอลัมน์ ──
  const GAME_NAME = 'Riftbound: League of Legends Trading Card Game';
  const GAME_ID   = 'riftbound-league-of-legends-trading-card-game';

  const stmt = DB.prepare(`
    INSERT OR REPLACE INTO cards_library
      (id, tcgplayer_id, name, card_number, set_name, rarity,
       image_url, product_url, min_price_usd, max_price_usd,
       game, game_id, variants_summary)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  let inserted = 0, skipped = 0;

  for (const r of rows) {
    const id   = String(r['JustTCG ID'] || '').trim();
    const name = String(r['Card Name (ชื่อการ์ด)'] || '').trim();
    if (!id || !name) { skipped++; continue; }

    stmt.run([
      id,
      String(r['TCGPlayer ID']        || ''),
      name,
      String(r['Card Number (รหัสการ์ด)'] || ''),
      String(r['Set Name']            || ''),
      String(r['Rarity']              || ''),
      String(r['Image URL (รูปภาพ)'] || ''),
      String(r['Product Detail (ลิงก์สินค้า)'] || ''),
      parseFloat(r['Min Price (USD)'] || 0),
      parseFloat(r['Max Price (USD)'] || 0),
      GAME_NAME,
      GAME_ID,
      String(r['Variants Summary']    || ''),
    ]);
    inserted++;
  }

  stmt.free();

  // บันทึก DB
  const data = DB.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
  DB.close();

  console.log(`✅ Import สำเร็จ: ${inserted} การ์ด  (ข้าม ${skipped} แถวที่ไม่มีข้อมูล)`);
  console.log(`💾 บันทึกลง ${DB_FILE}`);
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
