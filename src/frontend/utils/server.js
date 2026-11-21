export function isDisabledProbeMetric(value) {
  return value === false || value === 'false';
}

export const MAX_SERVER_PRICE = 1_000_000_000;
export const MAX_TRAFFIC_LIMIT_GB = 1_000_000_000;
export const MAX_TRAFFIC_CORRECTION_GB = 1_000_000;

export const BILLING_CYCLES = Object.freeze([
  Object.freeze({
    value: 'month',
    months: 1,
    labelZh: '月', shortLabelZh: '月',
    labelZhTw: '月', shortLabelZhTw: '月',
    labelEn: 'Monthly', shortLabelEn: 'M',
    labelJa: '月払い', shortLabelJa: '月',
    labelEs: 'Mensual', shortLabelEs: 'mes',
    labelFr: 'Mensuel', shortLabelFr: 'mois',
    labelId: 'Bulanan', shortLabelId: 'bln'
  }),
  Object.freeze({
    value: 'quarter',
    months: 3,
    labelZh: '季', shortLabelZh: '季',
    labelZhTw: '季', shortLabelZhTw: '季',
    labelEn: 'Quarterly', shortLabelEn: 'Q',
    labelJa: '四半期払い', shortLabelJa: '四半期',
    labelEs: 'Trimestral', shortLabelEs: 'trim',
    labelFr: 'Trimestriel', shortLabelFr: 'trim',
    labelId: 'Triwulanan', shortLabelId: '3bln'
  }),
  Object.freeze({
    value: 'half_year',
    months: 6,
    labelZh: '半年', shortLabelZh: '半年',
    labelZhTw: '半年', shortLabelZhTw: '半年',
    labelEn: 'Half-yearly', shortLabelEn: 'HY',
    labelJa: '半年払い', shortLabelJa: '半年',
    labelEs: 'Semestral', shortLabelEs: 'sem',
    labelFr: 'Semestriel', shortLabelFr: 'sem',
    labelId: 'Semesteran', shortLabelId: '6bln'
  }),
  Object.freeze({
    value: 'year',
    months: 12,
    labelZh: '年', shortLabelZh: '年',
    labelZhTw: '年', shortLabelZhTw: '年',
    labelEn: 'Yearly', shortLabelEn: 'Y',
    labelJa: '年払い', shortLabelJa: '年',
    labelEs: 'Anual', shortLabelEs: 'año',
    labelFr: 'Annuel', shortLabelFr: 'an',
    labelId: 'Tahunan', shortLabelId: 'thn'
  }),
  Object.freeze({
    value: 'two_years',
    months: 24,
    labelZh: '两年', shortLabelZh: '2年',
    labelZhTw: '兩年', shortLabelZhTw: '2年',
    labelEn: 'Two years', shortLabelEn: '2Y',
    labelJa: '2年払い', shortLabelJa: '2年',
    labelEs: 'Dos años', shortLabelEs: '2 años',
    labelFr: 'Deux ans', shortLabelFr: '2 ans',
    labelId: 'Dua tahun', shortLabelId: '2thn'
  }),
  Object.freeze({
    value: 'three_years',
    months: 36,
    labelZh: '三年', shortLabelZh: '3年',
    labelZhTw: '三年', shortLabelZhTw: '3年',
    labelEn: 'Three years', shortLabelEn: '3Y',
    labelJa: '3年払い', shortLabelJa: '3年',
    labelEs: 'Tres años', shortLabelEs: '3 años',
    labelFr: 'Trois ans', shortLabelFr: '3 ans',
    labelId: 'Tiga tahun', shortLabelId: '3thn'
  }),
  Object.freeze({
    value: 'four_years',
    months: 48,
    labelZh: '四年', shortLabelZh: '4年',
    labelZhTw: '四年', shortLabelZhTw: '4年',
    labelEn: 'Four years', shortLabelEn: '4Y',
    labelJa: '4年払い', shortLabelJa: '4年',
    labelEs: 'Cuatro años', shortLabelEs: '4 años',
    labelFr: 'Quatre ans', shortLabelFr: '4 ans',
    labelId: 'Empat tahun', shortLabelId: '4thn'
  }),
  Object.freeze({
    value: 'five_years',
    months: 60,
    labelZh: '五年', shortLabelZh: '5年',
    labelZhTw: '五年', shortLabelZhTw: '5年',
    labelEn: 'Five years', shortLabelEn: '5Y',
    labelJa: '5年払い', shortLabelJa: '5年',
    labelEs: 'Cinco años', shortLabelEs: '5 años',
    labelFr: 'Cinq ans', shortLabelFr: '5 ans',
    labelId: 'Lima tahun', shortLabelId: '5thn'
  })
]);

