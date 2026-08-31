// Standalone pricing calculator. Every price value shown here comes from the
// server-side pricing engine response; nothing is calculated or reconstructed
// in the browser.
const form = document.querySelector('#price-form');
const errorBox = document.querySelector('#error');
const resultBox = document.querySelector('#result');
const materialSelect = document.querySelector('#material');
const complexitySelect = document.querySelector('#complexity');
const depthHint = document.querySelector('#depth-hint');

// Presentation-only Thai labels. Unknown keys fall back to the raw key so a new
// material or complexity added to the rules still renders instead of breaking.
const MATERIAL_LABELS = {
  granite: 'หินแกรนิต',
  marble: 'หินอ่อน',
  acrylic: 'อะคริลิก',
  sandstone: 'หินทราย'
};
const COMPLEXITY_LABELS = {
  simple: 'เรียบง่าย',
  standard: 'มาตรฐาน',
  detailed: 'ละเอียด',
  premium: 'พิเศษ'
};
const BREAKDOWN_LABELS = {
  material: 'ค่าวัสดุ',
  depth: 'ค่าเจาะลึกเพิ่ม',
  cnc: 'ค่างาน CNC',
  setup: 'ค่าเตรียมงาน',
  paint: 'ค่าทาสี',
  installation: 'ค่าติดตั้ง'
};

const money = amount => new Intl.NumberFormat('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(amount);

const label = (map, key) => map[key] || key;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function fillSelect(select, keys, labels, selected) {
  select.innerHTML = keys
    .map(key => `<option value="${escapeHtml(key)}"${key === selected ? ' selected' : ''}>${escapeHtml(label(labels, key))}</option>`)
    .join('');
}

async function loadOptions() {
  try {
    const response = await fetch('/api/pricing/options');
    if (!response.ok) throw new Error('options unavailable');
    const options = await response.json();
    fillSelect(materialSelect, options.materials ?? [], MATERIAL_LABELS, '');
    materialSelect.insertAdjacentHTML('afterbegin', '<option value="">เลือกวัสดุ</option>');
    materialSelect.value = '';
    fillSelect(complexitySelect, options.complexities ?? [], COMPLEXITY_LABELS, options.defaultComplexity);
    if (Number.isFinite(options.depthThresholdMm)) {
      depthHint.textContent = `คิดค่าเจาะลึกเพิ่มเมื่อเกิน ${options.depthThresholdMm} มม.`;
    }
  } catch (loadError) {
    materialSelect.innerHTML = '<option value="">โหลดตัวเลือกไม่สำเร็จ</option>';
    complexitySelect.innerHTML = '<option value="">โหลดตัวเลือกไม่สำเร็จ</option>';
    errorBox.textContent = 'โหลดตัวเลือกวัสดุไม่สำเร็จ กรุณารีเฟรชหน้านี้';
  }
}

// UX-only checks. The server re-validates everything and stays authoritative.
function localValidation(values) {
  if (!values.material) return 'กรุณาเลือกวัสดุ';
  if (!(values.widthCm > 0)) return 'ความกว้างต้องมากกว่า 0';
  if (!(values.heightCm > 0)) return 'ความสูงต้องมากกว่า 0';
  if (!(values.depthMm >= 0)) return 'ความหนาต้องไม่ติดลบ';
  if (!Number.isInteger(values.quantity) || values.quantity < 1) return 'จำนวนต้องเป็นจำนวนเต็มมากกว่า 0';
  if (!values.complexity) return 'กรุณาเลือกความซับซ้อน';
  return null;
}

function readForm() {
  const elements = form.elements;
  return {
    material: elements.material.value,
    widthCm: Number(elements.widthCm.value),
    heightCm: Number(elements.heightCm.value),
    depthMm: Number(elements.depthMm.value),
    quantity: Number(elements.quantity.value),
    complexity: elements.complexity.value,
    rush: elements.rush.checked,
    paint: elements.paint.checked,
    install: elements.install.checked
  };
}

function showResult(payload, values) {
  const result = payload.result;
  const currency = payload.currency || 'THB';
  // Zero rows are kept so the breakdown adds up visibly.
  const rows = Object.entries(result.breakdown ?? {})
    .map(([key, amount]) => `<tr${amount > 0 ? '' : ' class="zero"'}><td>${escapeHtml(label(BREAKDOWN_LABELS, key))}</td><td>${money(amount)}</td></tr>`)
    .join('');

  const meta = [
    `วัสดุ: ${escapeHtml(label(MATERIAL_LABELS, result.material))}`,
    `ขนาด: ${values.widthCm} × ${values.heightCm} ซม. · หนา ${values.depthMm} มม.`,
    `จำนวน: ${result.quantity} ชิ้น · ${escapeHtml(label(COMPLEXITY_LABELS, values.complexity))}`,
    Number.isFinite(result.area_cm2) ? `พื้นที่รวม: ${money(result.area_cm2)} ตร.ซม.` : '',
    Number.isFinite(result.cnc_minutes) ? `เวลา CNC: ${money(result.cnc_minutes)} นาที` : '',
    result.rush_multiplier && result.rush_multiplier !== 1 ? `งานด่วน: ×${result.rush_multiplier}` : ''
  ].filter(Boolean).map(line => `<div>${line}</div>`).join('');

  resultBox.innerHTML = `
    <div class="total">
      <p class="label">ราคารวม</p>
      <div class="amount">${money(result.total)} <span class="currency">${escapeHtml(currency)}</span></div>
    </div>
    <div class="meta">${meta}</div>
    <table>
      <thead><tr><th>รายการ</th><th>ราคา (${escapeHtml(currency)})</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th>รวมทั้งสิ้น</th><th>${money(result.total)}</th></tr></tfoot>
    </table>
    <p class="disclaimer">ราคาประเมินเบื้องต้น อาจเปลี่ยนแปลงตามรายละเอียดงานจริง</p>
    <button class="print-button no-print" type="button" id="print-button">พิมพ์ / บันทึก PDF</button>`;
  resultBox.classList.remove('hidden');
  resultBox.querySelector('#print-button').addEventListener('click', () => window.print());
  resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.textContent = '';
  const values = readForm();
  const localError = localValidation(values);
  if (localError) {
    errorBox.textContent = localError;
    resultBox.classList.add('hidden');
    return;
  }

  try {
    const response = await fetch('/api/price', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'คำนวณราคาไม่สำเร็จ');
    showResult(payload, values);
  } catch (requestError) {
    resultBox.classList.add('hidden');
    errorBox.textContent = requestError.message;
  }
});

loadOptions();
