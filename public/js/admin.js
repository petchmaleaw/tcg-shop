/* ══════════════════════════════════════════════
   TCG Shop — Admin JS
══════════════════════════════════════════════ */

let usdRate = 36;
let searchResults = [];

/* ── Auth check on load ── */
(async () => {
  const d = await api('/api/admin/me').catch(() => ({ authenticated: false }));
  if (!d.authenticated) window.location.href = '/admin-login.html';
})();

/* ── Logout ── */
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/admin-login.html';
});

/* ── Tab switching ── */
document.querySelectorAll('.nav-link[data-tab]').forEach(link => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    link.classList.add('active');
    const tab = link.dataset.tab;
    document.getElementById(`tab-${tab}`).classList.add('active');
    if (tab === 'listings') loadListingsTab();
    if (tab === 'orders')   loadOrders();
    if (tab === 'settings') loadSettings();
    if (tab === 'bulk')     bulkInit();
  });
});

/* ── Toast ── */
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ════════════════════════════════════════════
   SETTINGS
════════════════════════════════════════════ */
async function loadSettings() {
  try {
    const d = await api('/api/settings');
    document.getElementById('s_shopName').value  = d.shop_name   || '';
    document.getElementById('s_bannerText').value= d.banner_text || '';
    document.getElementById('s_usdRate').value   = d.usd_thb_rate || '36';
    document.getElementById('s_fbPage').value    = d.facebook_page || '';
    usdRate = parseFloat(d.usd_thb_rate || '36');
  } catch {}
}

async function saveSettings() {
  const body = {
    shop_name:    document.getElementById('s_shopName').value,
    banner_text:  document.getElementById('s_bannerText').value,
    usd_thb_rate: document.getElementById('s_usdRate').value,
    facebook_page:document.getElementById('s_fbPage').value,
  };
  await api('/api/settings', { method: 'PUT', json: body });
  usdRate = parseFloat(body.usd_thb_rate);
  toast('✅ บันทึกการตั้งค่าแล้ว');
}

async function changePassword() {
  const cur = document.getElementById('pw_current').value;
  const nw  = document.getElementById('pw_new').value;
  const cf  = document.getElementById('pw_confirm').value;
  if (!cur || !nw || !cf) return toast('❌ กรุณากรอกข้อมูลให้ครบ', 'err');
  if (nw !== cf) return toast('❌ รหัสผ่านใหม่ไม่ตรงกัน', 'err');
  if (nw.length < 4) return toast('❌ รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร', 'err');
  try {
    await api('/api/admin/password', { method: 'PUT', json: { current_password: cur, new_password: nw } });
    toast('✅ เปลี่ยนรหัสผ่านสำเร็จ');
    ['pw_current','pw_new','pw_confirm'].forEach(id => document.getElementById(id).value = '');
  } catch (e) { toast(`❌ ${e.message}`, 'err'); }
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
      opt.textContent = g.name || g.displayName || String(g);
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
    if (!searchResults.length) { box.innerHTML = '<div class="hint-msg">ไม่พบการ์ดที่ตรงกัน</div>'; return; }
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
            <div class="rc-price">${price ? `$${Number(price).toFixed(2)} ≈ ${thb} THB` : 'ไม่มีราคา'}</div>
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

  document.getElementById('f_card_id').value   = c.id || c.card_id || '';
  document.getElementById('f_card_image').value = img;
  document.getElementById('f_game').value       = gameN;
  document.getElementById('f_game_id').value    = gameI;
  document.getElementById('f_set_name').value   = set;
  document.getElementById('f_ref_usd').value    = price || 0;
  document.getElementById('f_name').value  = c.name || '';
  document.getElementById('f_code').value  = num;
  document.getElementById('f_price').value = price ? Math.round(price * usdRate) : '';
  document.getElementById('refPriceBox').textContent = price
    ? `$${Number(price).toFixed(2)} USD  ≈  ${Math.round(price * usdRate).toLocaleString('th-TH')} THB` : '—';

  const proxied = img ? `/api/image-proxy?url=${encodeURIComponent(img)}` : '';
  updatePreview('imgPreview', proxied || img);
  document.getElementById('clearImgBtn').style.display = 'none';
  document.getElementById('fileCustom').value  = '';
  document.getElementById('imgUrlInput').value = img;
}