export const CURRENCY_OPTIONS = Object.freeze([
  Object.freeze({ symbol: '$', code: 'USD', nameZh: '美元', nameZhTw: '美元', nameEn: 'US Dollar', nameJa: '米ドル', nameEs: 'Dólar estadounidense', nameFr: 'Dollar américain', nameId: 'Dolar AS' }),
  Object.freeze({ symbol: '¥', code: 'CNY', nameZh: '人民币', nameZhTw: '人民幣', nameEn: 'Chinese Yuan', nameJa: '中国人民元', nameEs: 'Yuan chino', nameFr: 'Yuan chinois', nameId: 'Yuan Tiongkok' }),
  Object.freeze({ symbol: '€', code: 'EUR', nameZh: '欧元', nameZhTw: '歐元', nameEn: 'Euro', nameJa: 'ユーロ', nameEs: 'Euro', nameFr: 'Euro', nameId: 'Euro' }),
  Object.freeze({ symbol: '£', code: 'GBP', nameZh: '英镑', nameZhTw: '英鎊', nameEn: 'British Pound', nameJa: '英ポンド', nameEs: 'Libra esterlina', nameFr: 'Livre sterling', nameId: 'Pound Inggris' }),
  Object.freeze({ symbol: '¥JPY', code: 'JPY', nameZh: '日元', nameZhTw: '日圓', nameEn: 'Japanese Yen', nameJa: '日本円', nameEs: 'Yen japonés', nameFr: 'Yen japonais', nameId: 'Yen Jepang' }),
  Object.freeze({ symbol: 'HK$', code: 'HKD', nameZh: '港币', nameZhTw: '港幣', nameEn: 'Hong Kong Dollar', nameJa: '香港ドル', nameEs: 'Dólar de Hong Kong', nameFr: 'Dollar de Hong Kong', nameId: 'Dolar Hong Kong' }),
  Object.freeze({ symbol: 'A$', code: 'AUD', nameZh: '澳元', nameZhTw: '澳幣', nameEn: 'Australian Dollar', nameJa: '豪ドル', nameEs: 'Dólar australiano', nameFr: 'Dollar australien', nameId: 'Dolar Australia' }),
  Object.freeze({ symbol: 'C$', code: 'CAD', nameZh: '加拿大元', nameZhTw: '加幣', nameEn: 'Canadian Dollar', nameJa: 'カナダドル', nameEs: 'Dólar canadiense', nameFr: 'Dollar canadien', nameId: 'Dolar Kanada' }),
  Object.freeze({ symbol: 'S$', code: 'SGD', nameZh: '新加坡元', nameZhTw: '新加坡幣', nameEn: 'Singapore Dollar', nameJa: 'シンガポールドル', nameEs: 'Dólar de Singapur', nameFr: 'Dollar de Singapour', nameId: 'Dolar Singapura' }),
  Object.freeze({ symbol: 'NZ$', code: 'NZD', nameZh: '新西兰元', nameZhTw: '紐西蘭幣', nameEn: 'New Zealand Dollar', nameJa: 'ニュージーランドドル', nameEs: 'Dólar neozelandés', nameFr: 'Dollar néo-zélandais', nameId: 'Dolar Selandia Baru' }),
  Object.freeze({ symbol: '₣', code: 'CHF', nameZh: '瑞士法郎', nameZhTw: '瑞士法郎', nameEn: 'Swiss Franc', nameJa: 'スイスフラン', nameEs: 'Franco suizo', nameFr: 'Franc suisse', nameId: 'Franc Swiss' }),
  Object.freeze({ symbol: '₩', code: 'KRW', nameZh: '韩元', nameZhTw: '韓元', nameEn: 'Korean Won', nameJa: '韓国ウォン', nameEs: 'Won surcoreano', nameFr: 'Won sud-coréen', nameId: 'Won Korea Selatan' }),
  Object.freeze({ symbol: '₹', code: 'INR', nameZh: '印度卢比', nameZhTw: '印度盧比', nameEn: 'Indian Rupee', nameJa: 'インドルピー', nameEs: 'Rupia india', nameFr: 'Roupie indienne', nameId: 'Rupee India' }),
  Object.freeze({ symbol: '฿', code: 'THB', nameZh: '泰铢', nameZhTw: '泰銖', nameEn: 'Thai Baht', nameJa: 'タイバーツ', nameEs: 'Baht tailandés', nameFr: 'Baht thaïlandais', nameId: 'Baht Thailand' }),
  Object.freeze({ symbol: '₫', code: 'VND', nameZh: '越南盾', nameZhTw: '越南盾', nameEn: 'Vietnamese Dong', nameJa: 'ベトナムドン', nameEs: 'Dong vietnamita', nameFr: 'Dong vietnamien', nameId: 'Dong Vietnam' }),
  Object.freeze({ symbol: '₱', code: 'PHP', nameZh: '菲律宾比索', nameZhTw: '菲律賓披索', nameEn: 'Philippine Peso', nameJa: 'フィリピンペソ', nameEs: 'Peso filipino', nameFr: 'Peso philippin', nameId: 'Peso Filipina' }),
  Object.freeze({ symbol: 'Rp', code: 'IDR', nameZh: '印尼盾', nameZhTw: '印尼盾', nameEn: 'Indonesian Rupiah', nameJa: 'インドネシアルピア', nameEs: 'Rupia indonesia', nameFr: 'Roupie indonésienne', nameId: 'Rupiah Indonesia' }),
  Object.freeze({ symbol: 'RM', code: 'MYR', nameZh: '马来西亚林吉特', nameZhTw: '馬來西亞令吉', nameEn: 'Malaysian Ringgit', nameJa: 'マレーシアリンギット', nameEs: 'Ringgit malayo', nameFr: 'Ringgit malaisien', nameId: 'Ringgit Malaysia' }),
  Object.freeze({ symbol: '₺', code: 'TRY', nameZh: '土耳其里拉', nameZhTw: '土耳其里拉', nameEn: 'Turkish Lira', nameJa: 'トルコリラ', nameEs: 'Lira turca', nameFr: 'Livre turque', nameId: 'Lira Turki' }),
  Object.freeze({ symbol: '₪', code: 'ILS', nameZh: '以色列新谢克尔', nameZhTw: '以色列新謝克爾', nameEn: 'Israeli Shekel', nameJa: 'イスラエル新シェケル', nameEs: 'Séquel israelí', nameFr: 'Shekel israélien', nameId: 'Shekel Israel' }),
  Object.freeze({ symbol: '৳', code: 'BDT', nameZh: '孟加拉塔卡', nameZhTw: '孟加拉塔卡', nameEn: 'Bangladeshi Taka', nameJa: 'バングラデシュタカ', nameEs: 'Taka bangladesí', nameFr: 'Taka bangladais', nameId: 'Taka Bangladesh' }),
  Object.freeze({ symbol: '₨', code: 'PKR', nameZh: '巴基斯坦卢比', nameZhTw: '巴基斯坦盧比', nameEn: 'Pakistani Rupee', nameJa: 'パキスタンルピー', nameEs: 'Rupia pakistaní', nameFr: 'Roupie pakistanaise', nameId: 'Rupee Pakistan' }),
  Object.freeze({ symbol: 'LKR', code: 'LKR', nameZh: '斯里兰卡卢比', nameZhTw: '斯里蘭卡盧比', nameEn: 'Sri Lankan Rupee', nameJa: 'スリランカルピー', nameEs: 'Rupia de Sri Lanka', nameFr: 'Roupie srilankaise', nameId: 'Rupee Sri Lanka' }),
  Object.freeze({ symbol: '₮', code: 'MNT', nameZh: '蒙古图格里克', nameZhTw: '蒙古圖格里克', nameEn: 'Mongolian Tugrik', nameJa: 'モンゴルトゥグルグ', nameEs: 'Tugrik mongol', nameFr: 'Tugrik mongol', nameId: 'Tugrik Mongolia' }),
  Object.freeze({ symbol: '₽', code: 'RUB', nameZh: '卢布', nameZhTw: '盧布', nameEn: 'Russian Ruble', nameJa: 'ロシアルーブル', nameEs: 'Rublo ruso', nameFr: 'Rouble russe', nameId: 'Rubel Rusia' }),
  Object.freeze({ symbol: 'R$', code: 'BRL', nameZh: '巴西雷亚尔', nameZhTw: '巴西雷亞爾', nameEn: 'Brazilian Real', nameJa: 'ブラジルレアル', nameEs: 'Real brasileño', nameFr: 'Réal brésilien', nameId: 'Real Brasil' }),
  Object.freeze({ symbol: 'kr', code: 'SEK', nameZh: '克朗', nameZhTw: '克朗', nameEn: 'Krona (SEK/NOK/DKK)', nameJa: 'クローナ (SEK/NOK/DKK)', nameEs: 'Corona (SEK/NOK/DKK)', nameFr: 'Couronne (SEK/NOK/DKK)', nameId: 'Krona (SEK/NOK/DKK)' }),
  Object.freeze({ symbol: 'zł', code: 'PLN', nameZh: '波兰兹罗提', nameZhTw: '波蘭茲羅提', nameEn: 'Polish Zloty', nameJa: 'ポーランドズウォティ', nameEs: 'Esloti polaco', nameFr: 'Zloty polonais', nameId: 'Zloty Polandia' }),
  Object.freeze({ symbol: '₴', code: 'UAH', nameZh: '乌克兰格里夫纳', nameZhTw: '烏克蘭格里夫納', nameEn: 'Ukrainian Hryvnia', nameJa: 'ウクライナフリヴニャ', nameEs: 'Grivna ucraniana', nameFr: 'Hryvnia ukrainienne', nameId: 'Hryvnia Ukraina' }),
  Object.freeze({ symbol: '₸', code: 'KZT', nameZh: '哈萨克坦戈', nameZhTw: '哈薩克堅戈', nameEn: 'Kazakhstani Tenge', nameJa: 'カザフスタンテング', nameEs: 'Tenge kazajo', nameFr: 'Tenge kazakh', nameId: 'Tenge Kazakhstan' }),
  Object.freeze({ symbol: 'R', code: 'ZAR', nameZh: '南非兰特', nameZhTw: '南非蘭特', nameEn: 'South African Rand', nameJa: '南アフリカランド', nameEs: 'Rand sudafricano', nameFr: 'Rand sud-africain', nameId: 'Rand Afrika Selatan' }),
  Object.freeze({ symbol: '₦', code: 'NGN', nameZh: '尼日利亚奈拉', nameZhTw: '奈及利亞奈拉', nameEn: 'Nigerian Naira', nameJa: 'ナイジェリアナイラ', nameEs: 'Naira nigeriano', nameFr: 'Naira nigérian', nameId: 'Naira Nigeria' }),
  Object.freeze({ symbol: 'EGP', code: 'EGP', nameZh: '埃及镑', nameZhTw: '埃及鎊', nameEn: 'Egyptian Pound', nameJa: 'エジプトポンド', nameEs: 'Libra egipcia', nameFr: 'Livre égyptienne', nameId: 'Pound Mesir' }),
  Object.freeze({ symbol: 'د.إ', code: 'AED', nameZh: '阿联酋迪拉姆', nameZhTw: '阿聯酋迪拉姆', nameEn: 'UAE Dirham', nameJa: 'UAEディルハム', nameEs: 'Dírham de los EAU', nameFr: 'Dirham des ÉAU', nameId: 'Dirham UEA' }),
  Object.freeze({ symbol: '﷼', code: 'SAR', nameZh: '沙特里亚尔', nameZhTw: '沙烏地里亞爾', nameEn: 'Saudi Riyal', nameJa: 'サウジリヤル', nameEs: 'Riyal saudí', nameFr: 'Riyal saoudien', nameId: 'Riyal Arab Saudi' }),
  Object.freeze({ symbol: 'Q', code: 'GTQ', nameZh: '危地马拉格查尔', nameZhTw: '瓜地馬拉格查爾', nameEn: 'Guatemalan Quetzal', nameJa: 'グアテマラケツァル', nameEs: 'Quetzal guatemalteco', nameFr: 'Quetzal guatémaltèque', nameId: 'Quetzal Guatemala' })
]);

