/**
 * Sale Market — Shared Search Engine
 *
 * Exports (attached to window.MBSearch):
 *   normalizeText(value)            — lowercase, trim, apostrophe normalisation
 *   searchAliases                   — category → synonym dictionary
 *   getSearchTerms(query)           — expands one query into all matching terms
 *   buildSearchText(product)        — concat all searchable fields for one product
 *   searchProducts(products, query) — returns filtered array
 *   autoTagProduct(product)         — returns product with auto-generated tags
 *
 * No jQuery. No dependencies. Safe to load before or after DOMContentLoaded.
 */

(function (global) {
  'use strict';

  /* ─────────────────────────────────────────────────────────
     1. NORMALISE TEXT
     ───────────────────────────────────────────────────────── */

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      // unify all Uzbek / typographic apostrophes
      .replace(/[\u02BB\u02BC\u2018\u2019\u0060\u00B4\u0027]/g, "'")
      // collapse whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ─────────────────────────────────────────────────────────
     2. ALIAS DICTIONARY
     Every key is a canonical category name (normalised).
     Values are common user-typed synonyms for that category.
     ───────────────────────────────────────────────────────── */

  var searchAliases = {

    /* ── Furniture ────────────────────────────────────────── */
    "mebel": [
      "furniture", "мебель", "uy mebeli", "uy jihozlari",
      "stul", "stol", "kreslo", "divan", "gamak",
      "qoplama", "nakidka", "chehol", "чехол", "кресло", "стол"
    ],

    /* ── Footwear ─────────────────────────────────────────── */
    "oyoq kiyimlar": [
      "oyoq kiyim", "oyoq", "krasovka", "krossovka", "krasofka",
      "krosovka", "krosofka", "sneaker", "sniker",
      "tufli", "tufl", "tufli erkaklar", "tufli ayollar",
      "tapochka", "tapchika", "shippak", "shipak",
      "slansi", "slans", "slansy", "slanci",
      "sandal", "sandalik", "sandallar",
      "botinka", "botinok", "etik",
      "mokasin", "mokassin",
      "uy oyoq kiyimi", "bo'yin taglik", "taglik", "yarim taglik",
      "bo'y oshiruvchi", "bo'yni balandroq", "bo'yi baland",
      "oyoq barmoq", "barmoq ajratgich"
    ],

    /* ── Tops / outerwear ─────────────────────────────────── */
    "ustki kiyimlar": [
      "ustki kiyim", "ustki",
      "ko'ylak", "koylak", "kuylag", "ko'ylaklar",
      "futbolka", "futbolkalar",
      "sviter", "sveter", "svitri",
      "jemper", "jumper", "djemper",
      "kardigan", "kardigon",
      "kurtka", "jaket", "jeket",
      "palto", "shinel", "trench",
      "bodi", "body",
      "termokiyim", "termobelyo", "termobelio", "termo",
      "issiq kiyim", "qishki kiyim",
      "fleece", "flis kiyim", "flisli",
      "oversayz", "oversized",
      "yengil kiyim", "kundalik kiyim"
    ],

    /* ── Trousers ─────────────────────────────────────────── */
    "shimlar": [
      "shim", "shimlar",
      "bryuki", "bryuka", "bryukalar",
      "jinsi", "jins", "jeans", "jeanslar",
      "losina", "legins", "leggins", "taytlar",
      "sport shim", "sport pants",
      "flis shim", "flisli shim", "issiq shim", "qishki shim",
      "nakolennik", "tizza bog'lovchi", "tizza", "bog'lovchi"
    ],

    /* ── Bags ─────────────────────────────────────────────── */
    "sumkalar": [
      "sumka", "sumkalar",
      "klatch", "clutch", "klatchi",
      "ryukzak", "ruksak",
      "hamyon",
      "ayollar sumkasi", "erkaklar sumkasi",
      "yelka sumka", "yelkama",
      "to'rva", "xurjun", "shopper"
    ],

    /* ── Accessories ──────────────────────────────────────── */
    "aksesuarlar": [
      "aksessuar", "aksesuarlar", "aksessuarlar",
      "soat", "qo'l soat", "qo'lsoat", "erkaklar soati",
      "braslet", "bilakuzuk",
      "uzuk", "marjon",
      "ko'zoynak", "achki", "galdor",
      "hamyon", "klatch",
      "kamar", "belbog'",
      "sumka", "bayramona"
    ],

    /* ── Skin care ────────────────────────────────────────── */
    "teri parvarishi": [
      "teri", "terilar", "teri parvarishi",
      "krem", "krem yuz", "yuz kremi",
      "chandiq", "chandiq kremi", "teri kremi",
      "dog'", "dog' kremi",
      "cho'zilish", "rastyajka", "rastyajkadan",
      "shram", "shramdan",
      "kosmetika", "parvarish",
      "namlash", "namlashish",
      "mejisoo", "bepanten"
    ],

    /* ── Hair & shampoo ───────────────────────────────────── */
    "shampun": [
      "shampun", "shampunlar",
      "soch", "sochlar", "soch parvarishi",
      "soch o'sishi", "soch to'kilishi", "to'kilish",
      "kepek", "kepekdan",
      "oq soch", "sedina",
      "bo'yovchi shampun", "soch bo'yash", "soch bo'yovchi",
      "rozmarin", "rozmarin yog'i", "rozmarin moyi",
      "efir moyi", "soch yog'i", "soch moyi",
      "qosh", "kiprik", "yuz terisi",
      "soch tushishi"
    ],

    /* ── Home & kitchen gadgets ───────────────────────────── */
    "jihozlar": [
      "jihoz", "jihozlar", "uy jihozi", "oshxona jihozi",
      "trimmer", "triymmer", "nos va quloq", "burun va quloq",
      "massajer", "massaj jihozi",
      "stellaj", "tokcha", "javon", "shkaf",
      "ilgich", "sochiq ilgich", "so'rg'ichli ilgich",
      "taglik", "gilamcha", "idish gilamchasi", "quritish gilamchasi",
      "organayzer", "tartiblagich",
      "muzlatkich", "saqlash paketi", "paket",
      "oshxona", "hammom",
      "barmoq ajratgich", "oyoq ajratgich"
    ],

    /* ── Pillow / massage ─────────────────────────────────── */
    "yostiq": [
      "yostiq", "yostiqcha",
      "massaj yostiq", "massaj yostiqcha", "massajer yostiq",
      "relaks yostiq", "relaks",
      "bo'yin yostiq", "bo'yin uchun",
      "pled", "adyol", "ko'rpa",
      "divan", "shinam"
    ],

    /* ── Expanded marketplace categories ─────────────────── */
    "uy jihozlari": [
      "uy jihozi", "uy uchun", "organayzer", "saqlash", "ilgak", "shkaf", "ortopedik yostiq"
    ],
    "oshxona": [
      "kitchen", "oshxona jihozi", "yog purkagich", "moy purkagich", "idish", "taom"
    ],
    "tozalash": [
      "cleaning", "tozalagich", "lavabo", "drenaj", "quvur", "dog", "cleaner"
    ],
    "yoritish": [
      "led", "rgb", "chiroq", "yoritgich", "lenta", "dekor yoritish"
    ],
    "sport": [
      "fitness", "mashq", "espander", "rezina", "resistance band", "trenirovka"
    ],
    "bolalar": [
      "bola", "bolalar", "o'yin", "o'yinchoq", "ijod", "rivojlantiruvchi"
    ],
    "go'zallik": [
      "beauty", "kosmetika", "makiyaj", "krem", "pomada", "tirnoq", "manikyur"
    ],
    "elektronika": [
      "electronic", "elektron", "ipl", "fotoepilyator", "epilator", "qurilma"
    ],
    "parfyumeriya": [
      "atir", "perfume", "parfum", "feromon", "hid"
    ],
    "ayollar kiyimi": [
      "ayol kiyim", "ayollar", "dress", "ko'ylak", "pijama", "ayollar ichki kiyimi"
    ],
    "erkaklar kiyimi": [
      "erkak kiyim", "erkaklar", "kostyum", "polo", "erkaklar shim", "erkaklar ichki kiyimi"
    ],
    "ayollar poyabzali": [
      "ayollar oyoq kiyimi", "ayollar tufli", "uggi", "sandal", "ayollar etik"
    ],
    "erkaklar poyabzali": [
      "erkaklar oyoq kiyimi", "erkaklar krossovka", "krossovka", "sneakers"
    ],
    "avtomobil": [
      "avto", "mashina", "avtomobil aksessuari", "car", "telefon ushlagich", "avto organayzer"
    ],

    /* ── General home ─────────────────────────────────────── */
    "uy uchun": [
      "uy", "oshxona", "hammom",
      "sochiq", "ilgich",
      "idish quritish", "idish",
      "gilamcha", "taglik",
      "pled", "adyol",
      "tapochka", "uy kiyimi",
      "stellaj", "tokcha",
      "organayzer", "tartib"
    ],

    /* ── Beauty / cosmetics ───────────────────────────────── */
    "go'zallik va parvarish": [
      "go'zallik", "parvarish", "beauty",
      "krem", "shampun", "yuz",
      "moy", "yog'", "efir moyi",
      "rozmarin", "lavanda",
      "kiprik", "qosh", "soch",
      "kosmetika", "toza teri"
    ]
  };

  /* ─────────────────────────────────────────────────────────
     3. EXPAND QUERY → SET OF SEARCH TERMS
     ───────────────────────────────────────────────────────── */

  function getSearchTerms(rawQuery) {
    var normalizedQuery = normalizeText(rawQuery);
    var terms = {};
    if (!normalizedQuery) return [];

    // Always include the literal query
    terms[normalizedQuery] = true;

    // Walk every alias group
    var keys = Object.keys(searchAliases);
    for (var i = 0; i < keys.length; i++) {
      var cat = normalizeText(keys[i]);
      var aliases = searchAliases[keys[i]].map(normalizeText);

      // Does the query match the category name or any alias?
      var catMatch      = cat.indexOf(normalizedQuery) !== -1 || normalizedQuery.indexOf(cat) !== -1;
      var aliasMatch    = false;
      for (var j = 0; j < aliases.length; j++) {
        if (aliases[j].indexOf(normalizedQuery) !== -1 || normalizedQuery.indexOf(aliases[j]) !== -1) {
          aliasMatch = true;
          break;
        }
      }

      if (catMatch || aliasMatch) {
        // Expand: include the category name AND all its aliases as additional search terms
        terms[cat] = true;
        for (var k = 0; k < aliases.length; k++) {
          terms[aliases[k]] = true;
        }
      }
    }

    return Object.keys(terms).filter(Boolean);
  }

  /* ─────────────────────────────────────────────────────────
     4. BUILD SEARCHABLE TEXT FOR ONE PRODUCT
     ───────────────────────────────────────────────────────── */

  function buildSearchText(product) {
    var p = product || {};
    var parts = [
      p.name,
      p.title,
      p.category,
      p.subcategory,
      p.brand,
      p.description,
      p.desc,
      p.shortDescription,
      p.color,
      Array.isArray(p.colors) ? p.colors.join(' ') : (p.colors || ''),
      Array.isArray(p.sizes)  ? p.sizes.join(' ')  : (p.sizes  || ''),
      Array.isArray(p.tags)   ? p.tags.join(' ')   : (p.tags   || ''),
      Array.isArray(p.keywords) ? p.keywords.join(' ') : (p.keywords || ''),
      p.size   || '',
      p.tag    || '',
    ];
    return normalizeText(parts.filter(Boolean).join(' '));
  }

  /* ─────────────────────────────────────────────────────────
     5. MAIN SEARCH FUNCTION
     ───────────────────────────────────────────────────────── */

  function searchProducts(products, rawQuery) {
    if (!Array.isArray(products)) return [];
    var normalizedQuery = normalizeText(rawQuery);

    // Empty query → return everything
    if (!normalizedQuery) return products;

    var terms = getSearchTerms(normalizedQuery);

    return products.filter(function (product) {
      var text = buildSearchText(product);
      for (var i = 0; i < terms.length; i++) {
        if (text.indexOf(terms[i]) !== -1) return true;
      }
      return false;
    });
  }

  /* ─────────────────────────────────────────────────────────
     6. AUTO-TAG  (used by admin when saving a new product
        or as a one-off enrichment pass on existing products)
     ───────────────────────────────────────────────────────── */

  function autoTagProduct(product) {
    var p = product || {};
    var existing = Array.isArray(p.tags) ? p.tags.slice() : [];

    // Source fields to mine keywords from
    var sourceParts = [
      p.name || '', p.title || '',
      p.category || '', p.brand || '',
      Array.isArray(p.colors) ? p.colors.join(' ') : (p.colors || ''),
      Array.isArray(p.sizes)  ? p.sizes.join(' ')  : (p.sizes  || ''),
      p.description || '', p.desc || '',
    ];
    var sourceText = normalizeText(sourceParts.filter(Boolean).join(' '));

    // Add any alias that "sounds like" this product
    var keys = Object.keys(searchAliases);
    for (var i = 0; i < keys.length; i++) {
      var cat = normalizeText(keys[i]);
      var aliases = searchAliases[keys[i]].map(normalizeText);

      var catMatch = sourceText.indexOf(cat) !== -1;
      var aliasMatchFound = false;
      for (var j = 0; j < aliases.length; j++) {
        if (sourceText.indexOf(aliases[j]) !== -1) { aliasMatchFound = true; break; }
      }

      if (catMatch || aliasMatchFound) {
        existing.push(cat);
        for (var k = 0; k < aliases.length; k++) {
          existing.push(aliases[k]);
        }
      }
    }

    // Deduplicate
    var seen = {};
    var unique = [];
    for (var m = 0; m < existing.length; m++) {
      var tag = normalizeText(existing[m]);
      if (tag && !seen[tag]) { seen[tag] = true; unique.push(tag); }
    }

    return Object.assign({}, p, { tags: unique });
  }

  /* ─────────────────────────────────────────────────────────
     7. EXPOSE
     ───────────────────────────────────────────────────────── */

  global.MBSearch = {
    normalizeText    : normalizeText,
    searchAliases    : searchAliases,
    getSearchTerms   : getSearchTerms,
    buildSearchText  : buildSearchText,
    searchProducts   : searchProducts,
    autoTagProduct   : autoTagProduct,
  };

})(window);
