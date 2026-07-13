const form = document.querySelector('#quote-form');
const quote = document.querySelector('#quote');
const error = document.querySelector('#error');
const money = amount => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(amount);

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function showQuote(data) {
  const rows = Object.entries(data.result.breakdown)
    .filter(([, amount]) => amount > 0)
    .map(([name, amount]) => `<tr><td>${escapeHtml(name)}</td><td>${money(amount)}</td></tr>`)
    .join('');
  const rush = data.job.rush ? 'ใช่ (x' + data.result.rush_multiplier + ')' : 'ไม่';

  quote.innerHTML = `
    <div class="quote-header"><div><h2>${data.shopName}</h2><p>ใบเสนอราคาเบื้องต้น</p></div><div class="quote-meta"><b>${data.quoteNumber}</b><br>${data.createdAt}</div></div>
    <hr>
    <div class="quote-grid"><div><h3>ลูกค้า</h3><p>${escapeHtml(data.customer.name)}<br>${escapeHtml(data.customer.phone)}</p></div><div><h3>รายละเอียดงาน</h3><p>${escapeHtml(data.job.jobType)} · ${escapeHtml(data.job.material)}<br>${data.job.width_cm} × ${data.job.height_cm} cm · ${data.job.quantity} ชิ้น<br>ความซับซ้อน: ${escapeHtml(data.job.complexity)}<br>งานด่วน: ${rush}${data.job.notes ? `<br>หมายเหตุ: ${escapeHtml(data.job.notes)}` : ''}</p></div></div>
    <table><thead><tr><th>รายการ</th><th>ราคา</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th>ยอดรวม</th><th>${money(data.result.total)}</th></tr></tfoot></table>
    <p class="disclaimer">ราคาเบื้องต้น กรุณาตรวจแบบและเงื่อนไขก่อนยืนยันงาน</p>
    <button class="print-button no-print" type="button" onclick="window.print()">Print / Save as PDF</button>`;
  quote.classList.remove('hidden');
  quote.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  error.textContent = '';
  const values = Object.fromEntries(new FormData(form));
  values.rush = form.elements.rush.checked;
  try {
    const response = await fetch('/api/quotes/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'ไม่สามารถสร้าง Quote Preview ได้');
    showQuote(data);
  } catch (requestError) {
    error.textContent = requestError.message;
  }
});