const CYCLE_ALIASES = new Map([
  ['月', 'month'],
  ['月払い', 'month'],
  ['monthly', 'month'],
  ['month', 'month'],
  ['mo', 'month'],
  ['mensual', 'month'],
  ['mes', 'month'],
  ['mensuel', 'month'],
  ['mois', 'month'],
  ['bulanan', 'month'],
  ['bln', 'month'],
  ['季', 'quarter'],
  ['季度', 'quarter'],
  ['四半期', 'quarter'],
  ['四半期払い', 'quarter'],
  ['quarter', 'quarter'],
  ['quarterly', 'quarter'],
  ['trimestral', 'quarter'],
  ['trimestriel', 'quarter'],
  ['trim', 'quarter'],
  ['triwulanan', 'quarter'],
  ['3bln', 'quarter'],
  ['半年', 'half_year'],
  ['半年払い', 'half_year'],
  ['halfyear', 'half_year'],
  ['half_year', 'half_year'],
  ['half-yearly', 'half_year'],
  ['semestral', 'half_year'],
  ['semestriel', 'half_year'],
  ['sem', 'half_year'],
  ['semesteran', 'half_year'],
  ['6bln', 'half_year'],
  ['年', 'year'],
  ['一年', 'year'],
  ['年払い', 'year'],
  ['year', 'year'],
  ['yearly', 'year'],
  ['annual', 'year'],
  ['anual', 'year'],
  ['año', 'year'],
  ['annuel', 'year'],
  ['an', 'year'],
  ['tahunan', 'year'],
  ['thn', 'year'],
  ['两年', 'two_years'],
  ['兩年', 'two_years'],
  ['二年', 'two_years'],
  ['2年', 'two_years'],
  ['2年払い', 'two_years'],
  ['two_years', 'two_years'],
  ['2 years', 'two_years'],
  ['dos años', 'two_years'],
  ['deux ans', 'two_years'],
  ['dua tahun', 'two_years'],
  ['三年', 'three_years'],
  ['3年', 'three_years'],
  ['3年払い', 'three_years'],
  ['three_years', 'three_years'],
  ['3 years', 'three_years'],
  ['tres años', 'three_years'],
  ['trois ans', 'three_years'],
  ['tiga tahun', 'three_years'],
  ['四年', 'four_years'],
  ['4年', 'four_years'],
  ['4年払い', 'four_years'],
  ['four_years', 'four_years'],
  ['4 years', 'four_years'],
  ['cuatro años', 'four_years'],
  ['quatre ans', 'four_years'],
  ['empat tahun', 'four_years'],
  ['五年', 'five_years'],
  ['5年', 'five_years'],
  ['5年払い', 'five_years'],
  ['five_years', 'five_years'],
  ['5 years', 'five_years'],
  ['cinco años', 'five_years'],
  ['cinq ans', 'five_years'],
  ['lima tahun', 'five_years']
]);

