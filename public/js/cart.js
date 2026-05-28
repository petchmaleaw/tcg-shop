/* ══════════════════════════════════════════════
   TCG Shop — Cart Page JS
══════════════════════════════════════════════ */

const CART_KEY = 'tcg_cart';
let member = null;
let fbPage = '';

/* ── localStorage helpers ── */
function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
  catch { return []; }
}
function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

/* ── Init ── */
async function init() {
  const [meRes, settingsRes] = await Promise.all([
    fetch('/api/auth/me').then(r => r.json()).catch(() => ({ authenticated: false })),
    fetch('/api/settings').then(r => r.json()).catch(() => ({}))
  ]);
  member = meRes.authenticated ? meRes : null;
  fbPage = settingsRes.facebook_page || '';
  renderMemberNav();
  await validateAndRender();
}

function renderMemberNav() {
  const nav = document.getElementById('memberNav');
  if (member) {
    nav.innerHTML = `สวัสดี <strong>${esc(member.name)}</strong>
      <button onclick="logout()" style="margin-left:8px;background:none;border:none;color:var(--muted);cursor:pointer;font-family:Kanit,sans-serif;font-size:.82rem">ออกจากระบบ</button>`;
  } else {
    nav.innerHTML = `<a href="/login.html?redirect=/cart.html" style="color:var(--accent);text-decoration:none;font-size:.85rem">เข้าสู่ระบบ</a>`;
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.reload();
}

/* ── Validate cart with server ── */
async function validateAndRender() {
  const cart = getCart();
  if (!cart.length) { renderCart([]); return; }

  try {
    const res  = await fetch('/api/cart/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: cart.map(i => ({ id: i.id, qty: i.qty })) })
    });
    const data = await res.json();

    /* Sync cart with validated data */
    const updated = [];
    for (const v of data.items) {
      if (v.status === 'not_found') continue; // remove from cart
      const original = cart.find(c => c.id === v.id);
      if (!original) continue;
      updated.push({
        ...original,
        qty:       v.qty,
        available: v.available,
        status:    v.status,
        price_thb: v.listing?.price_thb ?? original.price_thb
      });
    }
    saveCart(updated.map(i => ({ id:i.id, card_name:i.card_name, card_code:i.card_code,
                                  price_thb:i.price_thb, image:i.image, qty:i.qty })));
    renderCart(updated);
  } catch {
    /* Server offline — render from localStorage */
    renderCart(cart.map(i => ({ ...i, status: 'ok', available: i.qty })));
  }
}

/* ── Render ── */
function renderCart(items) {
  const container = document.getElementById('cartItems');

  if (!items.length) {
    container.innerHTML = `<div class="empty"><div class="icon">🛒</div>
      <p>ตะกร้าว่างเปล่า<br><a href="/">เลือกซื้อสินค้า</a></p></div>`;
    updateSummary([]);
    return;
  }

  container.innerHTML = items.map((item, idx) => {
    const warn = item.status === 'out_of_stock'
      ? '<span class="cart-warn warn-out">⚠️ สินค้าหมด — จะถูกนำออกจากตะกร้า</span>'
      : item.status === 'reduced'
        ? `<span class="cart-warn warn-reduced">⚠️ เหลือเพียง ${item.available} ชิ้น</span>`
        : '';

    const canBuy = item.status !== 'out_of_stock';
    const maxQ   = item.available || item.qty;

    return `
      <div class="cart-item" id="item-${idx}">
        ${item.image
          ? `<img class="cart-img" src="${esc(item.image)}" alt="" onerror="this.outerHTML='<div class=cart-img-ph>🃏</div>'">`
          : '<div class="cart-img-ph">🃏</div>'}
        <div class="cart-info">
          <div class="cart-name">${esc(item.card_name)}</div>
          <div class="cart-code">${esc(item.card_code || '')}</div>
          <div class="cart-price">฿${Number(item.price_thb).toLocaleString('th-TH')}</div>
          ${warn}
        </div>
        <div class="cart-right">
          <div class="qty-ctrl">
            <button onclick="changeQty(${idx}, -1)" ${item.qty <= 1 || !canBuy ? 'disabled' : ''}>−</button>
            <span>${item.qty}</span>
            <button onclick="changeQty(${idx}, +1)" ${item.qty >= maxQ || !canBuy ? 'disabled' : ''}>+</button>
          </div>
          <div class="subtotal">รวม <strong>฿${(item.price_thb * item.qty).toLocaleString('th-TH')}</strong></div>
          <button class="remove-btn" onclick="removeItem(${idx})">✕ นำออก</button>
        </div>
      </div>`;
  }).join('');

  updateSummary(items);
  renderOrderForm(items);
}

function updateSummary(items) {
  const validItems = items.filter(i => i.status !== 'out_of_stock');
  const total = validItems.reduce((s, i) => s + i.price_thb * i.qty, 0);
  document.getElementById('grandTotal').textContent = `฿${total.toLocaleString('th-TH')}`;
  const btn = document.getElementById('fbOrderBtn');
  btn.disabled = validItems.length === 0;
}

