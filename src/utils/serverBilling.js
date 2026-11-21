const BILLING_CYCLES = Object.freeze([
  { value: 'month', months: 1, labelZh: '月', labelEn: 'Monthly', shortLabelZh: '月', shortLabelEn: 'M' },
  { value: 'quarter', months: 3, labelZh: '季', labelEn: 'Quarterly', shortLabelZh: '季', shortLabelEn: 'Q' },
  { value: 'half_year', months: 6, labelZh: '半年', labelEn: 'Half-yearly', shortLabelZh: '半年', shortLabelEn: 'HY' },
  { value: 'year', months: 12, labelZh: '年', labelEn: 'Yearly', shortLabelZh: '年', shortLabelEn: 'Y' },
  { value: 'two_years', months: 24, labelZh: '两年', labelEn: 'Two years', shortLabelZh: '2年', shortLabelEn: '2Y' },
  { value: 'three_years', months: 36, labelZh: '三年', labelEn: 'Three years', shortLabelZh: '3年', shortLabelEn: '3Y' },
  { value: 'four_years', months: 48, labelZh: '四年', labelEn: 'Four years', shortLabelZh: '4年', shortLabelEn: '4Y' },
  { value: 'five_years', months: 60, labelZh: '五年', labelEn: 'Five years', shortLabelZh: '5年', shortLabelEn: '5Y' }
]);

const CURRENCY_OPTIONS = Object.freeze([
  // 主流货币
  { symbol: '$', nameZh: '美元', nameEn: 'US Dollar' },
  { symbol: '¥', nameZh: '人民币', nameEn: 'Chinese Yuan' },
  { symbol: '€', nameZh: '欧元', nameEn: 'Euro' },
  { symbol: '£', nameZh: '英镑', nameEn: 'British Pound' },
  { symbol: '¥JPY', nameZh: '日元', nameEn: 'Japanese Yen' },
  { symbol: 'HK$', nameZh: '港币', nameEn: 'Hong Kong Dollar' },
  { symbol: 'A$', nameZh: '澳元', nameEn: 'Australian Dollar' },
  { symbol: 'C$', nameZh: '加拿大元', nameEn: 'Canadian Dollar' },
  { symbol: 'S$', nameZh: '新加坡元', nameEn: 'Singapore Dollar' },
  { symbol: 'NZ$', nameZh: '新西兰元', nameEn: 'New Zealand Dollar' },
  { symbol: '₣', nameZh: '瑞士法郎', nameEn: 'Swiss Franc' },
  { symbol: '₩', nameZh: '韩元', nameEn: 'Korean Won' },
  { symbol: '₹', nameZh: '印度卢比', nameEn: 'Indian Rupee' },
  // 亚太货币
  { symbol: '฿', nameZh: '泰铢', nameEn: 'Thai Baht' },
  { symbol: '₫', nameZh: '越南盾', nameEn: 'Vietnamese Dong' },
  { symbol: '₱', nameZh: '菲律宾比索', nameEn: 'Philippine Peso' },
  { symbol: 'Rp', nameZh: '印尼盾', nameEn: 'Indonesian Rupiah' },
  { symbol: 'RM', nameZh: '马来西亚林吉特', nameEn: 'Malaysian Ringgit' },
  { symbol: '₺', nameZh: '土耳其里拉', nameEn: 'Turkish Lira' },
  { symbol: '₪', nameZh: '以色列新谢克尔', nameEn: 'Israeli Shekel' },
  { symbol: '৳', nameZh: '孟加拉塔卡', nameEn: 'Bangladeshi Taka' },
  { symbol: '₨', nameZh: '巴基斯坦卢比', nameEn: 'Pakistani Rupee' },
  { symbol: 'LKR', nameZh: '斯里兰卡卢比', nameEn: 'Sri Lankan Rupee' },
  { symbol: '₮', nameZh: '蒙古图格里克', nameEn: 'Mongolian Tugrik' },
  // 其他地区
  { symbol: '₽', nameZh: '卢布', nameEn: 'Russian Ruble' },
  { symbol: 'R$', nameZh: '巴西雷亚尔', nameEn: 'Brazilian Real' },
  { symbol: 'kr', nameZh: '克朗', nameEn: 'Krona (SEK/NOK/DKK)' },
  { symbol: 'zł', nameZh: '波兰兹罗提', nameEn: 'Polish Zloty' },
  { symbol: '₴', nameZh: '乌克兰格里夫纳', nameEn: 'Ukrainian Hryvnia' },
  { symbol: '₸', nameZh: '哈萨克坦戈', nameEn: 'Kazakhstani Tenge' },
  { symbol: 'R', nameZh: '南非兰特', nameEn: 'South African Rand' },
  { symbol: '₦', nameZh: '尼日利亚奈拉', nameEn: 'Nigerian Naira' },
  { symbol: 'EGP', nameZh: '埃及镑', nameEn: 'Egyptian Pound' },
  { symbol: 'د.إ', nameZh: '阿联酋迪拉姆', nameEn: 'UAE Dirham' },
  { symbol: '﷼', nameZh: '沙特里亚尔', nameEn: 'Saudi Riyal' },
  { symbol: 'Q', nameZh: '危地马拉格查尔', nameEn: 'Guatemalan Quetzal' }
]);

