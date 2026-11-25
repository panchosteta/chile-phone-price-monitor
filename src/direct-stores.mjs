import {
  EXCLUDED_CONDITION_REGEX,
  EXCLUDED_ACCESSORY_OR_PLAN_REGEX,
  extractCapacity,
  extractColor,
  extractGpuVariant
} from "./config.mjs";

const DIRECT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-CL,es;q=0.9,en;q=0.8"
};

function isCleanNewUnlocked(text = "", url = "") {
  const combined = `${text} ${url}`;
  if (EXCLUDED_CONDITION_REGEX.test(combined)) return false;
  if (EXCLUDED_ACCESSORY_OR_PLAN_REGEX.test(combined)) return false;
  return true;
}

function parseClpNumber(val) {
  if (typeof val === "number") return Number.isFinite(val) ? Math.round(val) : null;
  if (typeof val !== "string") return null;
  const cleaned = val.replace(/[^\d]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function extractLdJsonBlocks(html = "") {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      // ignore malformed JSON-LD block
    }
  }
  return out;
}

async function fetchDirect(url, timeoutMs = 9000) {
  return fetch(url, {
    headers: DIRECT_HEADERS,
    signal: AbortSignal.timeout(timeoutMs)
  });
}

function getDirectSearchTerms(phone) {
  if (phone.id === "galaxy-z-fold-8") return ["galaxy z fold 8"];
  if (phone.id === "rx-9060-xt-16gb") return ["rx 9060 xt 16gb"];
  if (phone.id === "rx-9060-xt-8gb") return ["rx 9060 xt 8gb"];
  return [phone.soloTodoSearches[0]];
}

/**
 * Falabella Chile direct search via __NEXT_DATA__ (real-time CMR + Internet/Event prices)
 */
export async function fetchFalabellaDirect(phone) {
  const listings = [];
  const seenUrls = new Set();

  for (const term of getDirectSearchTerms(phone)) {
    const res = await fetchDirect(
      `https://www.falabella.com/falabella-cl/search?Ntt=${encodeURIComponent(term)}`
    );
    if (!res.ok) throw new Error(`Falabella HTTP ${res.status}`);
    const html = await res.text();
    const m = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
    );
    if (!m) continue;

    const data = JSON.parse(m[1]);
    const results = data?.props?.pageProps?.results || [];

    for (const r of results) {
      const title = `${r.brand ? `${r.brand} ` : ""}${r.displayName || ""}`.trim();
      const url = r.url || "";
      if (!url || seenUrls.has(url)) continue;
      if (!phone.matchesTitle(`${title} ${url}`)) continue;
      if (!isCleanNewUnlocked(title, url)) continue;

      const prices = r.prices || [];
      let cmrPrice = null;
      let internetPrice = null;

      for (const pr of prices) {
        if (pr.crossed) continue;
        const firstVal = Array.isArray(pr.price) ? parseClpNumber(pr.price[0]) : parseClpNumber(pr.price);
        if (!firstVal || firstVal < phone.minPlausiblePrice) continue;

        if (pr.type === "cmrPrice") {
          cmrPrice = cmrPrice ? Math.min(cmrPrice, firstVal) : firstVal;
        } else if (pr.type === "eventPrice" || pr.type === "internetPrice") {
          internetPrice = internetPrice ? Math.min(internetPrice, firstVal) : firstVal;
        } else if (!internetPrice) {
          internetPrice = firstVal;
        }
      }

      const anyPaymentPrice = internetPrice ?? cmrPrice;
      const specificPrice = cmrPrice ?? internetPrice;
      if (!specificPrice || specificPrice < phone.minPlausiblePrice) continue;

      seenUrls.add(url);
      const isMarketplace =
        r.sellerName && !/^falabella$/i.test(String(r.sellerName).trim());
      const storeName = isMarketplace
        ? `Falabella Marketplace (${r.sellerName})`
        : "Falabella";

      listings.push({
        phoneId: phone.id,
        phoneName: phone.name,
        source: "Falabella Directo",
        isDirect: true,
        store: storeName,
        title: r.displayName || title,
        capacity: phone.fixedCapacity || extractCapacity(`${title} ${url}`),
        color:
          phone.kind === "gpu"
            ? extractGpuVariant(`${title} ${url}`)
            : extractColor(`${title} ${url}`),
        specificPrice,
        anyPaymentPrice: anyPaymentPrice || specificPrice,
        stockConfirmed: true,
        stockNote: "En stock (Falabella directo)",
        url,
        updatedAt: new Date().toISOString()
      });
    }
  }

  return listings;
}

// Limit concurrent heavy HTML fetches (Paris search pages are ~4 MB each) so Render Free 0.1 CPU never times out
let parisQueue = Promise.resolve();
function runInParisQueue(fn) {
  const next = parisQueue.then(fn, fn);
  parisQueue = next.catch(() => {});
  return next;
}