/* ── Upload preview ── */
document.getElementById('fileCustom').addEventListener('change', function() {
  if (this.files.length) {
    previewFile(this, 'imgPreview');
    document.getElementById('imgUrlInput').value = '';
    document.getElementById('clearImgBtn').style.display = 'inline-flex';
  }
});

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
    updatePreview('imgPreview', `/api/image-proxy?url=${encodeURIComponent(url)}`);
    document.getElementById('f_card_image').value = url;
    document.getElementById('fileCustom').value   = '';
    document.getElementById('clearImgBtn').style.display = 'inline-flex';
  }, 500);
});

document.getElementById('clearImgBtn').addEventListener('click', () => {
  document.getElementById('fileCustom').value   = '';
  document.getElementById('imgUrlInput').value  = '';
  document.getElementById('f_card_image').value = '';
  document.getElementById('clearImgBtn').style.display = 'none';
  updatePreview('imgPreview', '');
});

/* ── Add card form ── */
document.getElementById('addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const urlInput = document.getElementById('imgUrlInput').value.trim();
  const hasFile  = document.getElementById('fileCustom').files.length > 0;
  if (urlInput && !hasFile) fd.set('card_image', urlInput);
  try {
    const d = await api('/api/admin/listings', { method: 'POST', body: fd });
    if (d.success) {
      toast('✅ เพิ่มการ์ดสำเร็จ!');
      e.target.reset();
      document.getElementById('imgUrlInput').value = '';
      document.getElementById('f_stock_qty').value = '1';
      updatePreview('imgPreview', '');
      document.getElementById('refPriceBox').textContent = '—';
      document.getElementById('clearImgBtn').style.display = 'none';
      document.querySelectorAll('.result-card').forEach(c => c.classList.remove('selected'));
    } else { toast(`❌ ${d.error || 'เกิดข้อผิดพลาด'}`, 'err'); }
  } catch (err) { toast(`❌ ${err.message}`, 'err'); }
});

