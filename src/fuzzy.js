function normalizeText(value) {
  return String(value || "")
    .replace(/[Ёё]/g, "е")
    .replace(/[.,;:!?"'`()[\]{}<>|\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForCompare(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function squashDictatedLetters(value) {
  const source = normalizeText(value);
  return source.replace(/\b(?:[A-Za-zА-Яа-я]\s+){2,}[A-Za-zА-Яа-я]\b/g, (m) =>
    m
      .split(/\s+/)
      .join("")
      .toUpperCase()
  );
}

const RU_TO_LAT = [
  ["щ", "shch"],
  ["ш", "sh"],
  ["ч", "ch"],
  ["ц", "ts"],
  ["ю", "yu"],
  ["я", "ya"],
  ["ж", "zh"],
  ["х", "kh"],
  ["ё", "yo"],
  ["й", "y"],
  ["а", "a"],
  ["б", "b"],
  ["в", "v"],
  ["г", "g"],
  ["д", "d"],
  ["е", "e"],
  ["з", "z"],
  ["и", "i"],
  ["к", "k"],
  ["л", "l"],
  ["м", "m"],
  ["н", "n"],
  ["о", "o"],
  ["п", "p"],
  ["р", "r"],
  ["с", "s"],
  ["т", "t"],
  ["у", "u"],
  ["ф", "f"],
  ["ы", "y"],
  ["э", "e"],
  ["ъ", ""],
  ["ь", ""]
];

const LAT_TO_RU = [
  ["shch", "щ"],
  ["sch", "щ"],
  ["yo", "ё"],
  ["yu", "ю"],
  ["ya", "я"],
  ["zh", "ж"],
  ["kh", "х"],
  ["ts", "ц"],
  ["ch", "ч"],
  ["sh", "ш"],
  ["ee", "ии"],
  ["a", "а"],
  ["b", "б"],
  ["c", "к"],
  ["d", "д"],
  ["e", "е"],
  ["f", "ф"],
  ["g", "г"],
  ["h", "х"],
  ["i", "и"],
  ["j", "й"],
  ["k", "к"],
  ["l", "л"],
  ["m", "м"],
  ["n", "н"],
  ["o", "о"],
  ["p", "п"],
  ["q", "к"],
  ["r", "р"],
  ["s", "с"],
  ["t", "т"],
  ["u", "у"],
  ["v", "в"],
  ["w", "в"],
  ["x", "кс"],
  ["y", "й"],
  ["z", "з"]
];

const RU_UNITS = {
  "ноль": 0,
  "нуль": 0,
  "один": 1,
  "одна": 1,
  "два": 2,
  "две": 2,
  "три": 3,
  "четыре": 4,
  "пять": 5,
  "шесть": 6,
  "семь": 7,
  "восемь": 8,
  "девять": 9
};

const RU_TEENS = {
  "десять": 10,
  "одиннадцать": 11,
  "двенадцать": 12,
  "тринадцать": 13,
  "четырнадцать": 14,
  "пятнадцать": 15,
  "шестнадцать": 16,
  "семнадцать": 17,
  "восемнадцать": 18,
  "девятнадцать": 19
};

const RU_TENS = {
  "двадцать": 20,
  "тридцать": 30,
  "сорок": 40,
  "пятьдесят": 50,
  "шестьдесят": 60,
  "семьдесят": 70,
  "восемьдесят": 80,
  "девяносто": 90
};

const ROMAN_TABLE = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"]
];

function toRoman(num) {
  if (!Number.isInteger(num) || num <= 0 || num > 3999) return "";
  let value = num;
  let out = "";
  for (const [arabic, roman] of ROMAN_TABLE) {
    while (value >= arabic) {
      out += roman;
      value -= arabic;
    }
  }
  return out.toLowerCase();
}

function parseRussianNumberAt(tokens, index) {
  const one = tokens[index];
  const two = tokens[index + 1];

  if (!one) return null;
  if (Object.prototype.hasOwnProperty.call(RU_TEENS, one)) {
    return { value: RU_TEENS[one], consumed: 1 };
  }
  if (Object.prototype.hasOwnProperty.call(RU_TENS, one)) {
    const base = RU_TENS[one];
    if (two && Object.prototype.hasOwnProperty.call(RU_UNITS, two)) {
      return { value: base + RU_UNITS[two], consumed: 2 };
    }
    return { value: base, consumed: 1 };
  }
  if (Object.prototype.hasOwnProperty.call(RU_UNITS, one)) {
    return { value: RU_UNITS[one], consumed: 1 };
  }
  return null;
}

function replaceNumbersWithRoman(value) {
  const source = normalizeForCompare(value);
  if (!source) return "";

  const tokens = source.split(" ").filter(Boolean);
  const out = [];
  let changed = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (/^\d{1,4}$/.test(token)) {
      const roman = toRoman(Number(token));
      if (roman) {
        out.push(roman);
        changed = true;
        continue;
      }
    }

    const ruParsed = parseRussianNumberAt(tokens, i);
    if (ruParsed) {
      const roman = toRoman(ruParsed.value);
      if (roman) {
        out.push(roman);
        changed = true;
        i += ruParsed.consumed - 1;
        continue;
      }
    }

    out.push(token);
  }

  return changed ? out.join(" ") : source;
}