const CYCLE_ALIASES = new Map([
  ['月', 'month'],
  ['monthly', 'month'],
  ['month', 'month'],
  ['mo', 'month'],
  ['季', 'quarter'],
  ['季度', 'quarter'],
  ['quarter', 'quarter'],
  ['quarterly', 'quarter'],
  ['半年', 'half_year'],
  ['halfyear', 'half_year'],
  ['half_year', 'half_year'],
  ['half-yearly', 'half_year'],
  ['年', 'year'],
  ['一年', 'year'],
  ['year', 'year'],
  ['yearly', 'year'],
  ['annual', 'year'],
  ['两年', 'two_years'],
  ['二年', 'two_years'],
  ['two_years', 'two_years'],
  ['2 years', 'two_years'],
  ['三年', 'three_years'],
  ['three_years', 'three_years'],
  ['3 years', 'three_years'],
  ['四年', 'four_years'],
  ['four_years', 'four_years'],
  ['4 years', 'four_years'],
  ['五年', 'five_years'],
  ['five_years', 'five_years'],
  ['5 years', 'five_years']
]);

const NORMALIZED_CURRENCIES = new Set(CURRENCY_OPTIONS.map(item => item.symbol));
const MULTI_CHAR_CURRENCIES_SORTED = Object.freeze(
  CURRENCY_OPTIONS
    .filter(item => item.symbol.length > 1)
    .sort((a, b) => b.symbol.length - a.symbol.length)
);
const MULTI_CHAR_SYMBOL_ONLY_CURRENCIES = Object.freeze(
  MULTI_CHAR_CURRENCIES_SORTED.filter(item => !/^[A-Za-z]+$/.test(item.symbol))
);
const SINGLE_CHAR_NON_ALPHA_CURRENCIES = Object.freeze(
  CURRENCY_OPTIONS.filter(item => item.symbol.length === 1 && !/^[A-Za-z]$/.test(item.symbol))
);
const CURRENCY_CODE_MAP = new Map([
  ['USD', '$'], ['US$', '$'],
  ['CNY', '¥'], ['RMB', '¥'], ['CNH', '¥'],
  ['EUR', '€'],
  ['GBP', '£'],
  ['JPY', '¥JPY'], ['JP¥', '¥JPY'],
  ['HKD', 'HK$'],
  ['AUD', 'A$'], ['AU$', 'A$'],
  ['CAD', 'C$'], ['CA$', 'C$'],
  ['SGD', 'S$'], ['SG$', 'S$'],
  ['NZD', 'NZ$'],
  ['CHF', '₣'],
  ['KRW', '₩'],
  ['INR', '₹'],
  ['THB', '฿'],
  ['VND', '₫'],
  ['PHP', '₱'],
  ['IDR', 'Rp'], ['RP', 'Rp'],
  ['MYR', 'RM'], ['RM', 'RM'],
  ['TRY', '₺'],
  ['ILS', '₪'],
  ['BDT', '৳'],
  ['PKR', '₨'],
  ['LKR', 'LKR'],
  ['MNT', '₮'],
  ['RUB', '₽'],
  ['BRL', 'R$'],
  ['SEK', 'kr'], ['NOK', 'kr'], ['DKK', 'kr'], ['ISK', 'kr'], ['KR', 'kr'],
  ['PLN', 'zł'], ['ZL', 'zł'],
  ['UAH', '₴'],
  ['KZT', '₸'],
  ['ZAR', 'R'],
  ['NGN', '₦'],
  ['EGP', 'EGP'],
  ['AED', 'د.إ'],
  ['SAR', '﷼'],
  ['GTQ', 'Q']
]);
const DETECT_CODE_REGEX = /(?:^|[^A-Za-z])(USD|CNY|RMB|CNH|EUR|GBP|JPY|HKD|AUD|CAD|SGD|NZD|CHF|KRW|INR|THB|VND|PHP|IDR|MYR|RM|TRY|ILS|BDT|PKR|LKR|MNT|RUB|BRL|SEK|NOK|DKK|ISK|PLN|UAH|KZT|ZAR|NGN|EGP|AED|SAR|GTQ|Rp|kr)(?![A-Za-z])/i;
const MAX_NORMALIZED_PRICE = 1e12;