/* ════════════════════════════════════════════
   LISTINGS TAB
════════════════════════════════════════════ */
async function loadListingsTab() {
  const tbody = document.getElementById('listingsTbody');
  tbody.innerHTML = '<tr><td colspan="10" class="center muted">กำลังโหลด...</td></tr>';
  try {
    const d = await api('/api/admin/listings');
    const rows = d.data || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="center muted" style="padding:48px">ยังไม่มีรายการ</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const img  = r.custom_image || r.card_image || '';
      const date = new Date(r.created_at).toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'numeric' });
      const stockCls = r.stock_qty > 0 ? '' : 'style="color:#dc2626;font-weight:600"';
      return `
        <tr>
          <td>${img ? `<img class="tbl-img" src="${esc(img)}" alt="" onerror="this.outerHTML='<div class=tbl-img-ph></div>'">` : '<div class="tbl-img-ph"></div>'}</td>
          <td><strong>${esc(r.card_name)}</strong></td>
          <td class="muted">${esc(r.card_code || '—')}</td>
          <td class="muted">${esc(r.game || '—')}</td>
          <td><strong>฿${Number(r.price_thb).toLocaleString('th-TH')}</strong></td>
          <td ${stockCls}>${r.stock_qty ?? 0}</td>
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
    tbody.innerHTML = `<tr><td colspan="10" class="center" style="color:#dc2626;padding:40px">${esc(err.message)}</td></tr>`;
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
  document.getElementById('e_id').value        = r.id;
  document.getElementById('e_name').value      = r.card_name;
  document.getElementById('e_code').value      = r.card_code  || '';
  document.getElementById('e_price').value     = r.price_thb;
  document.getElementById('e_stock_qty').value = r.stock_qty  ?? 1;
  document.getElementById('e_seller').value    = r.seller_name || '';
  document.querySelectorAll('#editForm input[name="in_stock"]').forEach(radio => {
    radio.checked = radio.value === (r.in_stock ? 'true' : 'false');
  });
  const img = r.custom_image || r.card_image || '';
  updatePreview('editImgPreview', img);
  document.getElementById('eFileCustom').value = '';
  document.getElementById('editModal').classList.add('open');
}

function closeModal() { document.getElementById('editModal').classList.remove('open'); }

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
    if (d.success) { toast('✅ บันทึกแล้ว'); closeModal(); loadListingsTab(); }
    else toast(`❌ ${d.error}`, 'err');
  } catch (err) { toast(`❌ ${err.message}`, 'err'); }
});

/* ════════════════════════════════════════════
   ORDERS TAB
════════════════════════════════════════════ */
async function loadOrders() {
  const tbody = document.getElementById('ordersTbody');
  tbody.innerHTML = '<tr><td colspan="8" class="center muted">กำลังโหลด...</td></tr>';
  try {
    const d = await api('/api/admin/orders');
    const orders = d.data || [];

    /* update pending badge */
    const pending = orders.filter(o => o.status === 'pending').length;
    const badge = document.getElementById('pendingBadge');
    badge.textContent = pending;
    badge.style.display = pending ? 'inline-block' : 'none';

    if (!orders.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="center muted" style="padding:48px">ยังไม่มีคำสั่งซื้อ</td></tr>';
      return;
    }
    tbody.innerHTML = orders.map(o => {
      const date = new Date(o.created_at).toLocaleString('th-TH', {
        day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
      });
      const statusClass = { pending:'badge-pending', confirmed:'badge-ok', cancelled:'badge-out' }[o.status] || 'badge-out';
      const statusText  = { pending:'รอดำเนินการ', confirmed:'ยืนยันแล้ว', cancelled:'ยกเลิก' }[o.status] || o.status;
      const itemsText   = o.items?.map(i => `${i.card_name} x${i.qty}`).join(', ') || '—';
      return `
        <tr>
          <td><strong>#${o.id}</strong></td>
          <td style="font-size:.82rem">${date}</td>
          <td>${esc(o.member_name || '—')}</td>
          <td class="muted">${esc(o.member_phone || '—')}</td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;font-size:.8rem" title="${esc(itemsText)}">${esc(itemsText)}</td>
          <td><strong>฿${Number(o.total_thb||0).toLocaleString('th-TH')}</strong></td>
          <td><span class="badge ${statusClass}">${statusText}</span></td>
          <td>
            <div style="display:flex;gap:5px;flex-wrap:wrap">
              <button class="btn btn-xs btn-ghost" onclick="showOrderDetail(${o.id})">ดูรายการ</button>
              ${o.status === 'pending' ? `<button class="btn btn-xs btn-success" onclick="deductStock(${o.id})">✅ ตัดสต๊อก</button>` : ''}
              ${o.status !== 'cancelled' ? `<button class="btn btn-xs btn-danger" onclick="cancelOrder(${o.id})">ยกเลิก</button>` : ''}
            </div>
          </td>
        </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="center" style="color:#dc2626;padding:40px">${esc(err.message)}</td></tr>`;
  }
}

async function deductStock(orderId) {
  if (!confirm(`ยืนยันการตัดสต๊อกสำหรับ Order #${orderId}?\n(สถานะจะเปลี่ยนเป็น "ยืนยันแล้ว")`)) return;
  try {
    const d = await api(`/api/admin/orders/${orderId}/deduct-stock`, { method: 'POST' });
    if (d.errors?.length) toast(`⚠️ ${d.errors.join(', ')}`, 'err');
    else toast(`✅ ตัดสต๊อก Order #${orderId} สำเร็จ`);
    loadOrders();
  } catch (e) { toast(`❌ ${e.message}`, 'err'); }
}

async function cancelOrder(orderId) {
  if (!confirm(`ยืนยันการยกเลิก Order #${orderId}?`)) return;
  try {
    await api(`/api/admin/orders/${orderId}`, { method: 'PUT', json: { status: 'cancelled' } });
    toast(`Order #${orderId} ถูกยกเลิกแล้ว`);
    loadOrders();
  } catch (e) { toast(`❌ ${e.message}`, 'err'); }
}

/* ════════════════════════════════════════════
   ORDER DETAIL MODAL (editable)
════════════════════════════════════════════ */
let _curOrderId = null;
let _addStaging = null;   // { listing_id, card_name, card_code, price_thb, image, stock_qty }
let _addQty     = 1;
let _addSearchTimer = null;

async function showOrderDetail(orderId) {
  _curOrderId = orderId;
  _addStaging = null;
  _addQty     = 1;
  document.getElementById('orderModal').classList.add('open');
  await renderOrderModal();
}

