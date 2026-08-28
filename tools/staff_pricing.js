const fs = require('node:fs');
const path = require('node:path');
const { calculateJobPrice } = require('./pricing_engine');

const DEFAULT_RULES_PATH = path.join(__dirname, '..', 'data', 'pricing_rules.json');

class StaffPricingInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StaffPricingInputError';
  }
}

const MATERIAL_ALIASES = new Map([
  ['granite', 'granite'], ['แกรนิต', 'granite'],
  ['marble', 'marble'], ['หินอ่อน', 'marble'],
  ['acrylic', 'acrylic'], ['อะคริลิก', 'acrylic'], ['อะคริลิค', 'acrylic'],
  ['sandstone', 'sandstone'], ['หินทราย', 'sandstone']
]);

function getSupportedMaterials() {
  const materials = new Map();
  for (const [alias, canonical] of MATERIAL_ALIASES) {
    if (!materials.has(canonical)) materials.set(canonical, []);
    materials.get(canonical).push(alias);
  }
  return [...materials].map(([canonical, aliases]) => ({ canonical, aliases }));
}

function loadRules(rulesPath = DEFAULT_RULES_PATH) {
  return JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
}

function parsePositiveNumber(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new StaffPricingInputError(`${field} ต้องมากกว่า 0`);
  return parsed;
}

// Telegram appends "@botusername" to commands sent in groups and supergroups,
// so "/price@oas_stone_shop_bot" must resolve to the same command as "/price".
// The allowlist accepts negative group IDs specifically so the bot can serve a
// staff group, which is exactly where the suffixed form is what clients send.
function commandName(token) {
  return typeof token === 'string' ? token.split('@', 1)[0].toLowerCase() : '';
}

// Number() accepts exponent, hex and signed forms, so "1e308" survived the
// previous Number.isInteger check and pushed the totals to Infinity, which was
// then rendered to staff as "∞ บาท". Quantity is restricted to canonical
// decimal digits within the safe integer range instead.
function parseQuantity(value) {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    throw new StaffPricingInputError('จำนวนต้องเป็นเลขจำนวนเต็มบวก');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new StaffPricingInputError('จำนวนต้องเป็นเลขจำนวนเต็มบวก');
  }
  return parsed;
}

function parsePriceCommand(text) {
  if (typeof text !== 'string') throw new StaffPricingInputError('รูปแบบคำสั่งไม่ถูกต้อง');
  const parts = text.trim().split(/\s+/);
  if (commandName(parts[0]) !== '/price') throw new StaffPricingInputError('ต้องเริ่มด้วย /price');
  if (parts.length < 3 || parts.length > 4) {
    throw new StaffPricingInputError('ใช้: /price <วัสดุ> <กว้าง_cm>x<สูง_cm> [จำนวน]');
  }

  const material = MATERIAL_ALIASES.get(parts[1].toLowerCase());
  if (!material) throw new StaffPricingInputError('ไม่รู้จักวัสดุ ใช้ granite, marble, acrylic หรือ sandstone');

  const sizeMatch = parts[2].match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i);
  if (!sizeMatch) throw new StaffPricingInputError('ขนาดต้องเป็นรูปแบบ กว้างxสูง เช่น 30x20');

  const widthCm = parsePositiveNumber(sizeMatch[1], 'ความกว้าง');
  const heightCm = parsePositiveNumber(sizeMatch[2], 'ความสูง');
  const quantity = parts[3] === undefined ? 1 : parseQuantity(parts[3]);

  return { material, widthCm, heightCm, quantity };
}

function formatBaht(value) {
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function quoteStaffPrice(text, { rules = loadRules() } = {}) {
  const input = parsePriceCommand(text);
  const result = calculateJobPrice({
    id: 'STAFF-PRICE',
    material: input.material,
    width_cm: input.widthCm,
    height_cm: input.heightCm,
    depth_mm: 3,
    quantity: input.quantity,
    complexity: 'standard',
    rush: false,
    paint: false,
    install: false
  }, rules);

  return [
    `ประเมินราคา ${input.material} ${input.widthCm}×${input.heightCm} ซม. จำนวน ${input.quantity}`,
    `พื้นที่ต่อชิ้น: ${formatBaht(result.area_cm2)} ตร.ซม.`,
    `ค่าวัสดุ: ${formatBaht(result.breakdown.material)} บาท`,
    `ค่า CNC: ${formatBaht(result.breakdown.cnc)} บาท`,
    `ค่าเตรียมงาน: ${formatBaht(result.breakdown.setup)} บาท`,
    `รวมประมาณ: ${formatBaht(result.total)} บาท`,
    'ค่ามาตรฐาน: depth 3 mm, complexity standard, ไม่เร่ง, ไม่ทาสี, ไม่ติดตั้ง'
  ].join('\n');
}

module.exports = {
  StaffPricingInputError,
  commandName,
  getSupportedMaterials,
  parsePriceCommand,
  quoteStaffPrice
};