const NORMALIZED_CURRENCIES = new Set(CURRENCY_OPTIONS.map(item => item.symbol));

function parsePriceNumberToken(numberText) {
  if (!numberText) return null;

  const hasComma = numberText.includes(',');
  const hasDot = numberText.includes('.');
  let canonical = '';

  if (!hasComma && !hasDot) {
    if (!/^-?\d+$/.test(numberText)) return null;
    canonical = numberText;
  } else if (!hasComma && hasDot) {
    // 拒绝多小数点（如 12.3.4）
    if (!/^-?(?:\d+\.\d+|\.\d+|\d+\.)$/.test(numberText)) return null;
    canonical = numberText.endsWith('.') ? `${numberText}0` : numberText;
  } else if (hasComma && !hasDot) {
    const commaCount = (numberText.match(/,/g) || []).length;
    if (commaCount === 1 && /^-?\d+,\d{1,2}$/.test(numberText)) {
      // 欧式逗号小数：如 "40,50" 或 "12,9"
      canonical = numberText.replace(',', '.');
    } else if (/^-?[1-9]\d{0,2}(?:,\d{3})+$/.test(numberText)) {
      // 标准千分位整数：如 "1,000" 或 "1,234,567"（首段禁止前导 0，拒绝 "0,009" / "0,500" / "00,100"）
      canonical = numberText.replace(/,/g, '');
    } else {
      return null;
    }
  } else {
    // 同时含逗号与小数点：区分美式 "1,234.56" 与欧式 "1.234,56"（首段禁止前导 0）
    if (/^-?[1-9]\d{0,2}(?:,\d{3})+\.\d+$/.test(numberText)) {
      canonical = numberText.replace(/,/g, '');
    } else if (/^-?[1-9]\d{0,2}(?:\.\d{3})+,\d{1,2}$/.test(numberText)) {
      canonical = numberText.replace(/\./g, '').replace(',', '.');
    } else {
      return null;
    }
  }

  const num = Number(canonical);
  if (!Number.isFinite(num)) return null;
  if (num === -1) return '-1';
  if (num < 0 || num > MAX_SERVER_PRICE) return null;
  return num.toFixed(2);
}

