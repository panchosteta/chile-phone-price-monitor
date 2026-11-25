import {
  TARGET_PHONES,
  EXCLUDED_CONDITION_REGEX,
  EXCLUDED_ACCESSORY_OR_PLAN_REGEX,
  extractCapacity,
  extractColor
} from "./config.mjs";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json, text/html;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-CL,es;q=0.9,en;q=0.8"
};

let storeCache = { fetchedAt: 0, map: new Map() };
const STORE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
  return fetch(url, {
    ...opts,
    headers: { ...DEFAULT_HEADERS, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs)
  });
}

async function getSoloTodoStoreMap() {
  const now = Date.now();
  if (storeCache.map.size > 0 && now - storeCache.fetchedAt < STORE_CACHE_TTL_MS) {
    return storeCache.map;
  }
  const res = await fetchWithTimeout("https://publicapi.solotodo.com/stores/?countries=1");
  if (!res.ok) throw new Error(`SoloTodo stores HTTP ${res.status}`);
  const stores = await res.json();
  const map = new Map(stores.map((s) => [s.id, s.name]));
  storeCache = { fetchedAt: now, map };
  return map;
}

function isCleanNewUnlocked(text = "", url = "") {
  const combined = `${text} ${url}`;
  if (EXCLUDED_CONDITION_REGEX.test(combined)) return false;
  if (EXCLUDED_ACCESSORY_OR_PLAN_REGEX.test(combined)) return false;
  return true;
}

function normalizeUrlForDedup(rawUrl = "") {
  try {
    const u = new URL(rawUrl);
    const sku = u.searchParams.get("default_sku");
    u.search = sku ? `?default_sku=${encodeURIComponent(sku)}` : "";
    u.hash = "";
    return u.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return String(rawUrl).trim().toLowerCase();
  }
}

function unwrapKnastaUrl(rawUrl = "") {
  if (!rawUrl) return "";
  if (rawUrl.startsWith("/redirect/")) {
    try {
      const u = new URL(`https://knasta.cl${rawUrl}`);
      const partner = u.searchParams.get("partner_url");
      if (partner) {
        const clean = new URL(partner);
        for (const p of [
          "utm_source",
          "utm_medium",
          "utm_campaign",
          "utm_content",
          "utm_term",
          "matt_word",
          "matt_tool",
          "forceInApp",
          "athbdg"
        ]) {
          clean.searchParams.delete(p);
        }
        return clean.toString();
      }
    } catch {
      return `https://knasta.cl${rawUrl}`;
    }
  }
  try {
    const clean = new URL(rawUrl);
    for (const p of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "athbdg"]) {
      clean.searchParams.delete(p);
    }
    return clean.toString();
  } catch {
    return rawUrl;
  }
}

function isRecentChileDate(ddmmyyyy, maxAgeDays = 3) {
  if (!ddmmyyyy || typeof ddmmyyyy !== "string") return true;
  const parts = ddmmyyyy.split("-");
  if (parts.length !== 3) return true;
  const [dd, mm, yyyy] = parts.map(Number);
  if (!dd || !mm || !yyyy) return true;
  const dateUtc = Date.UTC(yyyy, mm - 1, dd);
  const nowChile = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Santiago" })
  );
  const todayUtc = Date.UTC(
    nowChile.getFullYear(),
    nowChile.getMonth(),
    nowChile.getDate()
  );
  const diffDays = (todayUtc - dateUtc) / (1000 * 60 * 60 * 24);
  return diffDays <= maxAgeDays;
}

