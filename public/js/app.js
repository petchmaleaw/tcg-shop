/* ── State ── */
let currentGame   = '';
let currentSearch = '';
let inStockOnly   = false;
let searchTimer   = null;
let currentOffset = 0;
let totalCards    = 0;
let isLoading     = false;
const LIMIT       = 60;
const CART_KEY    = 'tcg_cart';

/* ── Elements ── */
const searchInput    = document.getElementById('searchInput');
const searchClear    = document.getElementById('searchClear');
const searchDropdown = document.getElementById('searchDropdown');
const cardsGrid      = document.getElementById('cardsGrid');
const emptyState     = document.getElementById('emptyState');
const resultsInfo    = document.getElementById('resultsInfo');
const categoryList   = document.getElementById('categoryList');
const inStockToggle  = document.getElementById('inStockOnly');

/* ═══════════════════ CART HELPERS ═══════════════════ */
function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
  catch { return []; }
}
function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartIcon();
}
function updateCartIcon() {
  const total = getCart().reduce((s, i) => s + i.qty, 0);
  const el = document.getElementById('cartCount');
  if (el) el.textContent = total;
}
function getCartQty(listingId) {
  return getCart().filter(i => i.id === listingId).reduce((s, i) => s + i.qty, 0);
}

function addToCart(item, qty) {
  const cart = getCart();
  const idx  = cart.findIndex(i => i.id === item.id);
  if (idx >= 0) {
    cart[idx].qty = Math.min(cart[idx].qty + qty, item.stock_qty || 1);
  } else {
    cart.push({ id: item.id, card_name: item.card_name, card_code: item.card_code || '',
                price_thb: item.price_thb, image: item.image || '', qty });
  }
  saveCart(cart);
}

/* ═══════════════════ INIT ═══════════════════ */
async function init() {
  updateCartIcon();
  await loadSettings();
  loadCategories();
  loadMemberState();
  await loadCards(true);
}

async function loadSettings() {
  try {
    const data = await apiFetch('/api/settings');
    if (data.shop_name)   document.getElementById('bannerTitle').textContent = data.shop_name;
    if (data.banner_text) document.getElementById('bannerSub').textContent   = data.banner_text;
  } catch {}
}