const CURRENCY_AFFIX_PATTERN = '(?:Rp\\.?|RM|HK\\$|NZ\\$|A\\$|C\\$|S\\$|R\\$|¥JPY|LKR|EGP|USD|EUR|CNY|GBP|JPY|IDR|CHF|CAD|AUD|SGD|KRW|INR|THB|VND|PHP|MYR|TRY|ILS|BDT|PKR|MNT|RUB|BRL|SEK|NOK|DKK|PLN|UAH|KZT|ZAR|NGN|AED|SAR|GTQ|kr\\.?|zł|د\\.إ|﷼|[$¥￥€£₣₩₹฿₫₱₺₪৳₨₮₽₴₸₦QR])';
const PRICE_INPUT_WRAPPER_RE = new RegExp(`^${CURRENCY_AFFIX_PATTERN}?\\s*(-?(?:[.,]+\\d[\\d.,]*|\\d[\\d.,]*))\\s*${CURRENCY_AFFIX_PATTERN}?$`, 'i');

export function validatePriceInput(value) {
  if (value === null || value === undefined) return { valid: true, value: '' };

  const raw = String(value).trim();
  if (!raw) return { valid: true, value: '' };

  // 显式拒绝科学计数法（如 1e5、1e21）
  if (/\d\s*e[+-]?\d+/i.test(raw)) {
    return { valid: false, value: '' };
  }

  const wrappedMatch = raw.match(PRICE_INPUT_WRAPPER_RE);
  if (!wrappedMatch) {
    return { valid: false, value: '' };
  }

  const normalized = parsePriceNumberToken(wrappedMatch[1]);
  if (!normalized) {
    return { valid: false, value: '' };
  }

  return { valid: true, value: normalized };
}

export function normalizePrice(value) {
  if (value === null || value === undefined) return '';

  const raw = String(value).trim();
  if (!raw) return '';
  if (/\d\s*e[+-]?\d+/i.test(raw)) return '';

  // 先剥离带点的货币缩写前缀（如 "Rp. 50000"、"kr. 99"），避免误把缩写后的 "." 当成小数点
  const cleaned = raw.replace(/^(?:Rp|kr|CHF|Rs)\.\s*/i, '');
  const numberText = cleaned.match(/-?(?:[.,]+\d[\d.,]*|\d[\d.,]*)/)?.[0];
  if (!numberText) return '';

  return parsePriceNumberToken(numberText) || '';
}

