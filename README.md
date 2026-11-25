# Monitor de Bajas de Precio — Chile 📱

Monitorea en tiempo real (cada 1–2 minutos) bajas de precio de equipos **nuevos y liberados** en Chile usando SoloTodo + Knasta + verificación directa de tienda (cubriendo Falabella, Ripley, Paris, Lider, MacOnline, Mercado Libre, Tienda Movistar, Samsung Chile, ABC, Entel, etc.).

## Equipos y umbrales configurados (`src/config.mjs`)
- **iPhone 17 Pro (256 GB)**: `< $1.142.991` (medio específico) o `< $1.269.990` (todo medio de pago)
- **Samsung Galaxy Z Fold 8 (256 GB)**: `< $1.559.990` (medio específico) o `< $1.599.990` (todo medio de pago)
- **Samsung Galaxy S26 Ultra (256 GB)**: `< $1.145.547` (cualquier medio de pago)

## Uso local
```bash
npm run check          # Chequeo único en consola (sin enviar alertas)
npm run check:notify   # Chequeo único + enviar alertas a los canales configurados
npm start              # Inicia el servidor web + loop automático (cada 120s por defecto)
```

## Variables de entorno
- `CHECK_INTERVAL_SECONDS`: intervalo en segundos (default `120`, mínimo `60`)
- `ALERT_COOLDOWN_HOURS`: horas antes de repetir una misma alerta si el precio no bajó más (default `12`)
- **ntfy.sh (más fácil)**: `NTFY_TOPIC` (ej. `alertas-celus-mi-tema-secreto`)
- **Telegram**: `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`
- **Discord**: `DISCORD_WEBHOOK_URL`
- **Webhook genérico**: `WEBHOOK_URL`
- `CHECK_TOKEN`: token opcional para proteger `/check?token=...`

## Render Free Plan (24/7)
En Render Free los Web Services se duermen tras 15 min sin tráfico HTTP. Para que el monitor corra 24/7 (usando <744h de las 750h gratis/mes), crea un monitor gratuito cada 5–10 minutos en **cron-job.org** o **UptimeRobot** apuntando a `https://<tu-servicio>.onrender.com/health`.
