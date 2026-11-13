// Нотифікації: центральне сховище подій, які потім забирає і сайт (поллінг),
// і Discord-бот (через /api/bot/pending-notifications, див. botRoutes.js).
const express = require('express');
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');

const router = express.Router();
router.use(requireAuth);

// GET /api/notifications?unread=true
router.get('/', async (req, res) => {
  const unreadOnly = req.query.unread === 'true';
  const { rows } = await query(
    `SELECT * FROM notifications
     WHERE (target_role IS NULL OR target_role = $1 OR $1 = 'admin')
       ${unreadOnly ? 'AND is_read = FALSE' : ''}
     ORDER BY created_at DESC LIMIT 100`,
    [req.user.role]
  );
  res.json(rows);
});

router.post('/:id/read', async (req, res) => {
  await query('UPDATE notifications SET is_read = TRUE WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

router.post('/read-all', async (req, res) => {
  await query(
    `UPDATE notifications SET is_read = TRUE
     WHERE (target_role IS NULL OR target_role = $1)`,
    [req.user.role]
  );
  res.json({ ok: true });
});

// POST /api/notifications — ручне оголошення (модератор/адмін)
router.post('/', requirePermission('manage:notifications'), async (req, res) => {
  const { type, title, message, severity, targetRole, deliverDiscord } = req.body || {};
  if (!type || !title || !message) {
    return res.status(400).json({ error: 'type, title, message обов\'язкові.' });
  }
  const { rows } = await query(
    `INSERT INTO notifications (type, title, message, severity, target_role, deliver_discord)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [type, title, message, severity || 'info', targetRole || null, deliverDiscord !== false]
  );
  res.status(201).json(rows[0]);
});

// ---------- Таймери фракційної війни ----------

router.get('/faction-timers', async (_req, res) => {
  const { rows } = await query('SELECT * FROM faction_warfare_timers ORDER BY timer_ends_at ASC');
  res.json(rows);
});

router.post('/faction-timers', requirePermission('manage:notifications'), async (req, res) => {
  const { zoneName, tier, flagStatus, timerEndsAt } = req.body || {};
  if (!zoneName || !timerEndsAt) return res.status(400).json({ error: 'zoneName і timerEndsAt обов\'язкові.' });
  const { rows } = await query(
    `INSERT INTO faction_warfare_timers (zone_name, tier, flag_status, timer_ends_at, updated_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [zoneName, tier || null, flagStatus || 'neutral', timerEndsAt, req.user.id]
  );
  res.status(201).json(rows[0]);
});

router.put('/faction-timers/:id', requirePermission('manage:notifications'), async (req, res) => {
  const { flagStatus, timerEndsAt } = req.body || {};
  const { rows } = await query(
    `UPDATE faction_warfare_timers SET
       flag_status = COALESCE($1, flag_status),
       timer_ends_at = COALESCE($2, timer_ends_at),
       updated_by = $3, updated_at = now()
     WHERE id = $4 RETURNING *`,
    [flagStatus || null, timerEndsAt || null, req.user.id, req.params.id]
  );
  res.json(rows[0]);
});

router.delete('/faction-timers/:id', requirePermission('manage:notifications'), async (req, res) => {
  await query('DELETE FROM faction_warfare_timers WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- Таймери відновлення ресурсних зон ----------

router.get('/resource-timers', async (_req, res) => {
  const { rows } = await query('SELECT * FROM zone_resource_timers ORDER BY respawns_at ASC');
  res.json(rows);
});

router.post('/resource-timers', requirePermission('manage:notifications'), async (req, res) => {
  const { zoneName, resourceType, tier, respawnsAt, notes } = req.body || {};
  if (!zoneName || !resourceType || !respawnsAt) {
    return res.status(400).json({ error: 'zoneName, resourceType, respawnsAt обов\'язкові.' });
  }
  const { rows } = await query(
    `INSERT INTO zone_resource_timers (zone_name, resource_type, tier, respawns_at, notes, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [zoneName, resourceType, tier || null, respawnsAt, notes || null, req.user.id]
  );
  res.status(201).json(rows[0]);
});

router.delete('/resource-timers/:id', requirePermission('manage:notifications'), async (req, res) => {
  await query('DELETE FROM zone_resource_timers WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
