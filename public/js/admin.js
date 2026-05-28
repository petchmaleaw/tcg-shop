/* ══════════════════════════════════════════════
   TCG Shop — Admin JS
══════════════════════════════════════════════ */

let usdRate = 36;
let searchResults = [];

/* ─── Tab switching ─── */
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    link.classList.add('active');
    document.getElementById(`tab-${link.dataset.tab}`).classList.add('active');
    if (link.dataset.tab === 'listings') loadListingsTab();
    if (link.dataset.tab === 'settings') loadSettings();
  });
});

/* ─── Toast ─── */
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ════════════════════════════════════════════
   SETTINGS
════════════════════════════════════════════ */
async function loadSettings() {
  try {
    const d = await api('/api/settings');
    document.getElementById('s_shopName').value   = d.shop_name   || '';
    document.getElementById('s_bannerText').value = d.banner_text || '';
    document.getElementById('s_usdRate').value    = d.usd_thb_rate || '36';
    usdRate = parseFloat(d.usd_thb_rate || '36');
  } catch {}
}

async function saveSettings() {
  const body = {
    shop_name:    document.getElementById('s_shopName').value,
    banner_text:  document.getElementById('s_bannerText').value,
    usd_thb_rate: document.getElementById('s_usdRate').value,
  };
  await api('/api/settings', { method: 'PUT', json: body });
  usdRate = parseFloat(body.usd_thb_rate);
  toast('✅ บันทึกการตั้งค่าแล้ว');
}

/* ════════════════════════════════════════════
   SEARCH JustTCG API
════════════════════════════════════════════ */
async function loadGames() {
  try {
    const data = await api('/api/games');
    const games = normList(data, ['data','games','results']);
    const sel = document.getElementById('gameFilter');
    games.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id || g.slug || g.abbreviation || g.name || String(g);
      opt.textContent = g.name || g.displayName || g.abbreviation || String(g);
      sel.appendChild(opt);
    });
  } catch {}
}

async function doSearch() {
  const q    = document.getElementById('apiSearch').value.trim();
  const game = document.getElementById('gameFilter').value;
  if (!q) return;

  const box = document.getElementById('apiResults');
  box.innerHTML = '<div class="hint-msg">⏳ กำลังค้นหา...</div>';

  try {
    const params = new URLSearchParams({ q });
    if (game) params.set('game', game);
    const data = await api(`/api/admin/search?${params}`);
    searchResults = normList(data, ['data','cards','results']);

    if (!searchResults.length) {
      box.innerHTML = '<div class="hint-msg">ไม่พบการ์ดที่ตรงกัน</div>';
      return;
    }

    box.innerHTML = searchResults.map((c, i) => {
      const img   = c.image_url || c.image || c.imageUrl || '';
      const price = getPrice(c);
      const set   = c.set?.name || c.setName || c.set || '';
      const num   = c.number || c.cardNumber || '';
      const thb   = price ? Math.round(price * usdRate).toLocaleString('th-TH') : '—';
      const proxied = img ? `/api/image-proxy?url=${encodeURIComponent(img)}` : '';
      return `
        <div class="result-card" data-i="${i}" onclick="selectResult(${i}, this)">
          ${proxied
            ? `<img src="${proxied}" alt="" onerror="this.outerHTML='<div class=rc-no-img>🃏</div>'">`
            : '<div class="rc-no-img">🃏</div>'}
          <div>
            <div class="rc-name">${esc(c.name || '—')}</div>
            <div class="rc-set">${esc(set)} ${esc(num)}</div>
            <div class="rc-price">${price ? `$${Number(price).toFixed(2)} USD ≈ ${thb} THB` : 'ไม่มีราคา'}</div>
          </div>
        </div>`;
    }).join('');

  } catch (err) {
    box.innerHTML = `<div class="hint-msg" style="color:#dc2626">เกิดข้อผิดพลาด: ${esc(err.message)}</div>`;
  }
}