async function renderOrderModal() {
  const content = document.getElementById('orderModalContent');
  content.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted)">กำลังโหลด...</div>';
  try {
    const o = await api(`/api/admin/orders/${_curOrderId}`);
    const STATUS = { pending:'รอดำเนินการ', confirmed:'ยืนยันแล้ว', cancelled:'ยกเลิก' };
    const BADGE  = { pending:'badge-pending', confirmed:'badge-confirmed', cancelled:'badge-cancelled' };
    const canEdit = o.status !== 'cancelled';

    const itemRows = (o.items||[]).map(i => {
      const stock = i.current_stock ?? 0;
      const lowStock = stock <= 3;
      return `
        <tr>
          <td style="max-width:220px">
            ${i.image ? `<img class="om-card-img" src="${esc(i.image)}" alt="" onerror="this.style.display='none'">` : ''}
            <span style="vertical-align:middle">${esc(i.card_name)}</span>
          </td>
          <td class="muted" style="white-space:nowrap">${esc(i.card_code||'—')}</td>
          <td style="white-space:nowrap">฿${Number(i.price_thb).toLocaleString('th-TH')}</td>
          <td>
            ${canEdit ? `
              <div class="om-qty-ctrl">
                <button onclick="omChangeQty(${i.id},${i.qty-1},${_curOrderId})" ${i.qty<=1?'disabled':''}>−</button>
                <span>${i.qty}</span>
                <button onclick="omChangeQty(${i.id},${i.qty+1},${_curOrderId})" ${i.qty>=stock?'disabled':''}>+</button>
              </div>
              <span class="om-stock-tag ${lowStock?'low':''}">(สต๊อก ${stock})</span>
            ` : i.qty}
          </td>
          <td style="white-space:nowrap"><strong>฿${(i.price_thb*i.qty).toLocaleString('th-TH')}</strong></td>
          <td>
            ${canEdit ? `<button class="om-del-btn" onclick="omDeleteItem(${i.id},${_curOrderId})" title="ลบรายการ">✕</button>` : ''}
          </td>
        </tr>`;
    }).join('');

    const addBox = canEdit ? `
      <div class="add-item-box">
        <div class="om-section-title">เพิ่มรายการ</div>
        <div class="add-search-wrap">
          <input class="add-search-input" id="addSearchInput" placeholder="ค้นหาสินค้าจากคลัง..." autocomplete="off" oninput="omSearchDebounce(this.value)">
          <div class="add-search-dd" id="addSearchDd" style="display:none"></div>
        </div>
        <div id="addStagingArea"></div>
      </div>` : '';

    content.innerHTML = `
      <div class="om-head">
        <h3>รายละเอียดคำสั่งซื้อ</h3>
        <button class="om-close" onclick="closeOrderModal()">✕</button>
      </div>
      <div class="om-body">
        <div class="om-info">
          <div><strong>${esc(o.member_name||'ไม่ระบุชื่อ')}</strong>
            <span class="badge ${BADGE[o.status]||'badge-pending'}" style="margin-left:10px">${STATUS[o.status]||o.status}</span>
          </div>
          <div style="margin-top:4px;font-size:.82rem;color:var(--muted)">
            Order #${o.id} · ${new Date(o.created_at).toLocaleString('th-TH')}
            ${o.member_phone ? ` · 📞 ${esc(o.member_phone)}` : ''}
          </div>
          ${o.member_address ? `<div style="margin-top:6px;font-size:.82rem;color:var(--muted)">📍 ${esc(o.member_address)}</div>` : ''}
          ${o.note ? `<div style="margin-top:6px;font-size:.82rem;color:var(--muted)">📝 ${esc(o.note)}</div>` : ''}
        </div>

        <div class="om-section-title">รายการสินค้า</div>
        <table class="om-tbl">
          <thead><tr>
            <th>การ์ด</th><th>รหัส</th><th>ราคา/ชิ้น</th>
            <th>จำนวน</th><th>รวม</th><th></th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
          <tfoot><tr class="total-row">
            <td colspan="4" style="text-align:right;padding-right:16px">ยอดรวม</td>
            <td style="color:var(--accent);font-size:1rem">฿${Number(o.total_thb||0).toLocaleString('th-TH')}</td>
            <td></td>
          </tr></tfoot>
        </table>

        ${addBox}
      </div>
      <div class="om-footer">
        ${o.status==='pending' ? `<button class="btn btn-success btn-sm" onclick="omDeductAndClose()">✅ ตัดสต๊อก + ยืนยัน</button>` : ''}
        ${o.status!=='cancelled' ? `<button class="btn btn-danger btn-sm" onclick="omCancel()">ยกเลิกออเดอร์</button>` : ''}
        <span class="spacer"></span>
        <button class="btn btn-ghost btn-sm" onclick="closeOrderModal()">ปิด</button>
      </div>`;

    if (canEdit) renderAddStaging();
  } catch(e) {
    content.innerHTML = `<div style="padding:40px;text-align:center;color:#f87171">${esc(e.message)}</div>`;
  }
}

