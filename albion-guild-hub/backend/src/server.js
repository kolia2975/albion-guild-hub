require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');

const { pool, query } = require('./db/pool');
const { startNotificationScheduler } = require('./services/notificationScheduler');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const laborersRoutes = require('./routes/laborers');
const refiningRoutes = require('./routes/refiningCrafting');
const arbitrageRoutes = require('./routes/tradingTransporting');
const focusRoutes = require('./routes/focusManagement');
const buildsRoutes = require('./routes/guildBuilds');
const guildIslandsRoutes = require('./routes/guildIslands');
const treasuryRoutes = require('./routes/treasury');
const notificationsRoutes = require('./routes/notifications');
const botRoutes = require('./routes/botRoutes');

const app = express();

app.use(helmet({ contentSecurityPolicy: false })); // CSP вимкнено, щоб не блокувати наш власний inline JS у простих HTML-сторінках
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

// --- API роути ---
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/laborers', laborersRoutes);
app.use('/api/refining', refiningRoutes);
app.use('/api/arbitrage', arbitrageRoutes);
app.use('/api/focus', focusRoutes);
app.use('/api/builds', buildsRoutes);
app.use('/api/guild-islands', guildIslandsRoutes);
app.use('/api/treasury', treasuryRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/bot', botRoutes);

app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, db: 'connected', time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// --- Фронтенд (статичні файли з ./public, у docker-compose примонтовано з ../frontend) ---
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// JSON 404 для невідомих /api/* маршрутів
app.use('/api', (_req, res) => res.status(404).json({ error: 'Такого API-маршруту не існує.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server] Необроблена помилка:', err);
  res.status(500).json({ error: 'Внутрішня помилка сервера.' });
});

// -----------------------------------------------------------------------
// Очікуємо, поки PostgreSQL підніметься (в docker-compose є healthcheck,
// але додаткова страховка на випадок ручного запуску не зашкодить).
// -----------------------------------------------------------------------
async function waitForDb(retries = 20, delayMs = 1500) {
  for (let i = 0; i < retries; i += 1) {
    try {
      await pool.query('SELECT 1');
      console.log('[server] З\'єднання з PostgreSQL встановлено.');
      return;
    } catch (err) {
      console.log(`[server] База ще не готова (спроба ${i + 1}/${retries})...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('Не вдалося з\'єднатися з PostgreSQL після кількох спроб.');
}

// Створює адміна з .env, якщо таблиця users ще порожня (перший запуск).
async function bootstrapAdmin() {
  const { rows } = await query('SELECT COUNT(*)::int AS count FROM users');
  if (rows[0].count > 0) return;

  const login = process.env.ADMIN_BOOTSTRAP_LOGIN || 'admin';
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'admin12345';
  const hash = await bcrypt.hash(password, 12);

  await query(
    `INSERT INTO users (username, password_hash, display_name, role)
     VALUES ($1, $2, 'Адміністратор', 'admin')`,
    [login, hash]
  );
  console.log('=========================================================');
  console.log(` Створено першого адміністратора: ${login}`);
  console.log(' Пароль — той, що вказаний у ADMIN_BOOTSTRAP_PASSWORD (.env)');
  console.log(' ОБОВ\'ЯЗКОВО зміни пароль після першого входу!');
  console.log('=========================================================');
}

async function start() {
  await waitForDb();
  await bootstrapAdmin();
  startNotificationScheduler();

  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    console.log(`[server] Albion Guild Hub API + фронтенд слухає на порту ${port}`);
  });
}

start().catch((err) => {
  console.error('[server] Критична помилка старту:', err);
  process.exit(1);
});
