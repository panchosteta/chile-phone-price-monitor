import { getSpecificPaymentLabel, isPriorityStore } from "./config.mjs";
import { fetchAllListings } from "./sources.mjs";
import { findVerifiedDeals } from "./evaluator.mjs";
import { checkFlights } from "./flights.mjs";
import {
  filterNewOrLowerDeals,
  filterNewOrLowerFlightDeals,
  notifyDeals,
  notifyFlightDeals,
  getConfiguredChannels
} from "./notifier.mjs";

function normalizeStoreGroup(store = "") {
  const s = store.toLowerCase();
  if (s.includes("falabella")) return "Falabella";
  if (s.includes("paris")) return "Paris";
  if (s.includes("lider")) return "Lider";
  if (s.includes("ripley")) return "Ripley";
  if (s.includes("maconline")) return "MacOnline";
  if (s.includes("mercado libre")) return "Mercado Libre";
  if (s.includes("movistar")) return "Movistar";
  if (s.includes("samsung")) return "Samsung Chile";
  if (s.includes("abc")) return "ABC / AbcDin";
  if (s.includes("entel")) return "Entel";
  return store;
}

/**
 * Picks the cheapest listing per (storeGroup, capacity) so users can compare
 * different stores and storage sizes cleanly without duplicate colors flooding the view.
 */
function buildStoreCapacityOptions(listings) {
  const bestByBucket = new Map();
  for (const item of listings) {
    const storeGroup = normalizeStoreGroup(item.store);
    const key = `${storeGroup}|${item.capacity}`;
    const existing = bestByBucket.get(key);
    if (
      !existing ||
      item.specificPrice < existing.specificPrice ||
      (item.specificPrice === existing.specificPrice && item.isDirect && !existing.isDirect)
    ) {
      bestByBucket.set(key, {
        store: item.store,
        storeGroup,
        isPriority: isPriorityStore(item.store),
        isDirect: Boolean(item.isDirect),
        capacity: item.capacity,
        color: item.color,
        specificPrice: item.specificPrice,
        anyPaymentPrice: item.anyPaymentPrice,
        paymentLabel:
          item.specificPrice < item.anyPaymentPrice
            ? getSpecificPaymentLabel(item.store)
            : "Todo medio de pago",
        source: item.source,
        url: item.url
      });
    }
  }
  return [...bestByBucket.values()].sort((a, b) => a.specificPrice - b.specificPrice);
}

export async function runMonitorCycle({ notify = true, forceNotify = false, forceFlights = false } = {}) {
  const startedAt = new Date();
  const [{ perPhone, errors: fetchErrors }, flightRes] = await Promise.all([
    fetchAllListings(),
    checkFlights({ forceRefresh: forceFlights })
  ]);
  const deals = await findVerifiedDeals(perPhone);
  const flightDeals = flightRes.flightDeals || [];

  let notificationResult = { sent: 0, channels: getConfiguredChannels(), errors: [] };
  let flightNotifyResult = { sent: 0, channels: getConfiguredChannels(), errors: [] };

  const dealsToNotify = notify ? filterNewOrLowerDeals(deals, { force: forceNotify }) : [];
  const flightsToNotify = notify ? filterNewOrLowerFlightDeals(flightDeals, { force: forceNotify }) : [];

  if (notify && dealsToNotify.length > 0) {
    notificationResult = await notifyDeals(dealsToNotify);
  }
  if (notify && flightsToNotify.length > 0) {
    flightNotifyResult = await notifyFlightDeals(flightsToNotify);
  }

  const summaryByPhone = perPhone.map(({ phone, listings }) => {
    const bestSpecific = listings[0] || null;
    const bestAny =
      [...listings].sort((a, b) => a.anyPaymentPrice - b.anyPaymentPrice)[0] || null;
    const phoneDeals = deals.filter((d) => d.phoneId === phone.id);
    const capacitiesFound = [...new Set(listings.map((l) => l.capacity))].sort();
    const optionsByStoreAndCapacity = buildStoreCapacityOptions(listings);

    return {
      id: phone.id,
      name: phone.name,
      thresholds: phone.thresholds,
      listingsCount: listings.length,
      capacitiesFound,
      bestSpecific: bestSpecific
        ? {
            store: bestSpecific.store,
            capacity: bestSpecific.capacity,
            price: bestSpecific.specificPrice,
            anyPaymentPrice: bestSpecific.anyPaymentPrice,
            color: bestSpecific.color,
            source: bestSpecific.source,
            url: bestSpecific.url
          }
        : null,
      bestAny: bestAny
        ? {
            store: bestAny.store,
            capacity: bestAny.capacity,
            price: bestAny.anyPaymentPrice,
            color: bestAny.color,
            source: bestAny.source,
            url: bestAny.url
          }
        : null,
      optionsByStoreAndCapacity,
      activeDealsCount: phoneDeals.length
    };
  });

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    summaryByPhone,
    deals,
    flights: {
      checkedAt: flightRes.checkedAt,
      fromCache: flightRes.fromCache,
      summaries: flightRes.summaries,
      deals: flightDeals
    },
    notifiedCount: notificationResult.sent + flightNotifyResult.sent,
    channels: notificationResult.channels,
    errors: [
      ...fetchErrors,
      ...(flightRes.errors || []),
      ...notificationResult.errors,
      ...flightNotifyResult.errors
    ]
  };
}