/**
 * Paris.cl direct search via JSON-LD ItemList + top 2 product pages for exact Cencosud price
 */
export async function fetchParisDirect(phone) {
  return runInParisQueue(async () => {
    const candidates = [];
    const seenUrls = new Set();

    for (const term of getDirectSearchTerms(phone)) {
      const res = await fetchDirect(
        `https://www.paris.cl/search?q=${encodeURIComponent(term)}`,
        18000
      );
      if (!res.ok) throw new Error(`Paris HTTP ${res.status}`);
      const html = await res.text();
      const lds = extractLdJsonBlocks(html);
      const wp = lds.find((x) => x["@type"] === "WebPage" && x.mainEntity?.itemListElement);
      const items = wp?.mainEntity?.itemListElement || [];

      for (const li of items) {
        const prod = li?.item;
        if (!prod) continue;
        const brand = prod.brand?.name || "";
        const rawTitle = prod.name || li.name || "";
        const title = brand && !rawTitle.toLowerCase().includes(brand.toLowerCase())
          ? `${brand} ${rawTitle}`
          : rawTitle;
        const url = prod.url || "";
        if (!url || seenUrls.has(url)) continue;
        if (!phone.matchesTitle(`${title} ${url}`)) continue;
        if (!isCleanNewUnlocked(title, url)) continue;

        const offer = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers;
        const price = parseClpNumber(offer?.price);
        if (!price || price < phone.minPlausiblePrice) continue;
        if (/OutOfStock/i.test(String(offer?.availability || ""))) continue;

        seenUrls.add(url);
        candidates.push({
          phoneId: phone.id,
          phoneName: phone.name,
          source: "Paris Directo",
          isDirect: true,
          store: "Paris",
          title: rawTitle,
          capacity: phone.fixedCapacity || extractCapacity(`${title} ${url}`),
          color:
            phone.kind === "gpu"
              ? extractGpuVariant(`${title} ${url}`)
              : extractColor(`${title} ${url}`),
          specificPrice: price,
          anyPaymentPrice: price,
          stockConfirmed: true,
          stockNote: "En stock (Paris directo)",
          url,
          updatedAt: new Date().toISOString()
        });
      }
    }

    candidates.sort((a, b) => a.specificPrice - b.specificPrice);

    // Enrich top 2 cheapest Paris listings with product page JSON-LD offers[] to get exact Cencosud card price
    for (const item of candidates.slice(0, 2)) {
      try {
        const res = await fetchDirect(item.url, 12000);
        if (!res.ok) continue;
        const html = await res.text();
        const lds = extractLdJsonBlocks(html);
        const prod = lds.find((x) => x["@type"] === "Product");
        const offers = Array.isArray(prod?.offers)
          ? prod.offers
          : prod?.offers
            ? [prod.offers]
            : [];
        const validPrices = offers
          .filter((o) => !/OutOfStock/i.test(String(o?.availability || "")))
          .map((o) => parseClpNumber(o?.price))
          .filter((p) => p && p >= phone.minPlausiblePrice)
          .sort((a, b) => a - b);

        if (validPrices.length >= 2) {
          item.specificPrice = validPrices[0];
          item.anyPaymentPrice = validPrices[1];
        } else if (validPrices.length === 1) {
          item.specificPrice = validPrices[0];
          item.anyPaymentPrice = validPrices[0];
        }
      } catch {
        // Non-fatal; keep search-level Paris internet price
      }
    }

    return candidates;
  });
}

/**
 * Hites.com direct search via JSON-LD ItemList
 */
export async function fetchHitesDirect(phone) {
  const listings = [];
  const seenUrls = new Set();

  for (const term of getDirectSearchTerms(phone)) {
    const res = await fetchDirect(
      `https://www.hites.com/search?q=${encodeURIComponent(term)}`
    );
    if (!res.ok) throw new Error(`Hites HTTP ${res.status}`);
    const html = await res.text();
    const lds = extractLdJsonBlocks(html);
    const listBlock = lds.find((x) => x["@type"] === "ItemList" && x.itemListElement);
    const items = listBlock?.itemListElement || [];

    for (const li of items) {
      const prod = li?.item;
      if (!prod) continue;
      const title = prod.name || li.name || "";
      const url = prod.url || prod["@id"] || "";
      if (!url || !url.startsWith("http") || seenUrls.has(url)) continue;
      if (!phone.matchesTitle(`${title} ${url}`)) continue;
      if (!isCleanNewUnlocked(title, url)) continue;

      const offer = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers;
      const price = parseClpNumber(offer?.price);
      if (!price || price < phone.minPlausiblePrice) continue;
      if (/OutOfStock/i.test(String(offer?.availability || ""))) continue;

      seenUrls.add(url);
      listings.push({
        phoneId: phone.id,
        phoneName: phone.name,
        source: "Hites Directo",
        isDirect: true,
        store: "Hites",
        title,
        capacity: phone.fixedCapacity || extractCapacity(`${title} ${url}`),
        color:
          phone.kind === "gpu"
            ? extractGpuVariant(`${title} ${url}`)
            : extractColor(`${title} ${url}`),
        specificPrice: price,
        anyPaymentPrice: price,
        stockConfirmed: true,
        stockNote: "En stock (Hites directo)",
        url,
        updatedAt: new Date().toISOString()
      });
    }
  }

  return listings;
}

