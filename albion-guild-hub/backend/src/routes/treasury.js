// Модуль "Скарбниця Гільдії" — облік приходу/витрат срібла (регіри, донати,
// утримання острова, продажі і т.д.). Доступ: accountant + admin (write),
// читання зведення доступне moderator/roster для прозорості.
const express = require('express');
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');

const router = express.Router();
router.use(requireAuth);

router.get('/ledger', requirePermission('read:treasury'), async (req, res) => {
  const { category, limit } = req.query;
  const { rows } = await query(
    category
      ? 'SELECT * FROM guild_treasury_ledger WHERE category = $1 ORDER BY created_at DESC LIMIT $2'
      : 'SELECT * FROM guild_treasury_ledger ORDER BY created_at DESC LIMIT $1',
    category ? [category, Number(limit) || 200] : [Number(limit) || 200]
  );
  res.json(rows);
});

router.post('/ledger', requirePermission('write:treasury'), async (req, res) => {
  const { entryType, category, amountSilver, description, relatedUserId } = req.body || {};
  if (!entryType || !category || amountSilver === undefined) {
    return res.status(400).json({ error: 'entryType, category, amountSilver обов\'язкові.' });
  }
  const { rows } = await query(
    `INSERT INTO guild_treasury_ledger (entry_type, category, amount_silver, description, related_user_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [entryType, category, amountSilver, description || null, relatedUserId || null, req.user.id]
  );
  res.status(201).json(rows[0]);
});

router.delete('/ledger/:id', requirePermission('write:treasury'), async (req, res) => {
  await query('DELETE FROM guild_treasury_ledger WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// GET /api/treasury/summary — баланс + розбивка по категоріях (для дашборду)
router.get('/summary', requirePermission('read:treasury'), async (_req, res) => {
  const { rows: totals } = await query(`
    SELECT
      COALESCE(SUM(amount_silver) FILTER (WHERE entry_type = 'income'), 0) AS total_income,
      COALESCE(SUM(amount_silver) FILTER (WHERE entry_type = 'expense'), 0) AS total_expense
    FROM guild_treasury_ledger
  `);
  const { rows: byCategory } = await query(`
    SELECT category, entry_type, SUM(amount_silver) AS total
    FROM guild_treasury_ledger
    GROUP BY category, entry_type
    ORDER BY total DESC
  `);
  const income = Number(totals[0].total_income);
  const expense = Number(totals[0].total_expense);
  res.json({
    totalIncome: income,
    totalExpense: expense,
    balance: income - expense,
    byCategory,
  });
});

module.exports = router;