function selectResult(i, el) {
  document.querySelectorAll('.result-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');

  const c = searchResults[i];
  if (!c) return;

  const img   = c.image_url || c.image || c.imageUrl || '';
  const price = getPrice(c);
  const set   = c.set?.name || c.setName || c.set || '';
  const num   = c.number || c.cardNumber || c.set_number || '';
  const gameN = c.game?.name  || c.gameName  || c.game  || '';
  const gameI = c.game?.id    || c.gameId    || c.game_id || gameN;

  /* hidden */
  document.getElementById('f_card_id').value   = c.id || c.card_id || '';
  document.getElementById('f_card_image').value = img;
  document.getElementById('f_game').value       = gameN;
  document.getElementById('f_game_id').value    = gameI;
  document.getElementById('f_set_name').value   = set;
  document.getElementById('f_ref_usd').value    = price || 0;

  /* visible */
  document.getElementById('f_name').value  = c.name || '';
  document.getElementById('f_code').value  = num;
  document.getElementById('f_price').value = price ? Math.round(price * usdRate) : '';
  document.getElementById('refPriceBox').textContent = price
    ? `$${Number(price).toFixed(2)} USD  ≈  ${Math.round(price * usdRate).toLocaleString('th-TH')} THB`
    : '—';

  /* preview — ใช้ proxy สำหรับ external URL */
  const proxied = img ? `/api/image-proxy?url=${encodeURIComponent(img)}` : '';
  updatePreview('imgPreview', proxied || img);
  document.getElementById('clearImgBtn').style.display = 'none';
  document.getElementById('fileCustom').value = '';
  document.getElementById('imgUrlInput').value = img; // แสดง URL ที่ได้จาก API
}

/* ─── Upload preview ─── */
document.getElementById('fileCustom').addEventListener('change', function() {
  if (this.files.length) {
    previewFile(this, 'imgPreview');
    document.getElementById('imgUrlInput').value = '';        // clear URL field
    document.getElementById('clearImgBtn').style.display = 'inline-flex';
  }
});

/* ─── URL input preview ─── */
let _urlTimer;
document.getElementById('imgUrlInput').addEventListener('input', function() {
  clearTimeout(_urlTimer);
  const url = this.value.trim();
  if (!url) {
    const fallback = document.getElementById('f_card_image').value;
    const proxied  = fallback ? `/api/image-proxy?url=${encodeURIComponent(fallback)}` : '';
    updatePreview('imgPreview', proxied || fallback);
    document.getElementById('clearImgBtn').style.display = 'none';
    return;
  }
  _urlTimer = setTimeout(() => {
    // preview via proxy
    updatePreview('imgPreview', `/api/image-proxy?url=${encodeURIComponent(url)}`);
    document.getElementById('f_card_image').value = url;     // store as card_image
    document.getElementById('fileCustom').value   = '';      // clear file
    document.getElementById('clearImgBtn').style.display = 'inline-flex';
  }, 500);
});

document.getElementById('clearImgBtn').addEventListener('click', () => {
  document.getElementById('fileCustom').value    = '';
  document.getElementById('imgUrlInput').value   = '';
  document.getElementById('f_card_image').value  = '';
  document.getElementById('clearImgBtn').style.display = 'none';
  updatePreview('imgPreview', '');
});

/* ─── Add card form ─── */
document.getElementById('addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  // ถ้าไม่ได้อัปโหลดไฟล์ แต่มี URL ใน imgUrlInput → ใส่เป็น card_image
  const urlInput = document.getElementById('imgUrlInput').value.trim();
  const hasFile  = document.getElementById('fileCustom').files.length > 0;
  if (urlInput && !hasFile) {
    fd.set('card_image', urlInput);
  }
  try {
    const d = await api('/api/admin/listings', { method: 'POST', body: fd });
    if (d.success) {
      toast('✅ เพิ่มการ์ดสำเร็จ!');
      e.target.reset();
      document.getElementById('imgUrlInput').value = '';
      updatePreview('imgPreview', '');
      document.getElementById('refPriceBox').textContent = '—';
      document.getElementById('clearImgBtn').style.display = 'none';
      document.querySelectorAll('.result-card').forEach(c => c.classList.remove('selected'));
    } else {
      toast(`❌ ${d.error || 'เกิดข้อผิดพลาด'}`, 'err');
    }
  } catch (err) {
    toast(`❌ ${err.message}`, 'err');
  }
});