async function omChangeQty(itemId, newQty, orderId) {
  if (newQty < 1) {
    if (!confirm('จำนวนเป็น 0 จะลบรายการนี้ออก ยืนยัน?')) return;
    return omDeleteItem(itemId, orderId);
  }
  try {
    await api(`/api/admin/order-items/${itemId}`, { method:'PUT', json:{ qty: newQty } });
    await renderOrderModal();
  } catch(e) { toast('❌ ' + e.message, 'err'); }
}

async function omDeleteItem(itemId, orderId) {
  if (!confirm('ลบรายการนี้ออกจากออเดอร์?')) return;
  try {
    await api(`/api/admin/order-items/${itemId}`, { method:'DELETE' });
    await renderOrderModal();
  } catch(e) { toast('❌ ' + e.message, 'err'); }
}

function omSearchDebounce(val) {
  clearTimeout(_addSearchTimer);
  const dd = document.getElementById('addSearchDd');
  if (!val.trim()) { dd.style.display='none'; return; }
  _addSearchTimer = setTimeout(() => omDoSearch(val.trim()), 250);
}

async function omDoSearch(q) {
  const dd = document.getElementById('addSearchDd');
  if (!dd) return;
  try {
    const d = await api(`/api/admin/listings?q=${encodeURIComponent(q)}&limit=8`);
    const rows = (d.data||[]);
    if (!rows.length) { dd.style.display='none'; return; }
    dd.innerHTML = rows.map(l => `
      <div class="add-dd-item" onclick="omSelectListing(${l.id},'${esc(l.card_name)}','${esc(l.card_code||'')}',${l.price_thb},'${esc(l.custom_image||l.card_image||'')}',${l.stock_qty||0})">
        ${l.custom_image||l.card_image ? `<img src="${esc(l.custom_image||l.card_image)}" onerror="this.style.display='none'">` : '<div style="width:26px"></div>'}
        <div style="flex:1;min-width:0">
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.card_name)}</div>
          <div style="font-size:.72rem;color:var(--muted)">${esc(l.card_code||'')} · ฿${Number(l.price_thb).toLocaleString('th-TH')} · สต๊อก ${l.stock_qty||0}</div>
        </div>
      </div>`).join('');
    dd.style.display = 'block';
  } catch { dd.style.display='none'; }
}

function omSelectListing(id, name, code, price, image, stock) {
  _addStaging = { listing_id:id, card_name:name, card_code:code, price_thb:price, image, stock_qty:stock };
  _addQty = 1;
  const inp = document.getElementById('addSearchInput');
  if (inp) inp.value = name;
  document.getElementById('addSearchDd').style.display = 'none';
  renderAddStaging();
}

function renderAddStaging() {
  const area = document.getElementById('addStagingArea');
  if (!area) return;
  if (!_addStaging) { area.innerHTML = ''; return; }
  const s = _addStaging;
  const max = s.stock_qty || 0;
  area.innerHTML = `
    <div class="add-staging">
      ${s.image ? `<img src="${esc(s.image)}" onerror="this.style.display='none'">` : ''}
      <div class="add-staging-name">${esc(s.card_name)}${s.card_code?` <span style="color:var(--muted);font-size:.78rem">[${esc(s.card_code)}]</span>`:''}</div>
      <div class="add-staging-price">฿${Number(s.price_thb).toLocaleString('th-TH')}</div>
      <div class="add-staging-qty">
        <button onclick="omAddQtyChange(-1)" ${_addQty<=1?'disabled':''}>−</button>
        <span id="addQtyVal">${_addQty}</span>
        <button onclick="omAddQtyChange(1)" ${_addQty>=max?'disabled':''}>+</button>
      </div>
      <span style="font-size:.75rem;color:var(--muted)">(สต๊อก ${max})</span>
      <button class="btn btn-success btn-xs" onclick="omConfirmAdd()">+ เพิ่ม</button>
      <button class="btn btn-ghost btn-xs" onclick="_addStaging=null;renderAddStaging();document.getElementById('addSearchInput').value=''">ยกเลิก</button>
    </div>`;
}