export function isFreePrice(value) {
  const price = normalizePrice(value);
  return price === '-1' || price === '0.00';
}

export function normalizeCurrency(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (/^Rp\.?(?:\s|$)/i.test(raw) || raw.toLowerCase() === 'rp.') return 'Rp';
  const normalized = raw === '￥' ? '¥' : raw;
  for (const item of CURRENCY_OPTIONS) {
    if (item.symbol.length > 1 && normalized.startsWith(item.symbol)) {
      return item.symbol;
    }
  }

  const symbol = normalized[0];
  return NORMALIZED_CURRENCIES.has(symbol) ? symbol : '';
}

export function detectCurrencySymbol(value) {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.includes('￥')) return '¥';
  if (/\bRp\.?(?=\s|\d)/i.test(raw)) return 'Rp';

  for (const item of CURRENCY_OPTIONS) {
    if (item.symbol.length > 1 && raw.includes(item.symbol)) {
      return item.symbol;
    }
  }

  return CURRENCY_OPTIONS.find(item => item.symbol.length === 1 && raw.includes(item.symbol))?.symbol || '';
}

export function detectBillingCycle(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';

  if (/五年|5\s*(y|yr|yrs|year|years|年|años|ans|thn|tahun)/i.test(raw)) return 'five_years';
  if (/四年|4\s*(y|yr|yrs|year|years|年|años|ans|thn|tahun)/i.test(raw)) return 'four_years';
  if (/三年|3\s*(y|yr|yrs|year|years|年|años|ans|thn|tahun)/i.test(raw)) return 'three_years';
  if (/(两年|兩年|二年)|2\s*(y|yr|yrs|year|years|年|años|ans|thn|tahun)/i.test(raw)) return 'two_years';
  if (/半年|half[-_\s]?year|semest|6\s*bln/i.test(raw)) return 'half_year';
  if (/季|四半期|quarter|trimest|triwulan|\/q\b|3\s*bln/i.test(raw)) return 'quarter';
  if (/年|annual|year|anual|annuel|tahunan|yr\b|\/y\b|\/an\b|\/año\b|\/thn\b/i.test(raw)) return 'year';
  if (/月|monthly|month|mensual|mensuel|bulanan|mo\b|\/m\b|\/mes\b|\/mois\b|\/bln\b/i.test(raw)) return 'month';

  return '';
}

export function normalizeBillingCycle(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'month';

  const direct = BILLING_CYCLES.find(item => item.value === raw);
  if (direct) return direct.value;

  return CYCLE_ALIASES.get(raw.toLowerCase()) || 'month';
}

export function getBillingCycleOption(value) {
  const normalized = normalizeBillingCycle(value);
  return BILLING_CYCLES.find(item => item.value === normalized) || BILLING_CYCLES[0];
}

