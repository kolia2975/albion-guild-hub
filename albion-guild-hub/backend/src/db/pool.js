// Єдиний пул з'єднань з PostgreSQL, який використовують усі роути.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('[db] Неочікувана помилка пулу PostgreSQL:', err);
});

// Невеличкий хелпер для логування повільних запитів під час розробки.
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 300) {
    console.warn(`[db] Повільний запит (${duration}ms): ${text.slice(0, 120)}`);
  }
  return res;
}

module.exports = { pool, query };
