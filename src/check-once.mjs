import { formatCLP } from "./config.mjs";
import { formatDealText } from "./evaluator.mjs";
import { runMonitorCycle } from "./monitor.mjs";

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const shouldNotify = args.has("--notify");

const result = await runMonitorCycle({ notify: shouldNotify, forceNotify: shouldNotify });

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log(`=== Monitor de Precios Chile — Todos los Almacenamientos (${result.durationMs} ms) ===`);
console.log(`Fecha: ${new Date(result.finishedAt).toLocaleString("es-CL", { timeZone: "America/Santiago" })}`);
console.log("");

for (const s of result.summaryByPhone) {
  console.log(
    `📱 ${s.name} — ${s.listingsCount} ofertas nuevas/liberadas | Capacidades: ${s.capacitiesFound.join(", ") || "ninguna"}`
  );
  console.log(
    `   Umbral alerta: < ${formatCLP(s.thresholds.specificPaymentMax)} (medio específico) | < ${formatCLP(s.thresholds.anyPaymentMax)} (todo medio)`
  );
  console.log("   Mejores opciones por tienda y almacenamiento:");
  for (const opt of s.optionsByStoreAndCapacity.slice(0, 15)) {
    const priceDetail =
      opt.specificPrice < opt.anyPaymentPrice
        ? `${formatCLP(opt.specificPrice)} (${opt.paymentLabel}) | ${formatCLP(opt.anyPaymentPrice)} todo medio`
        : `${formatCLP(opt.specificPrice)} (Todo medio de pago)`;
    console.log(
      `     • [${opt.store}] ${opt.capacity} (${opt.color}) → ${priceDetail}\n       ${opt.url}`
    );
  }
  console.log("");
}

if (result.deals.length === 0) {
  console.log("✅ Sin bajas por debajo de los umbrales en este momento.");
} else {
  console.log(`🚨 ${result.deals.length} BAJA(S) VERIFICADA(S) POR DEBAJO DEL UMBRAL:\n`);
  for (const deal of result.deals) {
    console.log(formatDealText(deal));
    console.log("------------------------------------------------------------");
  }
}

if (shouldNotify) {
  console.log(`Notificaciones enviadas: ${result.notifiedCount} (canales: ${result.channels.join(", ") || "ninguno configurado"})`);
}

if (result.errors.length > 0) {
  console.error("\n⚠️ Advertencias/errores parciales:");
  for (const e of result.errors) console.error(` - ${e}`);
}
