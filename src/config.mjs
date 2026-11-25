export const TARGET_PHONES = [
  {
    id: "iphone-17-pro",
    name: "iPhone 17 Pro",
    kind: "phone",
    soloTodoCategoryId: 6,
    thresholds: {
      specificPaymentMax: 1142991,
      anyPaymentMax: 1269990
    },
    minPlausiblePrice: 500000,
    soloTodoSearches: ["iPhone 17 Pro"],
    knastaSearches: ["iphone 17 pro", "iphone 17 pro 512", "iphone 17 pro 1tb"],
    matchesTitle(text) {
      const s = normalize(text);
      return /\biphone\s*17\s*pro\b/.test(s) && !/\bpro\s*max\b/.test(s);
    }
  },
  {
    id: "galaxy-z-fold-8",
    name: "Samsung Galaxy Z Fold 8",
    kind: "phone",
    soloTodoCategoryId: 6,
    thresholds: {
      specificPaymentMax: 1559990,
      anyPaymentMax: 1599990
    },
    minPlausiblePrice: 600000,
    soloTodoSearches: ["Z Fold8", "Z Fold 8"],
    knastaSearches: ["galaxy z fold 8", "galaxy z fold8"],
    matchesTitle(text) {
      const s = normalize(text);
      return /\bz\s*fold\s*8\b/.test(s) && !/\bultra\b/.test(s);
    }
  },
  {
    id: "galaxy-s26-ultra",
    name: "Samsung Galaxy S26 Ultra",
    kind: "phone",
    soloTodoCategoryId: 6,
    thresholds: {
      specificPaymentMax: 1145547,
      anyPaymentMax: 1145547
    },
    minPlausiblePrice: 500000,
    soloTodoSearches: ["Galaxy S26 Ultra"],
    knastaSearches: ["galaxy s26 ultra", "galaxy s26 ultra 512", "galaxy s26 ultra 1tb"],
    matchesTitle(text) {
      const s = normalize(text);
      return /\bs26\s*ultra\b/.test(s);
    }
  },
  {
    id: "xiaomi-17-ultra",
    name: "Xiaomi 17 Ultra",
    kind: "phone",
    soloTodoCategoryId: 6,
    thresholds: {
      specificPaymentMax: 1149990,
      anyPaymentMax: 1192800
    },
    minPlausiblePrice: 500000,
    soloTodoSearches: ["Xiaomi 17 Ultra"],
    knastaSearches: ["xiaomi 17 ultra", "xiaomi 17 ultra 1tb"],
    matchesTitle(text) {
      const s = normalize(text);
      return /\bxiaomi\s*17\s*ultra\b/.test(s) || (/\b17\s*ultra\b/.test(s) && /\bxiaomi\b/.test(s));
    }
  },
  {
    id: "rx-9060-xt-16gb",
    name: "AMD Radeon RX 9060 XT (16 GB)",
    kind: "gpu",
    fixedCapacity: "16 GB GDDR6",
    soloTodoCategoryId: 2,
    thresholds: {
      specificPaymentMax: 629000,
      anyPaymentMax: 662105
    },
    minPlausiblePrice: 300000,
    soloTodoSearches: ["9060 XT"],
    knastaSearches: ["rx 9060 xt 16gb", "radeon 9060 xt 16gb"],
    matchesTitle(text) {
      const s = normalize(text);
      const is9060Xt = /\b(rx\s*)?9060\s*xt\b/.test(s);
      const is16Gb = /(?:^|[^0-9])16\s*g(b|d|o)?(?![0-9a-z])/.test(s);
      const is8Gb = /(?:^|[^0-9])8\s*g(b|d|o)?(?![0-9a-z])/.test(s);
      const isPrebuiltPc =
        /\b(pc\s*gamer|computador|torre\s*gamer|gabinete|notebook|laptop|ryzen\s*[3579]|core\s*i[3579]|i[579]-\d{4,5}|win\s*1[01])\b/.test(
          s
        );
      return is9060Xt && is16Gb && !is8Gb && !isPrebuiltPc;
    }
  }
];

export const PRIORITY_STORES = [
  /falabella/i,
  /paris/i,
  /lider/i,
  /ripley/i,
  /maconline/i,
  /mercado\s*libre/i,
  /movistar/i,
  /samsung/i,
  /xiaomi/i,
  /\babc|abcdin/i,
  /entel/i,
  /pc\s*factory/i,
  /sp\s*digital/i,
  /nice\s*one/i
];

export const EXCLUDED_CONDITION_REGEX =
  /\b(reacondicionado|reacondicionados|refurbished|refurb|seminuevo|semi\s*nuevo|usado|usados|open\s*box|caja\s*abierta|exhibici[oó]n|vitrina|segunda\s*mano|grado\s*[abc]|como\s*nuevo|renewed|remanufacturado|outlet\s*usado)\b/i;

export const EXCLUDED_ACCESSORY_OR_PLAN_REGEX =
  /(?:^\s*(carcasa|funda|estuche|case|l[aá]mina|vidrio\s*templado|mica|protector|cargador|cable|adaptador|soporte|aud[ií]fono|correa|skin)\b|\b(carcasa|funda|estuche|l[aá]mina|vidrio\s*templado|mica|protector\s+de\s+pantalla|plan\s+libre|cuota\s+de\s+arriendo|arriendo|portabilidad|movistar\s*one|claro\s*up)\b)/i;

