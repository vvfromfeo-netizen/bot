// Utility functions for formatting, dates, and validation

function formatMoney(amount) {
  const n = Number(amount) || 0;
  const rub = Math.floor(Math.abs(n));
  const kop = Math.round((Math.abs(n) - rub) * 100);
  const sign = n < 0 ? '-' : '';
  return `${sign}${rub} руб. ${String(kop).padStart(2, '0')} коп.`;
}

function formatMoneyShort(amount) {
  const n = Number(amount) || 0;
  return `${n.toFixed(2)} руб.`;
}

function monthKey(date = new Date()) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${m}.${y}`;
}

function prevMonthKey(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return monthKey(d);
}

function monthKeyToDate(mk) {
  const [m, y] = mk.split('.').map(Number);
  return new Date(y, m - 1, 1);
}

// Parse DD.MM.YYYY (or DD.MM.YY) user input → ISO date string (YYYY-MM-DD)
function parseDateInput(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  let day = parseInt(m[1], 10);
  let mon = parseInt(m[2], 10);
  let yr = parseInt(m[3], 10);
  if (yr < 100) yr += 2000;
  if (mon < 1 || mon > 12) return null;
  const d = new Date(yr, mon - 1, day);
  if (d.getDate() !== day || d.getMonth() !== mon - 1 || d.getFullYear() !== yr) return null;
  return `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Format ISO date → DD.MM.YYYY for display
function formatDate(date) {
  if (!date) return 'бессрочно';
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const yr = d.getFullYear();
  return `${day}.${mon}.${yr}`;
}

function isValidDateStr(str) {
  return parseDateInput(str) !== null;
}

function isCurrentOrFutureMonth(dateStr) {
  if (!dateStr) return false;
  // Accept both DD.MM.YYYY and YYYY-MM-DD formats
  const iso = parseDateInput(dateStr) || (isValidIsoDate(dateStr) ? dateStr : null);
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  const firstOfCurrent = new Date(now.getFullYear(), now.getMonth(), 1);
  return d >= firstOfCurrent;
}

function isValidIsoDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(new Date(str).getTime());
}

function isValidPositiveNumber(str) {
  if (str == null) return false;
  const n = parseNumber(str);
  return n !== null && n >= 0;
}

// parseNumber: replace comma with dot, strip spaces, validate
function parseNumber(str) {
  if (str == null) return null;
  const cleaned = String(str).trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+([.]\d+)?$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function normalizeNumber(str) {
  return parseNumber(str);
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function generateToken() {
  return require('crypto').randomBytes(16).toString('hex');
}

function escapeMarkdown(text) {
  if (text == null) return '';
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

function toFirstDayOfMonth(dateStr) {
  const iso = parseDateInput(dateStr) || dateStr;
  const d = new Date(iso);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return first.toISOString().split('T')[0];
}

// Get the last day of a month as ISO date string
function lastDayOfMonth(year, month) {
  const d = new Date(year, month, 0);
  return `${year}-${String(month).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = {
  formatMoney,
  formatMoneyShort,
  monthKey,
  prevMonthKey,
  monthKeyToDate,
  parseDateInput,
  isValidDateStr,
  isCurrentOrFutureMonth,
  isValidPositiveNumber,
  parseNumber,
  normalizeNumber,
  round2,
  generateToken,
  escapeMarkdown,
  formatDate,
  toFirstDayOfMonth,
  lastDayOfMonth,
};
