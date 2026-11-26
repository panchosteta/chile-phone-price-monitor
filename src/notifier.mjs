import { formatCLP } from "./config.mjs";
import { formatDealText } from "./evaluator.mjs";
import { formatFlightDealText } from "./flights.mjs";

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
  const summaryText = `✅ Monitor de Precios Chile activo.\nMonitoreando: Xiaomi 17 Ultra, AMD Radeon RX 9060 XT (16 GB y 8 GB) y vuelos SCL ↔ MAD junio 2027 (3 semanas, < $700.000).${
    serviceUrl ? `\nDashboard: ${serviceUrl}` : ""
  }`;

  if (process.env.NTFY_TOPIC) {
    try {
      await sendNtfyRaw({
        title: "Prueba Monitor Precios Chile",
        body: summaryText,
        priority: "default",
        tags: "white_check_mark,iphone",
        clickUrl: serviceUrl
      });
    } catch (e) {
      errors.push(`ntfy: ${e.message}`);
    }
  }

  if (process.env.DISCORD_WEBHOOK_URL) {
    try {
      const res = await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "🔔 **Prueba de conexión — Monitor de Precios Chile**",
          embeds: [
            {
              title: "Monitor activo 24/7 en Render",
              url: serviceUrl || undefined,
              description: summaryText,
              color: 0x3b82f6,
              timestamp: new Date().toISOString()
            }
          ]
        }),
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) throw new Error(`Discord HTTP ${res.status}: ${await res.text()}`);
    } catch (e) {
      errors.push(`discord: ${e.message}`);
    }
  }

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: summaryText }),
          signal: AbortSignal.timeout(10000)
        }
      );
      if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`);
    } catch (e) {
      errors.push(`telegram: ${e.message}`);
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

function flightDealKey(deal) {
  return `flight|${deal.watchId}|${deal.departureDate}|${deal.returnDate}|${deal.airline.toLowerCase()}|${deal.stops}`;
}

export function filterNewOrLowerFlightDeals(deals, { force = false } = {}) {
  const now = Date.now();
  const toAlert = [];
  for (const deal of deals) {
    const key = flightDealKey(deal);
    const prev = alertHistory.get(key);
    const shouldAlert =
      force ||
      !prev ||
      deal.price < prev.lastPrice ||
      now - prev.lastAlertedAt >= COOLDOWN_MS;
    if (shouldAlert) toAlert.push(deal);
  }
  return toAlert;
}

async function sendDiscordFlight(deal) {
  const res = await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `✈️ **Baja de pasaje detectada: ${deal.origin} ↔ ${deal.destination} (${formatCLP(deal.price)})**`,
      embeds: [
        {
          title: `${deal.origin} ↔ ${deal.destination} — ${formatCLP(deal.price)} ida y vuelta`,
          url: deal.url,
          color: 0x0ea5e9,
          fields: [
            { name: "Fechas (3 semanas)", value: `${deal.departureDate} → ${deal.returnDate} (${deal.nights}d)`, inline: true },
            { name: "Aerolínea", value: `${deal.airline} (${deal.stopsLabel})`, inline: true },
            { name: "Duración", value: deal.duration || "Ver en Google Flights", inline: true },
            { name: "Precio ida y vuelta", value: formatCLP(deal.price), inline: true },
            { name: "Umbral", value: formatCLP(deal.referencePrice), inline: true },
            { name: "Ahorro", value: `-${formatCLP(deal.savingsClp)} (-${deal.savingsPct.toFixed(1)}%)`, inline: true }
          ],
          footer: { text: "Fuente: Google Flights (CLP)" },
          timestamp: new Date().toISOString()
        }
      ]
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`Discord Flight HTTP ${res.status}: ${await res.text()}`);
}

export async function notifyFlightDeals(deals) {
  const channels = getConfiguredChannels();
  if (deals.length === 0 || channels.length === 0) {
    return { sent: 0, channels, errors: [] };
  }

  const errors = [];
  let sent = 0;

  for (const deal of deals) {
    const tasks = [];
    if (process.env.NTFY_TOPIC) {
      tasks.push([
        "ntfy",
        sendNtfyRaw({
          title: `Vuelo ${deal.origin}-${deal.destination} ${formatCLP(deal.price)} (${deal.airline})`,
          body: formatFlightDealText(deal),
          tags: "airplane,moneybag",
          clickUrl: deal.url
        })
      ]);
    }
    if (process.env.DISCORD_WEBHOOK_URL) {
      tasks.push(["discord", sendDiscordFlight(deal)]);
    }
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      tasks.push([
        "telegram",
        fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: formatFlightDealText(deal)
          }),
          signal: AbortSignal.timeout(10000)
        }).then(async (r) => {
          if (!r.ok) throw new Error(`Telegram HTTP ${r.status}: ${await r.text()}`);
        })
      ]);
    }

    const results = await Promise.allSettled(tasks.map(([, p]) => p));
    let anySuccess = false;
    results.forEach((r, idx) => {
      if (r.status === "fulfilled") anySuccess = true;
      else errors.push(`${tasks[idx][0]}: ${r.reason?.message || r.reason}`);
    });

    if (anySuccess) {
      sent += 1;
      alertHistory.set(flightDealKey(deal), { lastPrice: deal.price, lastAlertedAt: Date.now() });
    }
    if (deals.length > 1) await new Promise((r) => setTimeout(r, 400));
  }

  return { sent, channels, errors };
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
    if (deals.length > 1) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return { sent, channels, errors };
}
