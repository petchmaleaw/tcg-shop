/* ── State ── */
let currentGame   = '';
let currentSearch = '';
let inStockOnly   = false;
let searchTimer   = null;
let currentOffset = 0;
let totalCards    = 0;
let isLoading     = false;
const LIMIT       = 60;

/* ── Elements ── */
const searchInput    = document.getElementById('searchInput');
const searchClear    = document.getElementById('searchClear');
const searchDropdown = document.getElementById('searchDropdown');
const cardsGrid      = document.getElementById('cardsGrid');
const emptyState     = document.getElementById('emptyState');
const resultsInfo    = document.getElementById('resultsInfo');
const categoryList   = document.getElementById('categoryList');
const inStockToggle  = document.getElementById('inStockOnly');

/* ═══════════════════ INIT ═══════════════════ */
async function init() {
  await loadSettings();
  loadCategories();
  await loadCards(true);
}

async function loadSettings() {
  try {
    const data = await apiFetch('/api/settings');
    if (data.shop_name)   document.getElementById('bannerTitle').textContent = data.shop_name;
    if (data.banner_text) document.getElementById('bannerSub').textContent   = data.banner_text;
  } catch {}
}

/* ═══════════════════ CATEGORIES ═══════════════════ */
async function loadCategories() {
  try {
    const data = await apiFetch('/api/categories');
    const cats = normalizeList(data, ['data']);
    if (!cats.length) return;
    cats.forEach(g => {
      const name = g.game || '';
      const id   = g.game_id || g.game || '';
      if (!name || !id) return;
      const li = document.createElement('li');
      li.className = 'category-item';
      li.dataset.game = id;
      li.innerHTML = `
        <span class="cat-dot"></span>
        <span class="cat-name">${name}</span>
        <span class="cat-count">${g.count || 0}</span>`;
      li.addEventListener('click', () => setGame(id, li));
      categoryList.appendChild(li);
    });
  } catch (err) {
    console.warn('Cannot load categories:', err.message);
  }
}

function setGame(game, el) {
  currentGame = game;
  document.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  loadCards(true);
}

/* ═══════════════════ LOAD CARDS (server-side) ═══════════════════ */
async function loadCards(reset = false) {
  if (isLoading) return;
  isLoading = true;

  if (reset) {
    currentOffset = 0;
    cardsGrid.innerHTML = '<div class="loading-grid"><div class="spinner"></div></div>';
    emptyState.style.display = 'none';
    removeLoadMoreBtn();
  }

  try {
    const params = new URLSearchParams({ limit: LIMIT, offset: currentOffset });
    if (currentGame)   params.set('game', currentGame);
    if (currentSearch) params.set('q',    currentSearch);

    const data  = await apiFetch(`/api/search?${params}`);
    const cards = data.data || [];
    totalCards  = data.total || 0;

    const filtered = inStockOnly ? cards.filter(c => c.in_stock) : cards;

    if (reset) cardsGrid.innerHTML = '';

    if (filtered.length === 0 && currentOffset === 0) {
      emptyState.style.display = 'block';
      resultsInfo.textContent  = '0 รายการ';
    } else {
      emptyState.style.display = 'none';
      filtered.forEach(c => cardsGrid.appendChild(createCard(c)));
      resultsInfo.textContent = `${totalCards} รายการ`;

      const fetched = currentOffset + cards.length;
      removeLoadMoreBtn();
      if (fetched < totalCards && !inStockOnly) addLoadMoreBtn();
    }

    currentOffset += cards.length;
  } catch {
    if (reset) cardsGrid.innerHTML = '<div class="loading-grid"><p style="color:#7a9ab8">โหลดข้อมูลไม่สำเร็จ</p></div>';
  } finally {
    isLoading = false;
  }
}

function removeLoadMoreBtn() {
  document.getElementById('loadMoreBtn')?.remove();
}

function addLoadMoreBtn() {
  const btn = document.createElement('button');
  btn.id        = 'loadMoreBtn';
  btn.className = 'btn-load-more';
  btn.textContent = 'โหลดเพิ่ม';
  btn.addEventListener('click', () => loadCards(false));
  cardsGrid.insertAdjacentElement('afterend', btn);
}