export const STORE_SPECIFIC_PAYMENT_LABELS = [
  { match: /falabella/i, label: "Tarjeta CMR Falabella" },
  { match: /ripley/i, label: "Tarjeta Ripley / Chek" },
  { match: /paris/i, label: "Tarjeta Cencosud Scotiabank" },
  { match: /lider/i, label: "Tarjeta Lider Bci" },
  { match: /\babc|abcdin/i, label: "Tarjeta abc Visa" },
  { match: /hites/i, label: "Tarjeta Hites" },
  { match: /la\s*polar/i, label: "Tarjeta La Polar" },
  { match: /entel/i, label: "Medio de pago específico Entel" },
  { match: /movistar/i, label: "Medio de pago específico Movistar" },
  { match: /maconline/i, label: "Medio de pago promocional MacOnline" },
  { match: /samsung/i, label: "Medio de pago promocional Samsung Chile" },
  {
    match: /(pc\s*factory|nice\s*one|notebooksya|infor-?ingen|megadrive|eylstore|pc\s*express|sandos|centrale|sp\s*digital|winpy|myshop|wei|bip|gsmpro|prophone|opc\s*store|alltec|ttchile|dust2)/i,
    label: "Transferencia / Efectivo"
  }
];

export function normalize(str = "") {
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getSpecificPaymentLabel(storeName = "") {
  for (const entry of STORE_SPECIFIC_PAYMENT_LABELS) {
    if (entry.match.test(storeName)) return entry.label;
  }
  return `Medio de pago específico (${storeName || "tienda"})`;
}

export function isPriorityStore(storeName = "") {
  return PRIORITY_STORES.some((rx) => rx.test(storeName));
}

export function formatCLP(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "N/A";
  return `$${Math.round(amount).toLocaleString("es-CL")}`;
}

export function extractCapacity(text = "") {
  const s = normalize(text);
  const tb = s.match(/(?:^|[^0-9])([12])\s*tb(?![a-z])/);
  if (tb) return `${tb[1]} TB`;
  const gb = s.match(/(?:^|[^0-9])(128|256|512|1024)\s*gb(?![a-z])/);
  if (gb) return gb[1] === "1024" ? "1 TB" : `${gb[1]} GB`;
  return "No especificada";
}

export function extractGpuVariant(text = "") {
  const variants = [
    ["PowerColor Reaper", /powercolor.*reaper|\breaper\b/i],
    ["PowerColor Hellhound", /hellhound/i],
    ["PowerColor Red Devil", /red\s*devil/i],
    ["ASUS Dual", /asus.*dual|\bdual\b.*9060/i],
    ["ASUS Prime", /asus.*prime|\bprime\b.*9060/i],
    ["ASUS TUF", /\btuf\b/i],
    ["ASRock Challenger", /challenger/i],
    ["ASRock Steel Legend", /steel\s*legend/i],
    ["Sapphire Pulse", /sapphire.*pulse|\bpulse\b/i],
    ["Sapphire Pure", /sapphire.*pure|\bpure\b/i],
    ["Sapphire Nitro+", /nitro/i],
    ["Gigabyte Gaming", /gigabyte.*gaming/i],
    ["Gigabyte Aorus", /aorus/i],
    ["XFX Swift / Quicksilver", /\bxfx\b/i],
    ["MSI Gaming / Ventus", /\bmsi\b/i]
  ];
  for (const [label, rx] of variants) {
    if (rx.test(text)) return label;
  }
  return "Estándar";
}

export function extractColor(text = "") {
  const known = [
    ["Cosmic Orange", /\b(cosmic\s*orange|naranj[oa]|orange)\b/i],
    ["Deep Blue", /\b(deep\s*blue|azul\s*profundo|azul\s*oscuro)\b/i],
    ["Sky Blue", /\b(sky\s*blue|azul\s*cielo|celeste)\b/i],
    ["Cobalt Violet", /\b(cobalt\s*violet|violeta\s*cobalto|violeta|morado|purple)\b/i],
    ["Starlit Green", /\b(starlit\s*green|verde\s*estelar|verde|green)\b/i],
    ["Silver Shadow", /\b(silver\s*shadow|plateado|plata|silver)\b/i],
    ["Pink Gold", /\b(pink\s*gold|oro\s*rosa|rosado)\b/i],
    ["Graphite", /\b(graphite|grafito)\b/i],
    ["Lavender", /\b(lavender|lavanda)\b/i],
    ["Cream", /\b(cream|crema)\b/i],
    ["Gris / Titanium", /\b(gris|gray|grey|titanium|titanio)\b/i],
    ["Negro / Black", /\b(negro|black)\b/i],
    ["Blanco / White", /\b(blanco|white)\b/i],
    ["Azul / Blue", /\b(azul|blue)\b/i]
  ];
  for (const [label, regex] of known) {
    if (regex.test(text)) return label;
  }
  return "No especificado";
}