export function isEnabledFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function parseDateOnly(value) {
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

function addBillingCycleToDate(dateString, billingCycle) {
  const parsed = parseDateOnly(dateString);
  if (!parsed) return String(dateString || '').trim();

  const monthsToAdd = getBillingCycleOption(billingCycle).months;
  const zeroBasedMonth = parsed.month - 1 + monthsToAdd;
  const year = parsed.year + Math.floor(zeroBasedMonth / 12);
  const month = ((zeroBasedMonth % 12) + 12) % 12 + 1;
  const day = Math.min(parsed.day, daysInUtcMonth(year, month));

  return toDateString(year, month, day);
}

function utcDateStringWithOffset(now = Date.now(), offsetDays = 0) {
  const date = new Date(now + (Number(offsetDays) || 0) * 86400000);
  return toDateString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function renewExpireDateIfNeeded(expireDate, billingCycle, autoRenewal, now = Date.now(), renewBeforeDays = 0) {
  const original = String(expireDate || '').trim();
  if (!original || !parseDateOnly(original) || !isEnabledFlag(autoRenewal)) {
    return { expire_date: original, renewed: false };
  }

  let nextDate = original;
  const renewalDate = utcDateStringWithOffset(now, renewBeforeDays);
  let renewed = false;
  let guard = 0;

  while (nextDate <= renewalDate && guard < 1200) {
    nextDate = addBillingCycleToDate(nextDate, billingCycle);
    renewed = true;
    guard++;
  }

  return { expire_date: nextDate, renewed };
}

const OPTION_FIELD_LANGUAGE_SUFFIX = Object.freeze({
  zh: 'Zh',
  'zh-TW': 'ZhTw',
  en: 'En',
  ja: 'Ja',
  es: 'Es',
  fr: 'Fr',
  id: 'Id'
});

const INTL_CURRENCY_LOCALE_MAP = Object.freeze({
  zh: 'zh-CN',
  'zh-TW': 'zh-TW',
  en: 'en',
  ja: 'ja',
  es: 'es',
  fr: 'fr',
  id: 'id'
});

const currencyDisplayNamesCache = new Map();

function getIntlCurrencyDisplayName(code, lang) {
  if (!code || typeof Intl === 'undefined' || typeof Intl.DisplayNames !== 'function') return '';
  const locale = INTL_CURRENCY_LOCALE_MAP[lang] || lang || 'en';
  try {
    let displayNames = currencyDisplayNamesCache.get(locale);
    if (!displayNames) {
      displayNames = new Intl.DisplayNames([locale], { type: 'currency' });
      currencyDisplayNamesCache.set(locale, displayNames);
    }
    const resolved = displayNames.of(code);
    return resolved && resolved !== code ? resolved : '';
  } catch (_) {
    return '';
  }
}

export function getLocalizedOptionField(option, field, lang) {
  if (!option) return '';
  const suffix = OPTION_FIELD_LANGUAGE_SUFFIX[lang] || 'En';
  const direct = option[`${field}${suffix}`];
  if (direct !== undefined && direct !== null && direct !== '') {
    return direct;
  }
  if (field === 'name' && option.code) {
    const intlName = getIntlCurrencyDisplayName(option.code, lang);
    if (intlName) return intlName;
  }
  return option[`${field}En`] ?? option.symbol ?? '';
}

export const FREE_PRICE_LABELS = Object.freeze({
  zh: '免费',
  'zh-TW': '免費',
  en: 'Free',
  ja: '無料',
  es: 'Gratis',
  fr: 'Gratuit',
  id: 'Gratis'
});

export function formatBillingPrice(server, lang = 'zh') {
  const price = normalizePrice(server?.price);
  if (!price) return '';
  if (isFreePrice(price)) return FREE_PRICE_LABELS[lang] || FREE_PRICE_LABELS.en;

  const currency = normalizeCurrency(server?.currency || detectCurrencySymbol(server?.price));
  const cycle = getBillingCycleOption(detectBillingCycle(server?.price) || server?.billing_cycle);
  const cycleLabel = getLocalizedOptionField(cycle, 'shortLabel', lang);

  return `${currency}${price}/${cycleLabel}`;
}

export const BUILTIN_PING_NODE_NAMES = Object.freeze({
  custom_ct: '电信',
  custom_cu: '联通',
  custom_cm: '移动',
  custom_bd: 'BGP',
  node_1: 'Node 1',
  node_2: 'Node 2',
  node_3: 'Node 3',
  node_4: 'Node 4'
});

const PING_NODE_NAME_FIELD_TO_KEY = Object.freeze({
  custom_ct_name: 'custom_ct',
  custom_cu_name: 'custom_cu',
  custom_cm_name: 'custom_cm',
  custom_bd_name: 'custom_bd',
  node_1_name: 'node_1',
  node_2_name: 'node_2',
  node_3_name: 'node_3',
  node_4_name: 'node_4'
});

export function isBuiltinPingNodeName(fieldOrNameKey, value) {
  const key = PING_NODE_NAME_FIELD_TO_KEY[fieldOrNameKey] || fieldOrNameKey;
  const raw = String(value ?? '').trim();
  if (!raw) return true;
  return raw === BUILTIN_PING_NODE_NAMES[key];
}

export function resolveCustomPingNodeName(fieldOrNameKey, value) {
  const raw = String(value ?? '').trim();
  if (!raw || isBuiltinPingNodeName(fieldOrNameKey, raw)) return '';
  return raw;
}

export function getLocalizedPingNodeLabel(field, settingsOrConfig, trans, preferShort = false) {
  const key = PING_NODE_NAME_FIELD_TO_KEY[field] || field;
  const nameField = `${key}_name`;
  const customName = resolveCustomPingNodeName(key, settingsOrConfig?.[nameField]);
  if (customName) return customName;

  if (key === 'custom_ct') return (preferShort ? trans?.pingCt : trans?.customCt) || trans?.pingCt || 'CT';
  if (key === 'custom_cu') return (preferShort ? trans?.pingCu : trans?.customCu) || trans?.pingCu || 'CU';
  if (key === 'custom_cm') return (preferShort ? trans?.pingCm : trans?.customCm) || trans?.pingCm || 'CM';
  if (key === 'custom_bd') return (preferShort ? trans?.pingBd : trans?.customBd) || trans?.pingBd || 'BGP';
  if (key === 'node_1') return trans?.pingNode_1 || 'Node 1';
  if (key === 'node_2') return trans?.pingNode_2 || 'Node 2';
  if (key === 'node_3') return trans?.pingNode_3 || 'Node 3';
  if (key === 'node_4') return trans?.pingNode_4 || 'Node 4';
  return String(field || '');
}

export function maskCommandSecret(command) {
  let output = String(command ?? '');
  if (!output) return '';

  // 精确替换 -secret= 与 -e SECRET= 参数值（兼容 POSIX 单引号、cfsm-user 二次转义 '\"'\"'、PowerShell '' 及双引号包裹），
  // 不做全局裸字符串替换，避免短密钥（如 'sh'、'123'、'com'）误伤命令主体或域名。
  return output
    .replace(/(-secret=)'(?:'\\"'\\"'|'"'"'|'\\''|''|[^'])*'/g, "$1'********'")
    .replace(/(-secret=)\\"(?:\\\\.|[^"\\])*\\"/g, '$1\\"********\\"')
    .replace(/(-secret=)"(?:\\.|[^"\\])*"/g, '$1"********"')
    .replace(/(-secret=)([^\s'"\\]+)/g, "$1'********'")
    .replace(/(-e\s+SECRET=)'(?:'\\"'\\"'|'"'"'|'\\''|''|[^'])*'/g, "$1'********'")
    .replace(/(-e\s+SECRET=)\\"(?:\\\\.|[^"\\])*\\"/g, '$1\\"********\\"')
    .replace(/(-e\s+SECRET=)"(?:\\.|[^"\\])*"/g, '$1"********"')
    .replace(/(-e\s+SECRET=)([^\s'"\\]+)/g, "$1'********'");
}

export function resolveSafeLoginRedirect(redirect) {
  if (typeof redirect !== 'string') return '';
  const target = redirect.trim();
  if (!target) return '';
  if (!target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return '';
  if (/[\u0000-\u001f\u007f]/.test(target)) return '';

  try {
    const parsed = new URL(target, 'https://monitor.invalid');
    if (parsed.origin !== 'https://monitor.invalid') return '';
    if (parsed.pathname === '/admin' || parsed.pathname.startsWith('/admin/')) return '';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_) {
    return '';
  }
}

export function validateServerNameInput(value) {
  if (typeof value !== 'string') return { valid: false, value: '' };
  const trimmed = value.trim();
  if (!trimmed || value.length > 100) return { valid: false, value: '' };
  return { valid: true, value: trimmed };
}

export function validateTrafficLimitInput(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return { valid: true, value: '' };
  }
  const raw = String(value).trim();
  if (/\s/.test(raw) || /\d\s*e[+-]?\d+/i.test(raw) || !/^\d+(?:\.\d+)?$/.test(raw)) {
    return { valid: false, value: '' };
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0 || num > MAX_TRAFFIC_LIMIT_GB) {
    return { valid: false, value: '' };
  }
  return { valid: true, value: num === 0 ? '' : String(Math.round(num * 100) / 100) };
}

export function validateTrafficCorrectionInput(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return { valid: true, value: '' };
  }
  const raw = String(value).trim();
  if (/\d\s*e[+-]?\d+/i.test(raw) || !/^\d+(?:\.\d+)?$/.test(raw)) {
    return { valid: false, value: '' };
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0 || num > MAX_TRAFFIC_CORRECTION_GB) {
    return { valid: false, value: '' };
  }
  return { valid: true, value: num };
}

export function validateTrafficAlertPercentInput(value, { allowEmpty = true } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return allowEmpty ? { valid: true, value: null } : { valid: false, value: null };
  }
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) {
    return { valid: false, value: null };
  }
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 0 || num > 100) {
    return { valid: false, value: null };
  }
  return { valid: true, value: num };
}

const NETWORK_INTERFACE_ITEM_RE = /^[A-Za-z0-9_.:-]+$/;

export function validateNetworkInterfaceInput(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { valid: true, value: '' };
  if (raw.length > 255 || /[/@?#\\[\]]/.test(raw)) {
    return { valid: false, value: '' };
  }

  const seen = new Set();
  const interfaces = [];
  const parts = raw.split(',');
  for (const part of parts) {
    const name = part.trim();
    if (!name || name.length > 64 || !NETWORK_INTERFACE_ITEM_RE.test(name)) {
      return { valid: false, value: '' };
    }
    if (!seen.has(name)) {
      seen.add(name);
      interfaces.push(name);
    }
  }

  if (interfaces.length === 0) return { valid: false, value: '' };
  const normalized = interfaces.join(',');
  if (normalized.length > 255) return { valid: false, value: '' };
  return { valid: true, value: normalized };
}

export function validateResourceAlertThresholdInput(value, metric = 'cpu') {
  const raw = String(value ?? '').trim();
  if (!raw || /\d\s*e[+-]?\d+/i.test(raw) || !/^\d+(?:\.\d+)?$/.test(raw)) {
    return { valid: false, value: '' };
  }
  const num = Number(raw);
  const max = metric === 'netIn' || metric === 'netOut' ? 100000 : 100;
  if (!Number.isFinite(num) || num <= 0 || num > max) {
    return { valid: false, value: '' };
  }
  return { valid: true, value: String(Math.round(num * 100) / 100) };
}