async function fetchSoloTodoForPhone(phone, storeMap) {
  const matchedProducts = new Map();

  for (const query of phone.soloTodoSearches) {
    const url = `https://publicapi.solotodo.com/products/browse/?categories=6&search=${encodeURIComponent(
      query
    )}&page_size=50`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`SoloTodo browse HTTP ${res.status}`);
    const data = await res.json();

    for (const bucket of data.results || []) {
      for (const entry of bucket.product_entries || []) {
        const p = entry.product;
        if (!p || matchedProducts.has(p.id)) continue;
        if (phone.matchesTitle(p.name) && isCleanNewUnlocked(p.name)) {
          matchedProducts.set(p.id, p);
        }
      }
    }
  }

  if (matchedProducts.size === 0) return [];

  const ids = [...matchedProducts.keys()];
  const listings = [];

  // Query in chunks of 20 product IDs to keep URLs well-formed
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    const idsQuery = chunk.map((id) => `ids=${id}`).join("&");
    const entRes = await fetchWithTimeout(
      `https://publicapi.solotodo.com/products/available_entities/?${idsQuery}&countries=1`
    );
    if (!entRes.ok) throw new Error(`SoloTodo entities HTTP ${entRes.status}`);
    const entData = await entRes.json();

    for (const item of entData.results || []) {
      const productName = item.product?.name || "";
      const skuColor =
        item.product?.specs?.color_unicode || extractColor(productName);
      const skuCapacity =
        item.product?.specs?.internal_storage_unicode || extractCapacity(productName);

      for (const entity of item.entities || []) {
        if (entity.cell_plan) continue;
        if (entity.condition !== "https://schema.org/NewCondition") continue;
        if (!entity.active_registry?.is_available) continue;

        const entityTitle = entity.name || productName;
        const externalUrl = entity.external_url || "";
        if (!isCleanNewUnlocked(entityTitle, externalUrl)) continue;

        const offerPrice = Math.round(Number(entity.active_registry.offer_price));
        const normalPrice = Math.round(Number(entity.active_registry.normal_price));
        if (!Number.isFinite(offerPrice) || offerPrice < phone.minPlausiblePrice) continue;
        if (!Number.isFinite(normalPrice) || normalPrice < phone.minPlausiblePrice) continue;

        // Prefer capacity explicitly stated in the store's own title/URL over SoloTodo SKU mapping
        const detectedCap = extractCapacity(`${entityTitle} ${externalUrl}`);
        const capacity = detectedCap !== "No especificada" ? detectedCap : skuCapacity;

        const storeName = storeMap.get(entity.store) || `Tienda #${entity.store}`;
        listings.push({
          phoneId: phone.id,
          phoneName: phone.name,
          source: "SoloTodo",
          store: storeName,
          title: entityTitle,
          capacity,
          color: skuColor || extractColor(entityTitle),
          specificPrice: offerPrice,
          anyPaymentPrice: normalPrice,
          stockConfirmed: true,
          stockNote: "En stock (SoloTodo)",
          url: externalUrl,
          updatedAt: entity.active_registry.timestamp || new Date().toISOString()
        });
      }
    }
  }

  return listings;
}

async function fetchKnastaForPhone(phone) {
  const seenKids = new Set();
  const listings = [];

  for (const query of phone.knastaSearches) {
    const res = await fetchWithTimeout(
      `https://knasta.cl/results?q=${encodeURIComponent(query)}`
    );
    if (!res.ok) throw new Error(`Knasta HTTP ${res.status}`);
    const html = await res.text();
    const match = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
    );
    if (!match) continue;

    const nextData = JSON.parse(match[1]);
    const products = nextData?.props?.pageProps?.initialData?.products || [];

    for (const p of products) {
      if (!p?.kid || seenKids.has(p.kid)) continue;
      seenKids.add(p.kid);

      const title = p.title || p.seo_title || "";
      const url = unwrapKnastaUrl(p.url || "");
      if (!phone.matchesTitle(`${title} ${p.seo_title || ""}`)) continue;
      if (!isCleanNewUnlocked(title, url)) continue;
      if (!isRecentChileDate(p.current_day, 3)) continue;

      const currentPrice = Math.round(Number(p.current_price));
      const internetPrice = p.price_internet ? Math.round(Number(p.price_internet)) : null;
      const cardPrice = p.price_card ? Math.round(Number(p.price_card)) : null;

      if (!Number.isFinite(currentPrice) || currentPrice < phone.minPlausiblePrice) continue;

      const specificPrice = cardPrice && cardPrice >= phone.minPlausiblePrice ? cardPrice : currentPrice;
      const anyPaymentPrice =
        internetPrice && internetPrice >= phone.minPlausiblePrice
          ? internetPrice
          : currentPrice;

      const capacity = extractCapacity(`${title} ${p.seo_title || ""} ${url}`);

      listings.push({
        phoneId: phone.id,
        phoneName: phone.name,
        source: "Knasta",
        knastaKid: p.kid,
        knastaRetail: p.retail,
        knastaProductId: p.product_id,
        store: p.retail_label || p.retail || "Tienda",
        title,
        capacity,
        color: extractColor(title),
        specificPrice,
        anyPaymentPrice,
        stockConfirmed: true,
        stockNote: `Activo en Knasta (${p.current_day || "hoy"})`,
        url,
        updatedAt: p.current_day || new Date().toISOString()
      });
    }
  }

  return listings;
}

