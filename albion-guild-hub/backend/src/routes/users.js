const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(requireAuth);

const ALLOWED_ROLES = ['member', 'economist', 'accountant', 'roster', 'moderator', 'admin'];

// GET /api/users — список усіх учасників гільдії (модератор/адмін)
router.get('/', requirePermission('manage:users_basic'), async (_req, res) => {
  const { rows } = await query(
    `SELECT id, username, display_name, in_game_nick, discord_id, role, is_active, last_login_at, created_at
     FROM users ORDER BY created_at ASC`
  );
  res.json(rows);
});

// POST /api/users — створити нового користувача (запросити в гільдію)
router.post('/', requirePermission('manage:users_basic'), async (req, res) => {
  const { username, password, displayName, inGameNick, role } = req.body || {};
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'username, password, displayName — обов\'язкові.' });
  }
  const finalRole = ALLOWED_ROLES.includes(role) ? role : 'member';

  // Лише admin може одразу видати роль moderator/admin комусь іншому.
  if (['moderator', 'admin'].includes(finalRole) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Лише адмін може призначати ролі moderator/admin.' });
  }

  const hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, display_name, in_game_nick, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, display_name, in_game_nick, role, created_at`,
      [username, hash, displayName, inGameNick || null, finalRole]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Такий логін уже існує.' });
    }
    throw err;
  }
});

// PATCH /api/users/:id/role — змінити роль (тільки admin, або moderator -> нижче за себе)
router.patch('/:id/role', requirePermission('manage:users_basic'), async (req, res) => {
  const { role } = req.body || {};
  if (!ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Невідома роль.' });
  }
  if (['moderator', 'admin'].includes(role) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Лише адмін може призначати ролі moderator/admin.' });
  }
  const { rows } = await query(
    `UPDATE users SET role = $1, updated_at = now() WHERE id = $2
     RETURNING id, username, role`,
    [role, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Користувача не знайдено.' });

  await query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, meta)
     VALUES ($1, 'role_change', 'user', $2, $3)`,
    [req.user.id, req.params.id, JSON.stringify({ newRole: role })]
  );
  res.json(rows[0]);
});

// PATCH /api/users/:id/active — заблокувати/розблокувати доступ
router.patch('/:id/active', requirePermission('manage:users_basic'), async (req, res) => {
  const { isActive } = req.body || {};
  const { rows } = await query(
    'UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2 RETURNING id, username, is_active',
    [!!isActive, req.params.id]
  );
  res.json(rows[0]);
});

// --- Майстерки гравця (для авто-підбору сетів) ---

// GET /api/users/:id/specializations
router.get('/:id/specializations', async (req, res) => {
  if (req.user.id !== req.params.id && req.user.role !== 'admin' && req.user.role !== 'roster') {
    return res.status(403).json({ error: 'Можна дивитись лише свій профіль (або бути roster/admin).' });
  }
  const { rows } = await query(
    `SELECT pcs.id, cl.code, cl.label, cl.category, pcs.mastery_level, pcs.updated_at
     FROM player_crafting_specializations pcs
     JOIN crafting_lines cl ON cl.id = pcs.crafting_line_id
     WHERE pcs.user_id = $1
     ORDER BY pcs.mastery_level DESC`,
    [req.params.id]
  );
  res.json(rows);
});

// PUT /api/users/:id/specializations — масове оновлення (сам гравець редагує свій профіль)
router.put('/:id/specializations', async (req, res) => {
  if (req.user.id !== req.params.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Редагувати можна лише власний профіль.' });
  }
  const { specializations } = req.body || {}; // [{ code, masteryLevel }]
  if (!Array.isArray(specializations)) {
    return res.status(400).json({ error: 'specializations має бути масивом.' });
  }

  for (const spec of specializations) {
    const { rows: lineRows } = await query('SELECT id FROM crafting_lines WHERE code = $1', [spec.code]);
    if (!lineRows[0]) continue;
    await query(
      `INSERT INTO player_crafting_specializations (user_id, crafting_line_id, mastery_level)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, crafting_line_id)
       DO UPDATE SET mastery_level = EXCLUDED.mastery_level, updated_at = now()`,
      [req.params.id, lineRows[0].id, Math.max(0, Math.min(100, Number(spec.masteryLevel) || 0))]
    );
  }
  res.json({ ok: true });
});

// GET /api/users/crafting-lines — довідник ліній майстерок (для форми профілю)
router.get('/meta/crafting-lines', async (_req, res) => {
  const { rows } = await query('SELECT id, code, label, category FROM crafting_lines ORDER BY category, label');
  res.json(rows);
});

module.exports = router;
