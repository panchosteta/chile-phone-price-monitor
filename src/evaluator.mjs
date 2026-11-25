import { getSpecificPaymentLabel, formatCLP } from "./config.mjs";
import { verifyCandidateListing } from "./sources.mjs";

/**
 * Evaluates a single listing against the phone's reference price thresholds.
 * Returns null if the listing is NOT below threshold.
 */
export function evaluateListing(phone, listing) {
  const { specificPaymentMax, anyPaymentMax } = phone.thresholds;
  const requiresSpecificCard = listing.specificPrice < listing.anyPaymentPrice;

  const qualifiesAnyPayment = listing.anyPaymentPrice < anyPaymentMax;
  const qualifiesSpecificPayment =
    requiresSpecificCard && listing.specificPrice < specificPaymentMax;

  if (!qualifiesAnyPayment && !qualifiesSpecificPayment) {
    return null;
  }

  // Pick best qualifying offer (prefer lowest price; note both if both qualify)
  let matchedMode;
  let dealPrice;
  let referencePrice;
  let paymentMethod;

  if (qualifiesSpecificPayment && (!qualifiesAnyPayment || listing.specificPrice < listing.anyPaymentPrice)) {
    matchedMode = "specific";
    dealPrice = listing.specificPrice;
    referencePrice = specificPaymentMax;
    paymentMethod = getSpecificPaymentLabel(listing.store);
  } else {
    matchedMode = "any";
    dealPrice = listing.anyPaymentPrice;
    referencePrice = anyPaymentMax;
    paymentMethod = "Todo medio de pago";
  }

  const savingsClp = referencePrice - dealPrice;
  const savingsPct = Number(((savingsClp / referencePrice) * 100).toFixed(2));

  return {
    ...listing,
    matchedMode,
    dealPrice,
    referencePrice,
    savingsClp,
    savingsPct,
    paymentMethod,
    alsoQualifiesAnyPayment: qualifiesAnyPayment,
    anyPaymentSavingsClp: qualifiesAnyPayment ? anyPaymentMax - listing.anyPaymentPrice : 0
  };
}

export async function findVerifiedDeals(perPhoneResults) {
  const verifiedDeals = [];

  for (const { phone, listings } of perPhoneResults) {
    const candidates = listings.filter((l) => evaluateListing(phone, l) !== null);
    if (candidates.length === 0) continue;

    const checked = await Promise.all(
      candidates.map((cand) => verifyCandidateListing(cand))
    );

    for (const item of checked) {
      if (!item.stockConfirmed) continue;
      const evaluated = evaluateListing(phone, item);
      if (evaluated) verifiedDeals.push(evaluated);
    }
  }

  verifiedDeals.sort((a, b) => b.savingsPct - a.savingsPct);
  return verifiedDeals;
}

export function formatDealText(deal) {
  const lines = [
    `🚨 BAJA DE PRECIO: ${deal.phoneName}`,
    `🏪 Tienda: ${deal.store} (vía ${deal.source})`,
    `📱 Modelo/Color: ${deal.capacity} / ${deal.color}`,
    `💰 Precio actual: ${formatCLP(deal.dealPrice)}`,
    `💳 Medio de pago: ${deal.paymentMethod}`
  ];

  if (deal.matchedMode === "specific" && deal.anyPaymentPrice !== deal.dealPrice) {
    lines.push(`   ↳ Todo medio de pago: ${formatCLP(deal.anyPaymentPrice)}`);
  }

  lines.push(
    `📉 Ahorro: -${formatCLP(deal.savingsClp)} (-${deal.savingsPct.toFixed(1)}%) vs ref. ${formatCLP(deal.referencePrice)}`,
    `📦 Stock: ${deal.stockNote}`,
    `🔗 Link directo: ${deal.url}`
  );

  return lines.join("\n");
}