function normalizePriceNumberString(numberText) {
  let mantissa = numberText;
  let exponentSuffix = '';
  const expMatch = numberText.match(/^(.+?)([eE][+-]?\d+)$/);
  if (expMatch) {
    mantissa = expMatch[1];
    exponentSuffix = expMatch[2];
  }

  const hasComma = mantissa.includes(',');
  const hasDot = mantissa.includes('.');

  if (hasComma && hasDot) {
    const lastComma = mantissa.lastIndexOf(',');
    const lastDot = mantissa.lastIndexOf('.');
    if (lastComma > lastDot) {
      // European format with thousands dot and decimal comma, e.g. "1.234,56"
      return mantissa.replace(/\./g, '').replace(',', '.') + exponentSuffix;
    }
    // Standard thousands comma and decimal dot, e.g. "1,234.56"
    return mantissa.replace(/,/g, '') + exponentSuffix;
  }

  if (hasComma) {
    const parts = mantissa.split(',');
    // Single comma followed by 1 or 2 digits is European decimal, e.g. "40,50" or "-0,99"
    if (parts.length === 2 && /^\d{1,2}$/.test(parts[1])) {
      return `${parts[0]}.${parts[1]}${exponentSuffix}`;
    }
    return mantissa.replace(/,/g, '') + exponentSuffix;
  }

  if (hasDot) {
    const parts = mantissa.split('.');
    if (parts.length > 2) {
      const integerParts = parts.slice(0, -1);
      const lastPart = parts[parts.length - 1];
      if (lastPart.length === 3 && integerParts.slice(1).every(p => p.length === 3)) {
        return parts.join('') + exponentSuffix;
      }
      return `${integerParts.join('')}.${lastPart}${exponentSuffix}`;
    }
  }

  return mantissa + exponentSuffix;
}

