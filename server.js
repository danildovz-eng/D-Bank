// D-Bank Private — сервер платежей Telegram Stars (Node 18+)
// npm i express firebase-admin
// ENV: BOT_TOKEN, WEBHOOK_SECRET, FIREBASE_DB_URL, SERVICE_ACCOUNT_JSON, WEBAPP_URL (необязательно), PORT
// Webhook: https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<host>/webhook/<WEBHOOK_SECRET>
const express = require('express');
const crypto = require('crypto');
const admin = require('firebase-admin');

const { BOT_TOKEN, WEBHOOK_SECRET, FIREBASE_DB_URL, SERVICE_ACCOUNT_JSON, WEBAPP_URL, PORT = 3000 } = process.env;
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SERVICE_ACCOUNT_JSON)), databaseURL: FIREBASE_DB_URL });
const db = admin.database();

// Цены только здесь — клиенту доверять нельзя. Должны совпадать с PRODUCTS в index.html
const CATALOG = {
  unlock_mining:  { title: 'ASIC-ферма',        stars: 35 },
  unlock_darknet: { title: 'Теневой рынок',     stars: 35 },
  boost_click:    { title: 'x2 клики на 24 ч',  stars: 25 },
  vip_week:       { title: 'VIP на 7 дней',     stars: 80 },
  'skin-gold':    { title: 'Скин Elite Gold',   stars: 30 },
  'skin-neon':    { title: 'Скин Cyber Neon',   stars: 60 },
  'skin-cyber':   { title: 'Скин Platinum VIP', stars: 100 }
};

const tgApi = (method, body) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(r => r.json());

// Проверка подписи Telegram initData (HMAC), срок жизни 24 ч
function verifyInitData(initData) {
  if (!initData) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash'); p.delete('hash');
  const str = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(str).digest('hex');
  if (!hash || calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.set({ 'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*', 'Access-Control-Allow-Headers': 'Content-Type' });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Создание счёта в Stars (валюта XTR, provider_token пустой)
app.post('/api/invoice', async (req, res) => {
  const user = verifyInitData(req.body.initData);
  const item = CATALOG[req.body.product];
  if (!user || !item) return res.status(400).json({ error: 'bad request' });
  const nonce = crypto.randomBytes(6).toString('hex');
  const r = await tgApi('createInvoiceLink', {
    title: item.title, description: item.title, payload: `${user.id}:${req.body.product}:${nonce}`,
    provider_token: '', currency: 'XTR', prices: [{ label: item.title, amount: item.stars }]
  });
  if (!r.ok) return res.status(500).json({ error: r.description });
  res.json({ link: r.result });
});

// Вебхук бота: подтверждение платежа и запись покупки
app.post('/webhook/' + WEBHOOK_SECRET, async (req, res) => {
  res.sendStatus(200);
  const u = req.body;
  try {
    if (u.pre_checkout_query) {
      const q = u.pre_checkout_query, [uid, pid] = q.invoice_payload.split(':'), item = CATALOG[pid];
      const ok = item && String(q.from.id) === uid && q.total_amount === item.stars && q.currency === 'XTR';
      return tgApi('answerPreCheckoutQuery', { pre_checkout_query_id: q.id, ok: !!ok, error_message: ok ? undefined : 'Ошибка заказа' });
    }
    const sp = u.message && u.message.successful_payment;
    if (sp) {
      const [uid, pid, nonce] = sp.invoice_payload.split(':'), item = CATALOG[pid];
      if (!item || String(u.message.from.id) !== uid || sp.total_amount !== item.stars) return;
      // идемпотентно: повторный вебхук не создаст вторую покупку
      await db.ref(`purchases/tg_${uid}/${nonce}`).transaction(cur => cur || {
        product: pid, stars: item.stars, status: 'paid', applied: false, chargeId: sp.telegram_payment_charge_id, ts: Date.now()
      });
    }
    if (u.message && u.message.text && u.message.text.startsWith('/start') && WEBAPP_URL) {
      await tgApi('sendMessage', { chat_id: u.message.chat.id, text: '🏦 D-Bank Private',
        reply_markup: { inline_keyboard: [[{ text: 'Открыть банк', web_app: { url: WEBAPP_URL } }]] } });
    }
  } catch (e) { console.error(e); }
});

app.listen(PORT, () => console.log('D-Bank server on', PORT));