/* ═══════════════════ CARD ELEMENT ═══════════════════ */
function createCard(card) {
  const outOfStock = !card.in_stock;
  const hasImage   = card.image && card.image.trim();

  const div = document.createElement('div');
  div.className = 'card-item';

  const imgWrapClass = `card-img-wrap${!hasImage ? ' placeholder' : ''}${outOfStock ? ' sold-out' : ''}`;
  const imgHtml = hasImage
    ? `<img src="${esc(card.image)}" alt="${esc(card.card_name)}" loading="lazy"
            onerror="if(this.dataset.tried)return; this.dataset.tried=1; this.src='/api/image-proxy?url='+encodeURIComponent(this.getAttribute('data-src')||''); this.onerror=function(){this.parentElement.classList.add('placeholder');this.remove();}"
            data-src="${esc(card.image)}">`
    : '';
  const soldHtml = outOfStock
    ? `<div class="sold-overlay"><div class="sold-badge">หมด</div></div>`
    : '';

  const priceHtml = card.price_thb != null
    ? `${Number(card.price_thb).toLocaleString('th-TH', {minimumFractionDigits:0, maximumFractionDigits:0})}<span class="unit">บาท</span>`
    : '';

  div.innerHTML = `
    <div class="${imgWrapClass}">
      ${imgHtml}
      ${soldHtml}
    </div>
    <div class="card-info">
      <div class="card-name">${esc(card.card_name)}</div>
      <div class="card-code">${esc(card.card_code || ' ')}</div>
      <div class="card-price">${priceHtml}</div>
    </div>`;

  return div;
}

/* ═══════════════════ SEARCH ═══════════════════ */
searchInput.addEventListener('input', () => {
  const val = searchInput.value;
  searchClear.style.display = val ? 'block' : 'none';
  clearTimeout(searchTimer);

  if (val.trim().length < 2) {
    closeDropdown();
    currentSearch = val.trim();
    loadCards(true);
    return;
  }
  searchTimer = setTimeout(() => showDropdown(val.trim()), 280);
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    currentSearch = searchInput.value.trim();
    closeDropdown();
    loadCards(true);
  }
  if (e.key === 'Escape') { closeDropdown(); }
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.style.display = 'none';
  currentSearch = '';
  closeDropdown();
  loadCards(true);
});

document.addEventListener('click', e => {
  if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) closeDropdown();
});

function closeDropdown() { searchDropdown.classList.remove('open'); }

async function showDropdown(q) {
  try {
    const params = new URLSearchParams({ q, limit: 6 });
    if (currentGame) params.set('game', currentGame);
    const data    = await apiFetch(`/api/search?${params}`);
    const matches = data.data || [];

    if (!matches.length) { closeDropdown(); return; }

    searchDropdown.innerHTML = matches.map(c => `
      <div class="dd-item" data-name="${esc(c.card_name)}">
        ${c.image
          ? `<img class="dd-img" src="${esc(c.image)}" alt="" onerror="this.className='dd-img-placeholder'">`
          : `<div class="dd-img-placeholder"></div>`}
        <div>
          <div class="dd-name">${esc(c.card_name)}</div>
          <div class="dd-meta">${esc(c.card_code || c.game || '')}</div>
        </div>
      </div>`).join('');

    searchDropdown.querySelectorAll('.dd-item').forEach(el => {
      el.addEventListener('click', () => {
        searchInput.value = el.dataset.name;
        searchClear.style.display = 'block';
        currentSearch = el.dataset.name;
        closeDropdown();
        loadCards(true);
      });
    });
    searchDropdown.classList.add('open');
  } catch { closeDropdown(); }
}

/* ═══════════════════ TOGGLE ═══════════════════ */
inStockToggle.addEventListener('change', e => {
  inStockOnly = e.target.checked;
  loadCards(true);
});

/* ─── category "ทั้งหมด" ─── */
document.querySelector('.category-item[data-game=""]').addEventListener('click', function() {
  setGame('', this);
});

/* ═══════════════════ HELPERS ═══════════════════ */
async function apiFetch(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

function normalizeList(data, keys) {
  if (Array.isArray(data)) return data;
  for (const k of keys) if (Array.isArray(data[k])) return data[k];
  return [];
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/* ─── Start ─── */
init();