export function normalizePrice(value) {
  if (value === null || value === undefined || typeof value === 'object' || typeof value === 'boolean') {
    return '';
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    if (value === -1) return '-1';
    if (value < 0) return '';
    return Math.min(value, MAX_NORMALIZED_PRICE).toFixed(2);
  }

  const raw = String(value).trim();
  if (!raw) return '';

  // Match a numeric token starting with an optional minus and at least one digit,
  // avoiding standalone dots/commas in prefixes such as "Rp. 50000" or "CHF. 15.00".
  const numberText = raw.match(/-?\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?/)?.[0];
  if (!numberText) return '';

  const normalized = normalizePriceNumberString(numberText);
  const num = Number.parseFloat(normalized);
  if (!Number.isFinite(num)) return '';
  if (num === -1) return '-1';
  if (num < 0) return '';

  return Math.min(num, MAX_NORMALIZED_PRICE).toFixed(2);
}

export function normalizeCurrency(value) {
  if (value === null || value === undefined || typeof value === 'object' || typeof value === 'boolean') {
    return '';
  }
  const raw = String(value).trim();
  if (!raw) return '';

  const normalized = raw === '￥' ? '¥' : raw;
  if (NORMALIZED_CURRENCIES.has(normalized)) {
    return normalized;
  }

  const strippedCode = normalized.replace(/\.$/, '').trim().toUpperCase();
  if (CURRENCY_CODE_MAP.has(strippedCode)) {
    return CURRENCY_CODE_MAP.get(strippedCode);
  }

  // Try matching multi-char symbols first (¥JPY, NZ$, HK$, A$, C$, S$, R$, RM, Rp, zł, kr, LKR, EGP)
  for (const item of MULTI_CHAR_CURRENCIES_SORTED) {
    if (normalized.startsWith(item.symbol)) {
      if (/^[A-Za-z]+$/.test(item.symbol)) {
        const nextChar = normalized[item.symbol.length] || '';
        if (/[A-Za-z]/.test(nextChar)) continue;
      }
      return item.symbol;
    }
  }

  // Leading ISO currency code followed by non-letter (e.g. "RMB 50", "RUB 100", "CHF. 15")
  const codePrefixMatch = normalized.match(/^([A-Za-z]{2,3})(?![A-Za-z])/);
  if (codePrefixMatch) {
    const mapped = CURRENCY_CODE_MAP.get(codePrefixMatch[1].toUpperCase());
    if (mapped) return mapped;
  }

  const firstChar = normalized[0];
  if (!NORMALIZED_CURRENCIES.has(firstChar)) return '';

  // Single-letter currency symbols ('R', 'Q') must not match arbitrary words like "Quarter" or "RUB"
  if (/^[A-Za-z]$/.test(firstChar)) {
    return /^[RQ](?:\s*\.?\s*\d|$)/.test(normalized) ? firstChar : '';
  }

  return firstChar;
}