function omAddQtyChange(delta) {
  if (!_addStaging) return;
  _addQty = Math.max(1, Math.min(_addQty + delta, _addStaging.stock_qty || 1));
  const el = document.getElementById('addQtyVal');
  if (el) el.textContent = _addQty;
  renderAddStaging();
}

async function omConfirmAdd() {
  if (!_addStaging) return;
  try {
    await api(`/api/admin/orders/${_curOrderId}/items`, {
      method:'POST', json:{ listing_id: _addStaging.listing_id, qty: _addQty }
    });
    _addStaging = null;
    _addQty = 1;
    await renderOrderModal();
    toast('เพิ่มรายการแล้ว');
  } catch(e) { toast('❌ ' + e.message, 'err'); }
}

async function omDeductAndClose() {
  await deductStock(_curOrderId);
  await renderOrderModal();
}

async function omCancel() {
  await cancelOrder(_curOrderId);
  await renderOrderModal();
}

function closeOrderModal() {
  document.getElementById('orderModal').classList.remove('open');
  _curOrderId = null;
  _addStaging = null;
  loadOrders();
}

document.getElementById('orderModal').addEventListener('click', e => {
  if (e.target === document.getElementById('orderModal')) closeOrderModal();
});

document.addEventListener('click', e => {
  const dd = document.getElementById('addSearchDd');
  if (dd && !dd.contains(e.target) && e.target.id !== 'addSearchInput') dd.style.display = 'none';
});

/* ════════════════════════════════════════════
   BULK ADD
════════════════════════════════════════════ */
const CONDITIONS = ['Gem Mint', 'Near Mint', 'Lightly Played', 'Damaged'];
let _bulkRowCount = 0;
let _bulkSearchTimers = {};

function bulkInit() {
  if (document.getElementById('bulkRows').children.length === 0) bulkAddRow();
}

function bulkAddRow() {
  const id = ++_bulkRowCount;
  const condOpts = CONDITIONS.map(c => `<option>${c}</option>`).join('');
  const tr = document.createElement('tr');
  tr.id = `brow-${id}`;
  tr.innerHTML = `
    <td class="bulk-name-cell">
      <input type="text" class="bulk-name-input" placeholder="ชื่อการ์ด..." autocomplete="off"
             oninput="bulkNameSearch(this,${id})" onblur="bulkHideDd(${id})">
      <div class="bulk-name-dd" id="bdd-${id}" onmousedown="event.preventDefault()"></div>
    </td>
    <td><input type="number" class="bulk-num-input" value="1" min="1" step="1"></td>
    <td class="bulk-foil-cell"><input type="checkbox" class="bulk-foil"></td>
    <td><select class="bulk-cond-select">${condOpts}</select></td>
    <td><input type="number" class="bulk-price-input" placeholder="0" min="0" step="1"></td>
    <td><button class="bulk-del-btn" onclick="bulkDeleteRow(${id})" title="ลบแถว">✕</button></td>`;
  document.getElementById('bulkRows').appendChild(tr);
  tr.querySelector('.bulk-name-input').focus();
}

function bulkDeleteRow(id) {
  document.getElementById(`brow-${id}`)?.remove();
}

function bulkNameSearch(input, rowId) {
  clearTimeout(_bulkSearchTimers[rowId]);
  const dd = document.getElementById(`bdd-${rowId}`);
  const q = input.value.trim();
  if (q.length < 2) { if (dd) dd.style.display = 'none'; return; }
  _bulkSearchTimers[rowId] = setTimeout(() => bulkDoSearch(q, rowId), 260);
}

