import http from "node:http";
import { formatCLP } from "./config.mjs";
import { runMonitorCycle } from "./monitor.mjs";
import { getConfiguredChannels, sendTestNotification } from "./notifier.mjs";

const PORT = Number(process.env.PORT || 3000);
const CHECK_INTERVAL_SECONDS = Math.max(60, Number(process.env.CHECK_INTERVAL_SECONDS || 120));
const CHECK_TOKEN = process.env.CHECK_TOKEN || "";

let lastResult = null;
let isRunning = false;
let runCount = 0;

async function executeCycle(trigger = "interval", { forceNotify = false } = {}) {
  if (isRunning) {
    return { skipped: true, reason: "check_already_in_progress", lastResult };
  }
  isRunning = true;
  try {
    const res = await runMonitorCycle({ notify: true, forceNotify });
    runCount += 1;
    lastResult = { ...res, trigger, runCount };
    console.log(
      `[${res.finishedAt}] Check #${runCount} (${trigger}) done in ${res.durationMs}ms | deals=${res.deals.length} | notified=${res.notifiedCount} | errors=${res.errors.length}`
    );
    return lastResult;
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Monitor error:`, err);
    return { error: err.message };
  } finally {
    isRunning = false;
  }
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtmlStatus() {
  const channels = getConfiguredChannels();
  const updated = lastResult
    ? new Date(lastResult.finishedAt).toLocaleString("es-CL", { timeZone: "America/Santiago" })
    : "Ejecutando primer chequeo...";

  const sections = (lastResult?.summaryByPhone || [])
    .map((s) => {
      const rows = (s.optionsByStoreAndCapacity || [])
        .slice(0, 12)
        .map(
          (o) => `
          <tr>
            <td><strong>${escapeHtml(o.store)}</strong></td>
            <td>${escapeHtml(o.capacity)}</td>
            <td>${escapeHtml(o.color)}</td>
            <td><strong>${formatCLP(o.specificPrice)}</strong><br><small>${escapeHtml(o.paymentLabel)}</small></td>
            <td>${formatCLP(o.anyPaymentPrice)}</td>
            <td><a href="${escapeHtml(o.url)}" target="_blank" rel="noreferrer">Ir a tienda</a></td>
          </tr>`
        )
        .join("");

      return `
        <h3>📱 ${escapeHtml(s.name)} <small>(${s.listingsCount} ofertas · capacidades: ${escapeHtml(
        s.capacitiesFound.join(", ")
      )})</small></h3>
        <p><small>Umbral alerta: &lt; ${formatCLP(s.thresholds.specificPaymentMax)} (medio específico) / &lt; ${formatCLP(
        s.thresholds.anyPaymentMax
      )} (todo medio)</small></p>
        <table>
          <thead><tr><th>Tienda</th><th>Capacidad</th><th>Color</th><th>Mejor precio</th><th>Todo medio</th><th>Link</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='6'>Sin resultados</td></tr>"}</tbody>
        </table>`;
    })
    .join("");

  const dealCards = (lastResult?.deals || [])
    .map(
      (d) => `
      <div style="border:1px solid #10b981;border-radius:8px;padding:12px;margin-bottom:10px;background:#ecfdf5">
        <strong>${escapeHtml(d.phoneName)} (${escapeHtml(d.capacity)})</strong> — <strong style="color:#047857">${formatCLP(d.dealPrice)}</strong>
        (ahorro -${formatCLP(d.savingsClp)} / -${d.savingsPct.toFixed(1)}%)<br>
        Tienda: <strong>${escapeHtml(d.store)}</strong> | Pago: ${escapeHtml(d.paymentMethod)} | Color: ${escapeHtml(d.color)}<br>
        Stock: ${escapeHtml(d.stockNote)} | <a href="${escapeHtml(d.url)}" target="_blank" rel="noreferrer">Ver publicación</a>
      </div>`
    )
    .join("");

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Monitor de Precios Chile</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 1080px; margin: 24px auto; padding: 0 16px; color: #111827; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0 28px; font-size: 14px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; }
  </style>
</head>
<body>
  <h1>📱 Monitor de Bajas de Precio — Chile (Todos los Almacenamientos)</h1>
  <p>
    <strong>Último chequeo:</strong> ${escapeHtml(updated)} (chequeo #${runCount})<br>
    <strong>Intervalo:</strong> cada ${CHECK_INTERVAL_SECONDS}s |
    <strong>Canales de alerta:</strong> ${channels.length ? escapeHtml(channels.join(", ")) : "ninguno configurado"}
  </p>
  <h2>🚨 Alertas activas bajo umbral</h2>
  ${dealCards || "<p>No hay bajas confirmadas bajo umbral en el último chequeo.</p>"}
  <h2>📊 Comparativa por tienda y almacenamiento</h2>
  ${sections || "<p>Cargando...</p>"}
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        isRunning,
        runCount,
        intervalSeconds: CHECK_INTERVAL_SECONDS,
        lastCheckedAt: lastResult?.finishedAt || null
      })
    );
    return;
  }

  if (url.pathname === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(lastResult || { status: "initializing" }, null, 2));
    return;
  }

  if (url.pathname === "/check") {
    if (CHECK_TOKEN && url.searchParams.get("token") !== CHECK_TOKEN) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const force = url.searchParams.get("force") === "1";
    const result = await executeCycle("http", { forceNotify: force });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result, null, 2));
    return;
  }

  if (url.pathname === "/test-notify") {
    if (CHECK_TOKEN && url.searchParams.get("token") !== CHECK_TOKEN) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const publicBase = process.env.RENDER_EXTERNAL_URL || `https://${req.headers.host || ""}`;
    const result = await sendTestNotification(publicBase);
    res.writeHead(result.ok ? 200 : 500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result, null, 2));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderHtmlStatus());
});

server.listen(PORT, () => {
  console.log(
    `Chile Phone Price Monitor listening on port ${PORT} (interval=${CHECK_INTERVAL_SECONDS}s, channels=${
      getConfiguredChannels().join(",") || "none"
    })`
  );
  executeCycle("startup");
  setInterval(() => executeCycle("interval"), CHECK_INTERVAL_SECONDS * 1000);
});