async function loadMemberState() {
  try {
    const d      = await apiFetch('/api/auth/me');
    const btn    = document.getElementById('memberBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    if (!btn) return;
    if (d.authenticated) {
      btn.textContent = '📋 ' + d.name;
      btn.href = '/orders-history.html';
      if (logoutBtn) {
        logoutBtn.style.display = 'inline-flex';
        logoutBtn.addEventListener('click', async e => {
          e.preventDefault();
          if (!confirm('ออกจากระบบ?')) return;
          await fetch('/api/auth/logout', { method: 'POST' });
          location.reload();
        });
      }
    }
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
    const total = cats.reduce((s, g) => s + (g.count || 0), 0);
    const el = document.getElementById('totalCount');
    if (el) el.textContent = total;
  } catch (err) { console.warn('Cannot load categories:', err.message); }
}

function setGame(game, el) {
  currentGame = game;
  document.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  loadCards(true);
}

/* ═══════════════════ LOAD CARDS ═══════════════════ */
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

function removeLoadMoreBtn() { document.getElementById('loadMoreBtn')?.remove(); }
function addLoadMoreBtn() {
  const btn = document.createElement('button');
  btn.id = 'loadMoreBtn';
  btn.className = 'btn-load-more';
  btn.textContent = 'โหลดเพิ่ม';
  btn.addEventListener('click', () => loadCards(false));
  cardsGrid.insertAdjacentElement('afterend', btn);
}

/* ═══════════════════ CARD ELEMENT ═══════════════════ */
function createCard(card) {
  const outOfStock = !card.in_stock;
  const hasImage   = card.image && card.image.trim();
  const canBuy     = card.is_listed && card.in_stock && card.price_thb != null && (card.stock_qty || 0) > 0;

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
  /* click on image wrap → open detail modal */
  div._cardName  = card.card_name;
  div._cardImage = card.image || '';

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

  /* ── Cart section (listed + in-stock cards only) ── */
  if (canBuy) {
    const maxQty = card.stock_qty || 1;
    const cartSection = document.createElement('div');
    cartSection.className = 'card-cart-section';

    const qtyRow = document.createElement('div');
    qtyRow.className = 'card-qty-row';

    const minusBtn = document.createElement('button');
    minusBtn.className = 'card-qty-btn';
    minusBtn.textContent = '−';

    const qtySpan = document.createElement('span');
    qtySpan.className = 'card-qty-val';
    qtySpan.textContent = '1';

    const plusBtn = document.createElement('button');
    plusBtn.className = 'card-qty-btn';
    plusBtn.textContent = '+';

    const stockLabel = document.createElement('span');
    stockLabel.className = 'card-stock-label';
    stockLabel.textContent = `เหลือ ${maxQty}`;

    qtyRow.append(minusBtn, qtySpan, plusBtn, stockLabel);

    const addBtn = document.createElement('button');
    addBtn.className = 'card-add-btn';
    addBtn.textContent = '🛒 เพิ่มลงตะกร้า';

    /* qty logic */
    function getQty() { return parseInt(qtySpan.textContent) || 1; }
    function setQty(n) {
      n = Math.max(1, Math.min(n, maxQty));
      qtySpan.textContent = n;
      minusBtn.disabled = n <= 1;
      plusBtn.disabled  = n >= maxQty;
    }
    setQty(1);

    minusBtn.addEventListener('click', e => { e.stopPropagation(); setQty(getQty() - 1); });
    plusBtn.addEventListener('click',  e => { e.stopPropagation(); setQty(getQty() + 1); });

    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      addToCart({ id: card.listing_id, card_name: card.card_name, card_code: card.card_code,
                  price_thb: card.price_thb, image: card.image, stock_qty: maxQty }, getQty());
      /* visual feedback */
      addBtn.textContent = '✅ เพิ่มแล้ว!';
      addBtn.classList.add('added');
      setTimeout(() => { addBtn.textContent = '🛒 เพิ่มลงตะกร้า'; addBtn.classList.remove('added'); }, 1200);
    });

    cartSection.append(qtyRow, addBtn);
    div.appendChild(cartSection);
  }

  /* attach click to image wrap → open detail modal */
  const imgWrap = div.querySelector('.card-img-wrap');
  if (imgWrap) imgWrap.addEventListener('click', e => {
    e.stopPropagation();
    openCardModal(card.card_name, card.image || '');
  });

  return div;
}

/* ═══════════════════ SEARCH ═══════════════════ */
searchInput.addEventListener('input', () => {
  const val = searchInput.value;
  searchClear.style.display = val ? 'block' : 'none';
  clearTimeout(searchTimer);
  if (val.trim().length < 2) {
    closeDropdown(); currentSearch = val.trim(); loadCards(true); return;
  }
  searchTimer = setTimeout(() => showDropdown(val.trim()), 280);
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { currentSearch = searchInput.value.trim(); closeDropdown(); loadCards(true); }
  if (e.key === 'Escape') closeDropdown();
});

