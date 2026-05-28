const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const apiKey = 'tcg_09d5d779be554c6f9c18e8ac7ba9629b';
const gameId = 'riftbound-league-of-legends-trading-card-game';
const limit = 20;

async function fetchAllCards() {
  let allCards = [];
  let offset = 0;
  let hasMore = true;
  let requestCount = 0;

  console.log(`Starting to fetch Riftbound cards...`);

  while (hasMore) {
    const url = `https://api.justtcg.com/v1/cards?game=${gameId}&limit=${limit}&offset=${offset}`;
    requestCount++;
    console.log(`[Request #${requestCount}] Fetching offset ${offset}...`);

    try {
      const response = await fetch(url, {
        headers: {
          'x-api-key': apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} - ${await response.text()}`);
      }

      const resJson = await response.json();
      const cards = resJson.data || [];
      allCards = allCards.concat(cards);

      console.log(`  Fetched ${cards.length} cards. Total so far: ${allCards.length}`);

      // Check pagination from meta
      const meta = resJson.meta || {};
      hasMore = meta.hasMore && cards.length > 0;
      
      // Print API limit details from headers/metadata if available
      if (resJson._metadata) {
        const md = resJson._metadata;
        console.log(`  API Limits: Daily Used: ${md.apiDailyRequestsUsed}/${md.apiDailyLimit}, Remaining: ${md.apiDailyRequestsRemaining}`);
      }

      if (hasMore) {
        offset += limit;
        // Wait 500ms to avoid rate limit
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`Error fetching offset ${offset}:`, error.message);
      console.log('Retrying in 3 seconds...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      // Re-run the same offset
    }
  }

  console.log(`Finished fetching. Total cards fetched: ${allCards.length}`);
  return allCards;
}

function processAndSaveToExcel(cards) {
  console.log('Processing card data for Excel...');

  const cardsSummaryData = [];
  const cardsVariantsData = [];

  for (const card of cards) {
    const tcgplayerId = card.tcgplayerId || '';
    const imageUrl = tcgplayerId ? `https://tcgplayer-cdn.tcgplayer.com/product/${tcgplayerId}_200w.jpg` : '';
    const productDetailUrl = tcgplayerId ? `https://www.tcgplayer.com/product/${tcgplayerId}` : '';

    // Calculate price range
    let minPrice = null;
    let maxPrice = null;
    let variantsSummary = [];

    const variants = card.variants || [];
    for (const v of variants) {
      const price = v.price;
      if (price !== null && price !== undefined) {
        if (minPrice === null || price < minPrice) minPrice = price;
        if (maxPrice === null || price > maxPrice) maxPrice = price;
      }
      
      variantsSummary.push(`${v.condition} (${v.printing}): $${price !== null ? price : 'N/A'}`);

      // Push to detailed variants sheet
      cardsVariantsData.push({
        'JustTCG ID': card.id,
        'TCGPlayer ID': tcgplayerId,
        'Name (ชื่อการ์ด)': card.name,
        'Card Number (รหัสการ์ด)': card.number || '',
        'Condition (สภาพ)': v.condition || '',
        'Printing (ชนิดการพิมพ์)': v.printing || '',
        'Language (ภาษา)': v.language || '',
        'Price (USD)': price,
        'Last Updated': v.lastUpdated ? new Date(v.lastUpdated * 1000).toLocaleString() : ''
      });
    }

    // Push to summary sheet
    cardsSummaryData.push({
      'JustTCG ID': card.id,
      'TCGPlayer ID': tcgplayerId,
      'Card Name (ชื่อการ์ด)': card.name,
      'Card Number (รหัสการ์ด)': card.number || '',
      'Set Name': card.set_name || '',
      'Rarity': card.rarity || '',
      'Image URL (รูปภาพ)': imageUrl,
      'Product Detail (ลิงก์สินค้า)': productDetailUrl,
      'Min Price (USD)': minPrice,
      'Max Price (USD)': maxPrice,
      'Variants Summary': variantsSummary.join(' | ')
    });
  }

  // Create Excel workbook
  const wb = XLSX.utils.book_new();

  // Sheet 1: Cards Summary
  const wsSummary = XLSX.utils.json_to_sheet(cardsSummaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Riftbound Cards');

  // Sheet 2: Variants
  const wsVariants = XLSX.utils.json_to_sheet(cardsVariantsData);
  XLSX.utils.book_append_sheet(wb, wsVariants, 'Riftbound Variants');

  // Write file
  const filename = 'riftbound_cards.xlsx';
  const filePath = path.join(__dirname, filename);
  XLSX.writeFile(wb, filePath);

  console.log(`Excel file saved successfully to: ${filePath}`);
  console.log(`Total Cards: ${cardsSummaryData.length}`);
  console.log(`Total Variants: ${cardsVariantsData.length}`);
}

async function main() {
  try {
    const cards = await fetchAllCards();
    processAndSaveToExcel(cards);
  } catch (error) {
    console.error('Fatal error in main process:', error);
  }
}

main();