/**
 * Live direct price refresh for product pages on stores that serve clean JSON-LD / Shopify JSON
 * (Notebooksya!, Cintegral, OPC Store, Hites, ABC) so flash drops are caught before SoloTodo/Knasta update.
 */
export async function refreshDirectProductPrices(phone, listings) {
  const refreshableHosts = [
    "notebooksya.cl",
    "cintegral.cl",
    "opcstore.cl",
    "hites.com"
  ];

  const targets = listings
    .filter((l) => {
      if (l.isDirect) return false;
      try {
        const host = new URL(l.url).hostname.replace(/^www\./, "");
        return refreshableHosts.some((h) => host === h || host.endsWith(`.${h}`));
      } catch {
        return false;
      }
    })
    .slice(0, 4);

  if (targets.length === 0) return;

  await Promise.allSettled(
    targets.map(async (item) => {
      const host = new URL(item.url).hostname.replace(/^www\./, "");

      // Shopify .json endpoint for OPC Store
      if (host.endsWith("opcstore.cl") && item.url.includes("/products/")) {
        const jsonUrl = `${item.url.split("?")[0].replace(/\/$/, "")}.json`;
        const res = await fetchDirect(jsonUrl, 7000);
        if (!res.ok) return;
        const data = await res.json();
        const variant = data?.product?.variants?.[0];
        const price = parseClpNumber(variant?.price);
        if (price && price >= phone.minPlausiblePrice) {
          item.specificPrice = price;
          item.anyPaymentPrice = price;
          item.isDirect = true;
          item.source = `${item.source} + Directo`;
          item.stockNote = "En stock (OPC Store directo)";
        }
        return;
      }

      // JSON-LD Product pages (Notebooksya!, Cintegral, Hites)
      const res = await fetchDirect(item.url, 7000);
      if (!res.ok) return;
      const html = await res.text();
      const lds = extractLdJsonBlocks(html);
      const prod =
        lds.find((x) => x["@type"] === "Product") ||
        lds.flatMap((x) => x["@graph"] || []).find((x) => x["@type"] === "Product");
      if (!prod?.offers) return;

      const offers = Array.isArray(prod.offers) ? prod.offers : [prod.offers];
      const outOfStock = offers.every((o) =>
        /OutOfStock/i.test(String(o?.availability || ""))
      );
      if (outOfStock) {
        item.stockConfirmed = false;
        item.stockNote = `Sin stock (${item.store} directo)`;
        return;
      }

      const prices = [];
      for (const o of offers) {
        const directPrice = parseClpNumber(o?.price);
        if (directPrice && directPrice >= phone.minPlausiblePrice) prices.push(directPrice);
        if (Array.isArray(o?.priceSpecification)) {
          for (const spec of o.priceSpecification) {
            if (spec?.priceType && /Strikethrough/i.test(spec.priceType)) continue;
            const sp = parseClpNumber(spec?.price);
            if (sp && sp >= phone.minPlausiblePrice) prices.push(sp);
          }
        }
      }

      if (prices.length > 0) {
        prices.sort((a, b) => a - b);
        const livePrice = prices[0];
        // Update if live price differs (direct store page is ground truth!)
        if (livePrice < item.specificPrice || host.endsWith("hites.com") || host.endsWith("cintegral.cl")) {
          item.specificPrice = Math.min(item.specificPrice, livePrice);
          if (host.endsWith("hites.com") || host.endsWith("cintegral.cl")) {
            item.specificPrice = livePrice;
            item.anyPaymentPrice = livePrice;
          }
          item.isDirect = true;
          if (!item.source.includes("Directo")) item.source = `${item.source} + Directo`;
          item.stockNote = `En stock (${item.store} directo)`;
        }
      }
    })
  );
}

export async function fetchAllDirectForPhone(phone) {
  const results = [];
  const errors = [];

  const tasks = [
    ["Falabella Directo", fetchFalabellaDirect(phone)],
    ["Paris Directo", fetchParisDirect(phone)],
    ["Hites Directo", fetchHitesDirect(phone)]
  ];

  const settled = await Promise.allSettled(tasks.map(([, p]) => p));
  settled.forEach((res, idx) => {
    const label = tasks[idx][0];
    if (res.status === "fulfilled") {
      results.push(...res.value);
    } else {
      errors.push(`${label} (${phone.name}): ${res.reason?.message || res.reason}`);
    }
  });

  return { listings: results, errors };
}