export function detectCurrencySymbol(value) {
  if (value === null || value === undefined || typeof value === 'object' || typeof value === 'boolean') {
    return '';
  }
  const raw = String(value);
  if (!raw) return '';
  if (raw.includes('￥')) return '¥';

  // 1) Multi-char symbols with non-alpha currency glyphs (¥JPY, HK$, NZ$, A$, C$, S$, R$, zł, د.إ)
  for (const item of MULTI_CHAR_SYMBOL_ONLY_CURRENCIES) {
    if (raw.includes(item.symbol)) {
      return item.symbol;
    }
  }

  // 2) Exact ISO currency codes / multi-letter currency tokens with word boundaries
  const codeMatch = raw.match(DETECT_CODE_REGEX);
  if (codeMatch) {
    const mapped = CURRENCY_CODE_MAP.get(codeMatch[1].toUpperCase());
    if (mapped) return mapped;
  }

  // 3) Single-char non-alphabetic currency glyphs ($, ¥, €, £, ₽, ₩, ₹, etc.)
  const glyphMatch = SINGLE_CHAR_NON_ALPHA_CURRENCIES.find(item => raw.includes(item.symbol));
  if (glyphMatch) {
    return glyphMatch.symbol;
  }

  // 4) Single-letter currency symbols ('R', 'Q') only when used as an explicit prefix before digits
  const singleAlphaMatch = raw.match(/(?:^|[\s(])([RQ])\s*(?=\d)/);
  if (singleAlphaMatch && NORMALIZED_CURRENCIES.has(singleAlphaMatch[1])) {
    return singleAlphaMatch[1];
  }

  return '';
}

export function detectBillingCycle(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';

  if (/五年|5\s*(y|yr|yrs|year|years)/i.test(raw)) return 'five_years';
  if (/四年|4\s*(y|yr|yrs|year|years)/i.test(raw)) return 'four_years';
  if (/三年|3\s*(y|yr|yrs|year|years)/i.test(raw)) return 'three_years';
  if (/(两年|二年)|2\s*(y|yr|yrs|year|years)/i.test(raw)) return 'two_years';
  if (/半年|half[-_\s]?year/i.test(raw)) return 'half_year';
  if (/季|quarter|\/q\b/i.test(raw)) return 'quarter';
  if (/年|annual|year|yr\b|\/y\b/i.test(raw)) return 'year';
  if (/月|monthly|month|mo\b|\/m\b/i.test(raw)) return 'month';

  return '';
}

export function normalizeBillingCycle(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'month';

  const direct = BILLING_CYCLES.find(item => item.value === raw);
  if (direct) return direct.value;

  return CYCLE_ALIASES.get(raw.toLowerCase()) || 'month';
}

function getBillingCycleOption(value) {
  const normalized = normalizeBillingCycle(value);
  return BILLING_CYCLES.find(item => item.value === normalized) || BILLING_CYCLES[0];
}

export function isEnabledFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function parseDateOnly(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function daysInUtcMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toDateString(year, month, day) {
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0')
  ].join('-');
}

function addMonthsToParsedDate(initialParsed, monthsToAdd) {
  const zeroBasedMonth = initialParsed.month - 1 + monthsToAdd;
  const year = initialParsed.year + Math.floor(zeroBasedMonth / 12);
  const month = ((zeroBasedMonth % 12) + 12) % 12 + 1;
  const day = Math.min(initialParsed.day, daysInUtcMonth(year, month));

  return toDateString(year, month, day);
}

function addBillingCycleToDate(dateString, billingCycle) {
  const parsed = parseDateOnly(dateString);
  if (!parsed) return String(dateString || '').trim();

  const monthsToAdd = getBillingCycleOption(billingCycle).months;
  return addMonthsToParsedDate(parsed, monthsToAdd);
}

function utcDateStringWithOffset(now = Date.now(), offsetDays = 0) {
  const date = new Date(now + (Number(offsetDays) || 0) * 86400000);
  return toDateString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function dateStringWithOffsetFromReference(referenceDateStr, offsetDays = 0) {
  const parsed = parseDateOnly(referenceDateStr);
  if (!parsed) return null;
  const ts = Date.UTC(parsed.year, parsed.month - 1, parsed.day) + (Number(offsetDays) || 0) * 86400000;
  const date = new Date(ts);
  return toDateString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function renewExpireDateIfNeeded(expireDate, billingCycle, autoRenewal, now = Date.now(), renewBeforeDays = 0, options = {}) {
  const original = String(expireDate || '').trim();
  const initialParsed = parseDateOnly(original);
  if (!original || !initialParsed || !isEnabledFlag(autoRenewal)) {
    return { expire_date: original, renewed: false };
  }

  const monthsPerCycle = getBillingCycleOption(billingCycle).months;
  let nextDate = original;
  const renewalDate = (options?.referenceDateStr && dateStringWithOffsetFromReference(options.referenceDateStr, renewBeforeDays)) ||
    utcDateStringWithOffset(now, renewBeforeDays);
  let renewed = false;
  let step = 0;

  while (nextDate <= renewalDate && step < 1200) {
    step++;
    nextDate = addMonthsToParsedDate(initialParsed, monthsPerCycle * step);
    renewed = true;
  }

  return { expire_date: nextDate, renewed };
}