function translitRuToLat(value) {
  let out = normalizeForCompare(value);
  for (const [ru, lat] of RU_TO_LAT) {
    out = out.split(ru).join(lat);
  }
  return out;
}

function translitLatToRu(value) {
  let out = normalizeForCompare(value);
  for (const [lat, ru] of LAT_TO_RU) {
    out = out.split(lat).join(ru);
  }
  return out;
}

function toVariants(value) {
  const base = normalizeForCompare(value);
  const variants = new Set([base]);
  variants.add(translitRuToLat(base));
  variants.add(translitLatToRu(base));

  for (const current of [...variants]) {
    const romanized = replaceNumbersWithRoman(current);
    if (romanized) {
      variants.add(romanized);
    }
  }

  return [...variants].filter(Boolean);
}

function toBigrams(value) {
  const s = ` ${value} `;
  const grams = [];
  for (let i = 0; i < s.length - 1; i += 1) {
    grams.push(s.slice(i, i + 2));
  }
  return grams;
}

function diceScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const g1 = toBigrams(a);
  const g2 = toBigrams(b);
  if (!g1.length || !g2.length) return 0;

  const map = new Map();
  for (const g of g1) {
    map.set(g, (map.get(g) || 0) + 1);
  }

  let overlap = 0;
  for (const g of g2) {
    const count = map.get(g) || 0;
    if (count > 0) {
      overlap += 1;
      map.set(g, count - 1);
    }
  }

  return (2 * overlap) / (g1.length + g2.length);
}

function bestVariantScore(nameVariants, queryVariants) {
  let best = 0;

  for (const n of nameVariants) {
    for (const q of queryVariants) {
      if (!n || !q) continue;
      const qCompactLength = q.replace(/\s+/g, "").length;

      let score = diceScore(n, q);
      if (n === q) score = 1;
      else if (qCompactLength >= 4 && n.startsWith(q)) score = Math.max(score, 0.9);
      else if (qCompactLength >= 4 && n.includes(q)) score = Math.max(score, 0.78);

      if (score > best) {
        best = score;
      }
    }
  }

  return best;
}

function rankByName(items, query) {
  const queryVariants = toVariants(query);

  const ranked = items.map((item) => {
    const nameVariants = toVariants(item.name);
    const score = bestVariantScore(nameVariants, queryVariants);
    return { item, score };
  });

  ranked.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return ranked;
}

function isLowConfidence(ranked) {
  if (!ranked.length) return true;
  const top = ranked[0].score;
  const second = ranked[1] ? ranked[1].score : 0;

  if (top < 0.56) return true;
  if (second > 0 && top - second < 0.08) return true;
  return false;
}

module.exports = {
  normalizeText,
  normalizeForCompare,
  squashDictatedLetters,
  rankByName,
  isLowConfidence,
  translitRuToLat,
  translitLatToRu,
  toVariants
};

