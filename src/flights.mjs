import { formatCLP } from "./config.mjs";

export const FLIGHT_WATCHES = [
  {
    id: "scl-mad-jun-2027-3w",
    name: "Vuelo Santiago (SCL) ↔ Madrid (MAD) — Junio 2027 (3 semanas)",
    origin: "SCL",
    destination: "MAD",
    maxPriceClp: 700000,
    maxStops: 1, // Directo o máximo 1 escala
    datePairs: [
      ["2027-06-01", "2027-06-22"],
      ["2027-06-05", "2027-06-26"],
      ["2027-06-08", "2027-06-29"],
      ["2027-06-12", "2027-07-03"],
      ["2027-06-15", "2027-07-06"],
      ["2027-06-19", "2027-07-10"],
      ["2027-06-22", "2027-07-13"],
      ["2027-06-26", "2027-07-17"]
    ]
  }
];

const FLIGHT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "es-CL,es;q=0.9"
};

const FLIGHT_CACHE_TTL_MS =
  Math.max(10, Number(process.env.FLIGHT_CHECK_INTERVAL_MINUTES || 30)) * 60 * 1000;

let cachedFlightResult = null;
let cachedAt = 0;

function parseGoogleFlightsHtml(html, { origin, destination, dep, ret, url, maxStops }) {
  const re =
    /aria-label="(A partir de (\d+) pesos chilenos \(precio total de ida y vuelta\)\. ([^"]+))"/g;
  const offers = [];
  const seen = new Set();
  let m;

  while ((m = re.exec(html))) {
    const price = Number(m[2]);
    const desc = m[3];
    if (!Number.isFinite(price) || price < 150000) continue;

    const isDirect = /Vuelo directo/i.test(desc);
    const stopsMatch = desc.match(/(\d+)\s*escala/i);
    const stops = isDirect ? 0 : stopsMatch ? Number(stopsMatch[1]) : 99;
    if (stops > maxStops) continue;

    const airlineMatch =
      desc.match(/Vuelo directo de\s+([^.]+?)\./i) ||
      desc.match(/escala(?:s)?\s+(?:de|con)\s+([^.]+?)\./i) ||
      desc.match(/con\s+([^.]+?)\./i);
    const airline = (airlineMatch?.[1] || "Aerolínea").trim();
    const durMatch = desc.match(/Duración total:\s*([^.]+)/i);
    const duration = (durMatch?.[1] || "").trim();

    const dedupKey = `${dep}|${ret}|${airline}|${stops}|${price}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    offers.push({
      origin,
      destination,
      departureDate: dep,
      returnDate: ret,
      nights: Math.round(
        (Date.parse(`${ret}T00:00:00Z`) - Date.parse(`${dep}T00:00:00Z`)) / 86400000
      ),
      price,
      airline,
      stops,
      stopsLabel: stops === 0 ? "Directo" : `${stops} escala${stops > 1 ? "s" : ""}`,
      duration,
      url
    });
  }

  offers.sort((a, b) => a.price - b.price);
  return offers;
}

async function fetchPairFromGoogleFlights(watch, dep, ret) {
  const q = `Flights to ${watch.destination} from ${watch.origin} on ${dep} through ${ret}`;
  const url = `https://www.google.com/travel/flights?q=${encodeURIComponent(
    q
  )}&curr=CLP&hl=es&gl=cl`;

  const res = await fetch(url, {
    headers: FLIGHT_HEADERS,
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error(`Google Flights HTTP ${res.status} (${dep})`);
  const html = await res.text();
  return parseGoogleFlightsHtml(html, {
    origin: watch.origin,
    destination: watch.destination,
    dep,
    ret,
    url,
    maxStops: watch.maxStops
  });
}

export async function checkFlights({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cachedFlightResult && now - cachedAt < FLIGHT_CACHE_TTL_MS) {
    return { ...cachedFlightResult, fromCache: true };
  }

  const errors = [];
  const summaries = [];
  const flightDeals = [];

  for (const watch of FLIGHT_WATCHES) {
    const allOffers = [];
    const bestPerDatePair = [];

    // Fetch sequentially with a tiny polite delay so Google Flights stays happy from Render
    for (const [dep, ret] of watch.datePairs) {
      try {
        const offers = await fetchPairFromGoogleFlights(watch, dep, ret);
        allOffers.push(...offers);
        const best = offers[0] || null;
        const bestDirect = offers.find((o) => o.stops === 0) || null;
        if (best) {
          bestPerDatePair.push({
            departureDate: dep,
            returnDate: ret,
            nights: best.nights,
            bestPrice: best.price,
            bestAirline: best.airline,
            bestStopsLabel: best.stopsLabel,
            bestDuration: best.duration,
            bestDirectPrice: bestDirect?.price || null,
            bestDirectAirline: bestDirect?.airline || null,
            url: best.url
          });
        }
      } catch (err) {
        errors.push(`Vuelos (${dep}): ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 900));
    }

    allOffers.sort((a, b) => a.price - b.price);
    bestPerDatePair.sort((a, b) => a.bestPrice - b.bestPrice);

    // Trigger deal for the cheapest qualifying offer per date pair below maxPriceClp
    const bestQualifyingByPair = new Map();
    for (const offer of allOffers) {
      if (offer.price >= watch.maxPriceClp) continue;
      const pairKey = `${offer.departureDate}|${offer.returnDate}`;
      if (!bestQualifyingByPair.has(pairKey)) {
        const savingsClp = watch.maxPriceClp - offer.price;
        const savingsPct = Number(((savingsClp / watch.maxPriceClp) * 100).toFixed(2));
        bestQualifyingByPair.set(pairKey, {
          watchId: watch.id,
          watchName: watch.name,
          ...offer,
          referencePrice: watch.maxPriceClp,
          savingsClp,
          savingsPct
        });
      }
    }

    flightDeals.push(...bestQualifyingByPair.values());

    summaries.push({
      id: watch.id,
      name: watch.name,
      origin: watch.origin,
      destination: watch.destination,
      maxPriceClp: watch.maxPriceClp,
      checkedPairs: watch.datePairs.length,
      offersFound: allOffers.length,
      bestOverall: allOffers[0] || null,
      bestDirect: allOffers.find((o) => o.stops === 0) || null,
      bestPerDatePair,
      activeDealsCount: bestQualifyingByPair.size
    });
  }

  flightDeals.sort((a, b) => a.price - b.price);

  const result = {
    checkedAt: new Date().toISOString(),
    fromCache: false,
    summaries,
    flightDeals,
    errors
  };

  // Only cache if we got real data (don't cache an empty transient failure for 30 min)
  if (summaries.some((s) => s.offersFound > 0)) {
    cachedFlightResult = result;
    cachedAt = now;
  }

  return result;
}

export function formatFlightDealText(deal) {
  return [
    `✈️ BAJA DE VUELO: ${deal.origin} ↔ ${deal.destination} (${deal.nights} días)`,
    `📅 Fechas: ${deal.departureDate} → ${deal.returnDate}`,
    `🛫 Aerolínea: ${deal.airline} (${deal.stopsLabel}${deal.duration ? `, ${deal.duration}` : ""})`,
    `💰 Precio ida y vuelta: ${formatCLP(deal.price)}`,
    `📉 Ahorro: -${formatCLP(deal.savingsClp)} (-${deal.savingsPct.toFixed(1)}%) vs umbral ${formatCLP(deal.referencePrice)}`,
    `🔗 Google Flights: ${deal.url}`
  ].join("\n");
}