async function bulkDoSearch(q, rowId) {
  const dd = document.getElementById(`bdd-${rowId}`);
  if (!dd) return;
  try {
    const d = await api(`/api/admin/search?q=${encodeURIComponent(q)}&limit=8`);
    const cards = d.data || [];
    if (!cards.length) { dd.style.display = 'none'; return; }
    dd.innerHTML = cards.map(c => {
      const img = c.image_url || c.image || '';
      const proxied = img ? `/api/image-proxy?url=${encodeURIComponent(img)}` : '';
      return `<div class="bulk-dd-item" onclick="bulkSelectCard('${esc(c.name||'')}',${rowId})">
        ${proxied ? `<img src="${proxied}" onerror="this.style.display='none'">` : ''}
        <span>${esc(c.name||'')}</span>
      </div>`;
    }).join('');
    dd.style.display = 'block';
  } catch { dd.style.display = 'none'; }
}

function bulkSelectCard(name, rowId) {
  const row = document.getElementById(`brow-${rowId}`);
  if (!row) return;
  row.querySelector('.bulk-name-input').value = name;
  row.querySelector('.bulk-name-input').classList.remove('input-err');
  const dd = document.getElementById(`bdd-${rowId}`);
  if (dd) dd.style.display = 'none';
}

function bulkHideDd(rowId) {
  setTimeout(() => { const dd = document.getElementById(`bdd-${rowId}`); if (dd) dd.style.display = 'none'; }, 160);
}

async function bulkSubmit() {
  const seller = document.getElementById('bulkSeller').value.trim();
  const rows = Array.from(document.querySelectorAll('#bulkRows tr'));
  if (!rows.length) return toast('❌ กรุณาเพิ่มการ์ดอย่างน้อย 1 แถว', 'err');

  const cards = [];
  let hasErr = false;

  rows.forEach(row => {
    const nameEl  = row.querySelector('.bulk-name-input');
    const priceEl = row.querySelector('.bulk-price-input');
    const name  = nameEl?.value.trim();
    const price = priceEl?.value;
    const qty   = parseInt(row.querySelector('.bulk-num-input')?.value) || 1;
    const foil  = row.querySelector('.bulk-foil')?.checked || false;
    const cond  = row.querySelector('.bulk-cond-select')?.value || 'Near Mint';

    nameEl?.classList.remove('input-err');
    priceEl?.classList.remove('input-err');

    if (!name)  { nameEl?.classList.add('input-err');  hasErr = true; }
    if (!price) { priceEl?.classList.add('input-err'); hasErr = true; }
    if (name && price) cards.push({ card_name: name, qty, foil, condition: cond, price_thb: parseFloat(price) });
  });

  if (hasErr) return toast('❌ กรุณากรอกชื่อการ์ดและราคาให้ครบ', 'err');
  if (!cards.length) return toast('❌ ไม่มีข้อมูลที่จะบันทึก', 'err');

  const resultEl = document.getElementById('bulkResult');
  resultEl.innerHTML = '';
  try {
    const d = await api('/api/admin/listings/bulk', { method: 'POST', json: { seller_name: seller, cards } });
    resultEl.innerHTML = `<div class="import-ok">✅ บันทึกสำเร็จ ${d.inserted} รายการ${d.skipped ? ` (ข้าม ${d.skipped} แถว)` : ''}</div>`;
    toast(`✅ บันทึก ${d.inserted} การ์ดสำเร็จ`);
    document.getElementById('bulkRows').innerHTML = '';
    _bulkRowCount = 0;
    bulkAddRow();
  } catch (e) {
    resultEl.innerHTML = `<div class="import-err">❌ ${esc(e.message)}</div>`;
    toast('❌ ' + e.message, 'err');
  }
}

/* ════════════════════════════════════════════
   KEYBOARD SHORTCUTS
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
  if (opts.json) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(opts.json); }
  else if (opts.body) { init.body = opts.body; }
  const r = await fetch(url, init);
  if (r.status === 401) { window.location.href = '/admin-login.html'; throw new Error('Unauthorized'); }
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || `HTTP ${r.status}`);
  }
  return r.json();
}

function normList(data, keys) {
  if (Array.isArray(data)) return data;
  for (const k of keys) if (Array.isArray(data[k])) return data[k];
  return [];
}

function getPrice(c) {
  return c.prices?.market || c.prices?.low || c.price?.market || c.marketPrice || c.price || 0;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function updatePreview(id, src) {
  const el = document.getElementById(id);
  el.innerHTML = src
    ? `<img src="${esc(src)}" alt="" onerror="this.outerHTML='<span class=img-ph>🃏</span>'">`
    : '<span class="img-ph">🃏</span>';
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