searchClear.addEventListener('click', () => {
  searchInput.value = ''; searchClear.style.display = 'none';
  currentSearch = ''; closeDropdown(); loadCards(true);
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
inStockToggle.addEventListener('change', e => { inStockOnly = e.target.checked; loadCards(true); });

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
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ═══════════════════ CARD DETAIL MODAL ═══════════════════ */
const cardModalBg    = document.getElementById('cardModal');
const cardModalClose = document.getElementById('cardModalClose');
const cdmImg         = document.getElementById('cdmImg');
const cdmImgPh       = document.getElementById('cdmImgPh');
const cdmRight       = document.getElementById('cdmRight');

let _modalQtys = new Map(); /* listing_id → qty */

async function openCardModal(cardName, fallbackImage) {
  _modalQtys = new Map();

  /* show image immediately */
  if (fallbackImage) {
    cdmImg.src = fallbackImage;
    cdmImg.style.display = '';
    cdmImgPh.style.display = 'none';
  } else {
    cdmImg.style.display = 'none';
    cdmImgPh.style.display = '';
  }
  cdmRight.innerHTML = '<div class="cdm-loading">กำลังโหลด...</div>';
  cardModalBg.classList.add('open');

  try {
    const data = await apiFetch('/api/card-listings?name=' + encodeURIComponent(cardName));
    const listings = data.data || [];

    /* if any listing has an image, update the displayed image */
    const withImg = listings.find(l => l.image);
    if (withImg) {
      cdmImg.src = withImg.image;
      cdmImg.style.display = '';
      cdmImgPh.style.display = 'none';
    }
    cdmImg.onerror = () => { cdmImg.style.display = 'none'; cdmImgPh.style.display = ''; };

    renderCardModalContent(listings, cardName);
  } catch {
    cdmRight.innerHTML = '<p style="color:#7a9ab8;padding:16px">โหลดข้อมูลไม่สำเร็จ</p>';
  }
}

function renderCardModalContent(listings, cardName) {
  if (!listings.length) {
    cdmRight.innerHTML = `<div class="cdm-name">${esc(cardName)}</div><p style="color:#7a9ab8;margin-top:12px">ไม่มีสินค้าในขณะนี้</p>`;
    return;
  }

  const code = listings[0].card_code || '';
  const game = listings[0].game || '';

  let html = `<div class="cdm-name">${esc(cardName)}</div>`;
  if (code) html += `<div class="cdm-code">${esc(code)}</div>`;
  if (game) html += `<div class="cdm-code" style="margin-top:2px">${esc(game)}</div>`;
  html += `<hr class="cdm-divider">`;
  html += `<div class="cdm-prices-title">ราคาสินค้า</div>`;

  listings.forEach(l => {
    _modalQtys.set(l.listing_id, 0);
    const price = Number(l.price_thb).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const seller = l.seller_name ? `<span class="cdm-price-seller">${esc(l.seller_name)}</span>` : '';
    html += `
      <div class="cdm-price-row" data-lid="${l.listing_id}">
        <span class="cdm-price-val">${price}<span class="unit">บาท</span></span>
        ${seller}
        <span class="cdm-price-stock">เหลือ ${l.stock_qty}</span>
        <div class="cdm-qty-ctrl">
          <button data-action="minus" data-lid="${l.listing_id}" data-max="${l.stock_qty}">−</button>
          <span id="cdmq-${l.listing_id}">0</span>
          <button data-action="plus"  data-lid="${l.listing_id}" data-max="${l.stock_qty}">+</button>
        </div>
      </div>`;
  });

  html += `<button class="cdm-add-btn" id="cdmAddBtn">🛒 เพิ่มลงตะกร้า</button>`;

  cdmRight.innerHTML = html;

  /* attach qty button listeners */
  cdmRight.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const lid = Number(btn.dataset.lid);
      const max = Number(btn.dataset.max);
      const cur = _modalQtys.get(lid) || 0;
      const next = btn.dataset.action === 'plus' ? Math.min(cur + 1, max) : Math.max(cur - 1, 0);
      _modalQtys.set(lid, next);
      const span = document.getElementById('cdmq-' + lid);
      if (span) span.textContent = next;
    });
  });

  document.getElementById('cdmAddBtn').addEventListener('click', () => {
    cdmAddAllToCart(listings);
  });
}

function cdmAddAllToCart(listings) {
  let added = 0;
  listings.forEach(l => {
    const qty = _modalQtys.get(l.listing_id) || 0;
    if (qty > 0) {
      addToCart({ id: l.listing_id, card_name: l.card_name, card_code: l.card_code || '',
                  price_thb: l.price_thb, image: l.image || '', stock_qty: l.stock_qty }, qty);
      added++;
    }
  });
  const btn = document.getElementById('cdmAddBtn');
  if (!btn) return;
  if (added > 0) {
    btn.textContent = '✅ เพิ่มแล้ว!';
    btn.classList.add('added');
    setTimeout(() => { btn.textContent = '🛒 เพิ่มลงตะกร้า'; btn.classList.remove('added'); }, 1400);
  } else {
    btn.textContent = '⚠️ เลือกจำนวนก่อน';
    setTimeout(() => { btn.textContent = '🛒 เพิ่มลงตะกร้า'; }, 1400);
  }
}

cardModalClose.addEventListener('click', () => cardModalBg.classList.remove('open'));
cardModalBg.addEventListener('click', e => { if (e.target === cardModalBg) cardModalBg.classList.remove('open'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') cardModalBg.classList.remove('open'); });

/* ─── Start ─── */
init();