/* ════════════════════════════════════════════
   LISTINGS TAB
════════════════════════════════════════════ */
async function loadListingsTab() {
  const tbody = document.getElementById('listingsTbody');
  tbody.innerHTML = '<tr><td colspan="9" class="center muted">กำลังโหลด...</td></tr>';
  try {
    const d = await api('/api/admin/listings');
    const rows = d.data || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="center muted" style="padding:48px">ยังไม่มีรายการ — เพิ่มการ์ดในแท็บ "เพิ่มการ์ด"</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const img  = r.custom_image || r.card_image || '';
      const date = new Date(r.created_at).toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'numeric' });
      return `
        <tr>
          <td>${img
            ? `<img class="tbl-img" src="${esc(img)}" alt="" onerror="this.outerHTML='<div class=tbl-img-ph></div>'">`
            : '<div class="tbl-img-ph"></div>'}</td>
          <td><strong>${esc(r.card_name)}</strong></td>
          <td class="muted">${esc(r.card_code || '—')}</td>
          <td class="muted">${esc(r.game || '—')}</td>
          <td><strong>฿${Number(r.price_thb).toLocaleString('th-TH')}</strong></td>
          <td class="muted">${esc(r.seller_name || '—')}</td>
          <td><span class="badge ${r.in_stock ? 'badge-ok' : 'badge-out'}">${r.in_stock ? 'มีของ' : 'หมด'}</span></td>
          <td class="muted" style="font-size:.8rem">${date}</td>
          <td>
            <div style="display:flex;gap:6px">
              <button class="btn btn-xs btn-ghost" onclick='openEdit(${JSON.stringify(r)})'>แก้ไข</button>
              <button class="btn btn-xs btn-danger" onclick="deleteCard(${r.id})">ลบ</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="center" style="color:#dc2626;padding:40px">${esc(err.message)}</td></tr>`;
  }
}

async function deleteCard(id) {
  if (!confirm('ยืนยันการลบการ์ดนี้?')) return;
  await api(`/api/admin/listings/${id}`, { method: 'DELETE' });
  toast('ลบแล้ว');
  loadListingsTab();
}

/* ════════════════════════════════════════════
   EDIT MODAL
════════════════════════════════════════════ */
function openEdit(r) {
  document.getElementById('e_id').value     = r.id;
  document.getElementById('e_name').value   = r.card_name;
  document.getElementById('e_code').value   = r.card_code  || '';
  document.getElementById('e_price').value  = r.price_thb;
  document.getElementById('e_seller').value = r.seller_name || '';

  document.querySelectorAll('#editForm input[name="in_stock"]').forEach(radio => {
    radio.checked = radio.value === (r.in_stock ? 'true' : 'false');
  });

  const img = r.custom_image || r.card_image || '';
  updatePreview('editImgPreview', img);
  document.getElementById('eFileCustom').value = '';
  document.getElementById('editModal').classList.add('open');
}

function closeModal() {
  document.getElementById('editModal').classList.remove('open');
}

document.getElementById('editModal').addEventListener('click', e => {
  if (e.target === document.getElementById('editModal')) closeModal();
});

document.getElementById('eFileCustom').addEventListener('change', function() {
  previewFile(this, 'editImgPreview');
});

document.getElementById('editForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('e_id').value;
  const fd = new FormData(e.target);
  try {
    const d = await api(`/api/admin/listings/${id}`, { method: 'PUT', body: fd });
    if (d.success) {
      toast('✅ บันทึกแล้ว');
      closeModal();
      loadListingsTab();
    } else {
      toast(`❌ ${d.error}`, 'err');
    }
  } catch (err) {
    toast(`❌ ${err.message}`, 'err');
  }
});

/* ════════════════════════════════════════════
   SEARCH — keyboard
════════════════════════════════════════════ */
document.getElementById('apiSearchBtn').addEventListener('click', doSearch);
document.getElementById('apiSearch').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSearch();
});

/* ════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════ */
async function api(url, opts = {}) {
  const init = { method: opts.method || 'GET' };
  if (opts.json) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.json);
  } else if (opts.body) {
    init.body = opts.body;
  }
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function normList(data, keys) {
  if (Array.isArray(data)) return data;
  for (const k of keys) if (Array.isArray(data[k])) return data[k];
  return [];
}

function getPrice(c) {
  return c.prices?.market
      || c.prices?.low
      || c.price?.market
      || c.marketPrice
      || c.price
      || 0;
}

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function updatePreview(id, src) {
  const el = document.getElementById(id);
  if (src) {
    el.innerHTML = `<img src="${esc(src)}" alt="" onerror="this.outerHTML='<span class=img-ph>🃏</span>'">`;
  } else {
    el.innerHTML = '<span class="img-ph">🃏</span>';
  }
}

function previewFile(input, previewId) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => updatePreview(previewId, ev.target.result);
  reader.readAsDataURL(file);
}

/* ─── Init ─── */
loadGames();
loadSettings();
