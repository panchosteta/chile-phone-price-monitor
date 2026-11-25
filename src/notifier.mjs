import { formatCLP } from "./config.mjs";
import { formatDealText } from "./evaluator.mjs";

const COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_HOURS || 12) * 60 * 60 * 1000;

// In-memory deduplication: key -> { lastPrice, lastAlertedAt }
const alertHistory = new Map();

function dealKey(deal) {
  return `${deal.phoneId}|${deal.store.toLowerCase()}|${deal.url.toLowerCase()}|${deal.matchedMode}`;
}

export function filterNewOrLowerDeals(deals, { force = false } = {}) {
  const now = Date.now();
  const toAlert = [];

  for (const deal of deals) {
    const key = dealKey(deal);
    const prev = alertHistory.get(key);
    const shouldAlert =
      force ||
      !prev ||
      deal.dealPrice < prev.lastPrice ||
      now - prev.lastAlertedAt >= COOLDOWN_MS;

    if (shouldAlert) {
      toAlert.push(deal);
    }
  }

  return toAlert;
}

export function markDealsAlerted(deals) {
  const now = Date.now();
  for (const deal of deals) {
    alertHistory.set(dealKey(deal), {
      lastPrice: deal.dealPrice,
      lastAlertedAt: now
    });
  }
}

export function getConfiguredChannels() {
  const channels = [];
  if (process.env.NTFY_TOPIC) channels.push("ntfy");
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) channels.push("telegram");
  if (process.env.DISCORD_WEBHOOK_URL) channels.push("discord");
  if (process.env.WEBHOOK_URL) channels.push("webhook");
  return channels;
}

function toAsciiHeader(str = "") {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

async function sendNtfyRaw({ title, body, priority = "high", tags = "rotating_light,iphone,moneybag", clickUrl = "" }) {
  const server = (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/+$/, "");
  const topic = process.env.NTFY_TOPIC;
  const headers = {
    Title: toAsciiHeader(title),
    Priority: priority,
    Tags: tags,
    "Content-Type": "text/plain; charset=utf-8"
  };
  if (clickUrl) {
    headers.Click = clickUrl;
    headers.Actions = `view, Abrir tienda, ${clickUrl}`;
  }
  if (process.env.NTFY_TOKEN) {
    headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
  }
  const res = await fetch(`${server}/${encodeURIComponent(topic)}`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}: ${await res.text()}`);
}

async function sendNtfy(deal) {
  await sendNtfyRaw({
    title: `Baja ${deal.phoneName} (${deal.capacity}) - ${formatCLP(deal.dealPrice)} en ${deal.store}`,
    body: formatDealText(deal),
    clickUrl: deal.url
  });
}

export async function sendTestNotification(serviceUrl = "") {
  const channels = getConfiguredChannels();
  if (channels.length === 0) {
    return { ok: false, channels, error: "No hay canales configurados" };
  }
  const errors = [];
  if (process.env.NTFY_TOPIC) {
    try {
      await sendNtfyRaw({
        title: "Prueba Monitor Precios Chile",
        body: `✅ Monitor de Precios Chile activo y conectado a ntfy.sh.\nProductos: iPhone 17 Pro, Galaxy Z Fold 8, Galaxy S26 Ultra, Xiaomi 17 Ultra y AMD Radeon RX 9060 XT 16 GB (nuevos).${
          serviceUrl ? `\nDashboard: ${serviceUrl}` : ""
        }`,
        priority: "default",
        tags: "white_check_mark,iphone",
        clickUrl: serviceUrl
      });
    } catch (e) {
      errors.push(`ntfy: ${e.message}`);
    }
  }
  return { ok: errors.length === 0, channels, errors };
}

async function sendTelegram(deal) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: formatDealText(deal),
      disable_web_page_preview: false
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`);
}

async function sendDiscord(deal) {
  const res = await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `🚨 **Baja de precio detectada: ${deal.phoneName}**`,
      embeds: [
        {
          title: `${deal.phoneName} — ${formatCLP(deal.dealPrice)} en ${deal.store}`,
          url: deal.url,
          color: 0x10b981,
          fields: [
            { name: "Precio actual", value: formatCLP(deal.dealPrice), inline: true },
            { name: "Referencia", value: formatCLP(deal.referencePrice), inline: true },
            {
              name: "Ahorro",
              value: `-${formatCLP(deal.savingsClp)} (-${deal.savingsPct.toFixed(1)}%)`,
              inline: true
            },
            { name: "Medio de pago", value: deal.paymentMethod, inline: true },
            { name: "Capacidad / Color", value: `${deal.capacity} / ${deal.color}`, inline: true },
            { name: "Stock", value: deal.stockNote, inline: true }
          ],
          footer: { text: `Fuente: ${deal.source}` },
          timestamp: new Date().toISOString()
        }
      ]
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`Discord HTTP ${res.status}: ${await res.text()}`);
}

async function sendGenericWebhook(deal) {
  const res = await fetch(process.env.WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: formatDealText(deal), deal }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`Webhook HTTP ${res.status}: ${await res.text()}`);
}

export async function notifyDeals(deals) {
  const channels = getConfiguredChannels();
  if (deals.length === 0 || channels.length === 0) {
    return { sent: 0, channels, errors: [] };
  }

  const errors = [];
  let sent = 0;

  for (const deal of deals) {
    const tasks = [];
    if (process.env.NTFY_TOPIC) tasks.push(["ntfy", sendNtfy(deal)]);
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
      tasks.push(["telegram", sendTelegram(deal)]);
    if (process.env.DISCORD_WEBHOOK_URL) tasks.push(["discord", sendDiscord(deal)]);
    if (process.env.WEBHOOK_URL) tasks.push(["webhook", sendGenericWebhook(deal)]);

    const results = await Promise.allSettled(tasks.map(([, p]) => p));
    let anySuccess = false;
    results.forEach((r, idx) => {
      if (r.status === "fulfilled") {
        anySuccess = true;
      } else {
        errors.push(`${tasks[idx][0]}: ${r.reason?.message || r.reason}`);
      }
    });

    if (anySuccess) {
      sent += 1;
      markDealsAlerted([deal]);
    }
  }

  return { sent, channels, errors };
}