function renderOrderForm(items) {
  const area  = document.getElementById('memberInfoArea');
  const hint  = document.getElementById('loginHint');

  if (member) {
    area.innerHTML = `
      <div class="member-info">
        <strong>${esc(member.name)}</strong><br>
        ${member.phone ? `📞 ${esc(member.phone)}<br>` : ''}
        ${member.address ? `📍 ${esc(member.address)}` : '<span style="color:#f59e0b;font-size:.78rem">⚠️ ยังไม่มีที่อยู่จัดส่ง — <a href="/profile.html" style="color:var(--accent)">เพิ่มที่อยู่</a></span>'}
      </div>`;
    hint.innerHTML = '';
  } else {
    area.innerHTML = `
      <div class="field"><label>ชื่อ-นามสกุล *</label><input type="text" id="oc_name" placeholder="ชื่อ นามสกุล"></div>
      <div class="field"><label>เบอร์โทร *</label><input type="tel" id="oc_phone" placeholder="0812345678"></div>
      <div class="field"><label>ที่อยู่จัดส่ง *</label><textarea id="oc_address" placeholder="บ้านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์" style="width:100%;padding:9px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:Kanit,sans-serif;font-size:.88rem;outline:none;resize:vertical;min-height:72px"></textarea></div>`;
    hint.innerHTML = `<a href="/login.html?redirect=/cart.html">เข้าสู่ระบบ</a> เพื่อใช้ข้อมูลสมาชิกอัตโนมัติ`;
  }
}

/* ── Quantity change ── */
function changeQty(idx, delta) {
  const cart = getCart();
  if (!cart[idx]) return;
  const items = JSON.parse(document.getElementById('cartItems').querySelectorAll('.cart-item')[idx]
    ?.querySelector('.qty-ctrl span')?.textContent || cart[idx].qty);
  validateAndRender(); // re-validate; also update qty in localStorage below
  const newQty = cart[idx].qty + delta;
  if (newQty < 1) return;
  cart[idx].qty = newQty;
  saveCart(cart);
  validateAndRender();
}

function removeItem(idx) {
  const cart = getCart();
  cart.splice(idx, 1);
  saveCart(cart);
  validateAndRender();
  updateCartIcon();
}

/* ── Place order ── */
async function placeOrder() {
  const cart  = getCart();
  const items = cart.filter(i => i.qty > 0);
  if (!items.length) return;

  let memberName, memberPhone, memberAddress;
  if (member) {
    memberName    = member.name;
    memberPhone   = member.phone;
    memberAddress = member.address;
  } else {
    memberName    = document.getElementById('oc_name')?.value.trim();
    memberPhone   = document.getElementById('oc_phone')?.value.trim();
    memberAddress = document.getElementById('oc_address')?.value.trim();
    if (!memberName || !memberPhone || !memberAddress) {
      alert('กรุณากรอกชื่อ เบอร์โทร และที่อยู่จัดส่งก่อน');
      return;
    }
  }

  const btn = document.getElementById('fbOrderBtn');
  btn.disabled = true;
  btn.textContent = '⏳ กำลังส่งคำสั่งซื้อ...';

  try {
    const res  = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_name: memberName, member_phone: memberPhone,
                             member_address: memberAddress, items })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'เกิดข้อผิดพลาด');

    /* Build order message */
    const lines = items.map((i, n) =>
      `${n+1}. ${i.card_name}${i.card_code ? ` [${i.card_code}]` : ''} x${i.qty} = ฿${(i.price_thb*i.qty).toLocaleString('th-TH')}`
    );
    const total = items.reduce((s, i) => s + i.price_thb * i.qty, 0);
    const msg = [
      `สวัสดีครับ/ค่ะ ต้องการสั่งซื้อการ์ด (Order #${data.orderId})`,
      '',
      ...lines,
      '',
      `รวม: ฿${total.toLocaleString('th-TH')}`,
      '',
      `ชื่อ: ${memberName}`,
      memberPhone   ? `เบอร์: ${memberPhone}`       : '',
      memberAddress ? `ที่อยู่: ${memberAddress}` : '',
    ].filter(Boolean).join('\n');

    document.getElementById('modalOrderId').textContent = `Order #${data.orderId}`;
    document.getElementById('orderMessage').textContent = msg;
    document.getElementById('successModal').classList.add('open');

    /* Open Facebook Messenger */
    if (fbPage) {
      setTimeout(() => window.open(`https://m.me/${fbPage}`, '_blank'), 400);
    }

    /* Clear cart */
    saveCart([]);
    updateCartIcon();

  } catch (e) {
    alert('เกิดข้อผิดพลาด: ' + e.message);
  }

  btn.disabled = false;
  btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg> สั่งซื้อผ่าน Facebook`;
}

/* ── Modal ── */
function copyMessage() {
  navigator.clipboard.writeText(document.getElementById('orderMessage').textContent)
    .then(() => { const b = document.querySelector('.copy-btn'); b.textContent='✅ คัดลอกแล้ว!'; setTimeout(() => b.textContent='📋 คัดลอก', 2000); })
    .catch(() => {});
}

function closeModal() {
  document.getElementById('successModal').classList.remove('open');
  validateAndRender();
}

document.getElementById('successModal').addEventListener('click', e => {
  if (e.target === document.getElementById('successModal')) closeModal();
});

/* ── Shared cart icon helper (also used on main page) ── */
function updateCartIcon() {
  const cart  = getCart();
  const total = cart.reduce((s, i) => s + i.qty, 0);
  const el    = document.getElementById('cartCount');
  if (el) el.textContent = total;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
