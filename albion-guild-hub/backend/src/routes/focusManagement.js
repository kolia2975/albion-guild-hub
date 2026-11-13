// Модуль "Ефективність Фокусу" — скільки чистого срібла дає 1 одиниця фокусу
// для різних активностей, щоб обрати найвигіднішу.
const express = require('express');
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');

const router = express.Router();
router.use(requireAuth);

function calcFocus({ focusCost, silverOutput }) {
  const silverPerFocus = focusCost > 0 ? silverOutput / focusCost : 0;
  return { silverPerFocus: Number(silverPerFocus.toFixed(2)) };
}

router.post('/calculate', (req, res) => {
  const b = req.body || {};
  if (!b.focusCost || b.silverOutput === undefined) {
    return res.status(400).json({ error: 'focusCost і silverOutput обов\'язкові.' });
  }
  res.json(calcFocus(b));
});

router.post('/save', requirePermission('write:focus'), async (req, res) => {
  const b = req.body || {};
  const result = calcFocus(b);
  const { rows } = await query(
    `INSERT INTO focus_calculations (user_id, activity_name, focus_cost, silver_output, silver_per_focus)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.id, b.activityName || 'Активність', b.focusCost, b.silverOutput, result.silverPerFocus]
  );
  res.status(201).json(rows[0]);
});

router.get('/history', async (req, res) => {
  const isPrivileged = ['admin', 'accountant', 'moderator'].includes(req.user.role);
  const { rows } = await query(
    isPrivileged
      ? 'SELECT * FROM focus_calculations ORDER BY created_at DESC LIMIT 200'
      : 'SELECT * FROM focus_calculations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200',
    isPrivileged ? [] : [req.user.id]
  );
  res.json(rows);
});

// GET /api/focus/leaderboard — топ активностей за силою (Silver/Focus), для дашборду
router.get('/leaderboard', async (req, res) => {
  const { rows } = await query(
    `SELECT activity_name, ROUND(AVG(silver_per_focus), 2) AS avg_silver_per_focus, COUNT(*) AS samples
     FROM focus_calculations
     WHERE user_id = $1
     GROUP BY activity_name
     ORDER BY avg_silver_per_focus DESC
     LIMIT 10`,
    [req.user.id]
  );
  res.json(rows);
});

module.exports = router;
