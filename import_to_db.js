const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const initSqlJs = require('sql.js');

const DB_FILE = path.join(__dirname, 'cards.db');

async function importData() {
  console.log('⏳ Initializing sql.js...');
  const SQL = await initSqlJs();
  let db;

  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
    console.log('📂 Loaded existing database file:', DB_FILE);
  } else {
    db = new SQL.Database();
    console.log('🆕 Created new in-memory database');
  }

  // Create cards_library table
  console.log('🔨 Creating cards_library table if not exists...');
  db.run(`
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

  // Read Excel file
  const excelPath = path.join(__dirname, 'riftbound_cards.xlsx');
  if (!fs.existsSync(excelPath)) {
    throw new Error(`Excel file not found at: ${excelPath}`);
  }

  console.log('📖 Reading Excel file:', excelPath);
  const workbook = XLSX.readFile(excelPath);
  const sheetName = 'Riftbound Cards';
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found in Excel file.`);
  }

  const cards = XLSX.utils.sheet_to_json(sheet);
  console.log(`📊 Found ${cards.length} cards to import.`);

  // Insert cards into database
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO cards_library 
      (id, tcgplayer_id, name, card_number, set_name, rarity, image_url, product_url, min_price_usd, max_price_usd, game, game_id, variants_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  for (const card of cards) {
    stmt.run([
      card['JustTCG ID'] || null,
      card['TCGPlayer ID'] || null,
      card['Card Name (ชื่อการ์ด)'] || 'Unknown',
      card['Card Number (รหัสการ์ด)'] || null,
      card['Set Name'] || null,
      card['Rarity'] || null,
      card['Image URL (รูปภาพ)'] || null,
      card['Product Detail (ลิงก์สินค้า)'] || null,
      card['Min Price (USD)'] !== undefined ? parseFloat(card['Min Price (USD)']) : 0,
      card['Max Price (USD)'] !== undefined ? parseFloat(card['Max Price (USD)']) : 0,
      'Riftbound: League of Legends Trading Card Game',
      'riftbound-league-of-legends-trading-card-game',
      card['Variants Summary'] || null
    ]);
    count++;
  }
  stmt.free();

  console.log(`✅ Successfully processed ${count} records.`);

  // Export DB back to file
  console.log('💾 Saving database file...');
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
  console.log('🎉 Import process completed successfully!');
}

importData().catch(e => {
  console.error('❌ Import failed:', e);
});