export async function verifyCandidateListing(listing) {
  const enriched = { ...listing };

  if (enriched.source === "Knasta" && enriched.knastaRetail && enriched.knastaProductId) {
    try {
      const detailUrl = `https://knasta.cl/detail/${encodeURIComponent(
        enriched.knastaRetail
      )}/${encodeURIComponent(enriched.knastaProductId)}`;
      const res = await fetchWithTimeout(detailUrl, {}, 8000);
      if (res.ok) {
        const html = await res.text();
        const m = html.match(
          /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
        );
        if (m) {
          const d = JSON.parse(m[1]);
          const prod = d?.props?.pageProps?.initialData?.product || d?.props?.pageProps?.product;
          if (prod) {
            if (prod.price_card) enriched.specificPrice = Math.round(Number(prod.price_card));
            if (prod.price_internet) enriched.anyPaymentPrice = Math.round(Number(prod.price_internet));
            if (prod.url) {
              const unwrapped = unwrapKnastaUrl(prod.url);
              if (unwrapped.startsWith("http")) enriched.url = unwrapped;
            }
            if (prod.current_day) {
              enriched.updatedAt = prod.current_day;
              enriched.stockNote = `Confirmado en Knasta (${prod.current_day})`;
            }
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  if (enriched.url && enriched.url.startsWith("http")) {
    try {
      const res = await fetchWithTimeout(enriched.url, {}, 7000);
      if (res.status === 404 || res.status === 410) {
        enriched.stockConfirmed = false;
        enriched.stockNote = `Publicación no encontrada (HTTP ${res.status})`;
      } else if (res.ok) {
        const html = await res.text();
        const hasOutOfStockSchema =
          /"availability"\s*:\s*"https?:\/\/schema\.org\/OutOfStock"/i.test(html);
        const hasInStockSchema =
          /"availability"\s*:\s*"https?:\/\/schema\.org\/InStock"/i.test(html);

        if (hasOutOfStockSchema && !hasInStockSchema) {
          enriched.stockConfirmed = false;
          enriched.stockNote = "Sin stock (verificado en tienda)";
        } else if (hasInStockSchema) {
          enriched.stockConfirmed = true;
          enriched.stockNote = `En stock (verificado directo en ${enriched.store})`;
        }
      }
    } catch {
      // WAF/timeout on direct store fetch -> rely on SoloTodo/Knasta live availability
    }
  }

  return enriched;
}

function deduplicateListings(listings) {
  const byKey = new Map();
  for (const item of listings) {
    const key = `${item.phoneId}|${normalizeUrlForDedup(item.url)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    const sources = new Set([...existing.source.split(" + "), item.source]);
    const preferred = existing.source === "SoloTodo" ? existing : item;
    const other = preferred === existing ? item : existing;
    byKey.set(key, {
      ...preferred,
      source: [...sources].join(" + "),
      capacity: preferred.capacity !== "No especificada" ? preferred.capacity : other.capacity,
      color: preferred.color !== "No especificado" ? preferred.color : other.color,
      specificPrice: Math.min(preferred.specificPrice, other.specificPrice),
      anyPaymentPrice: Math.min(preferred.anyPaymentPrice, other.anyPaymentPrice)
    });
  }
  return [...byKey.values()];
}

export async function fetchAllListings() {
  const errors = [];
  let storeMap = new Map();
  try {
    storeMap = await getSoloTodoStoreMap();
  } catch (err) {
    errors.push(`SoloTodo stores: ${err.message}`);
  }

  const perPhone = await Promise.all(
    TARGET_PHONES.map(async (phone) => {
      const results = [];
      const [stRes, knRes] = await Promise.allSettled([
        storeMap.size > 0 ? fetchSoloTodoForPhone(phone, storeMap) : Promise.resolve([]),
        fetchKnastaForPhone(phone)
      ]);

      if (stRes.status === "fulfilled") {
        results.push(...stRes.value);
      } else {
        errors.push(`SoloTodo (${phone.name}): ${stRes.reason?.message || stRes.reason}`);
      }

      if (knRes.status === "fulfilled") {
        results.push(...knRes.value);
      } else {
        errors.push(`Knasta (${phone.name}): ${knRes.reason?.message || knRes.reason}`);
      }

      const deduped = deduplicateListings(results);
      deduped.sort((a, b) => a.specificPrice - b.specificPrice);
      return { phone, listings: deduped };
    })
  );

  return { perPhone, errors };
}
