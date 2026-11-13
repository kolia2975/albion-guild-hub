const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Вкажи логін і пароль.' });
  }

  const { rows } = await query(
    'SELECT * FROM users WHERE username = $1 AND is_active = TRUE',
    [username]
  );
  const user = rows[0];
  if (!user) {
    return res.status(401).json({ error: 'Невірний логін або пароль.' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Невірний логін або пароль.' });
  }

  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id)
     VALUES ($1, 'login', 'user', $1)`,
    [user.id]
  );

  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      themePref: user.theme_pref,
    },
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT id, username, display_name, in_game_nick, discord_id, role, theme_pref, created_at
     FROM users WHERE id = $1`,
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Користувача не знайдено.' });
  res.json(rows[0]);
});

// PATCH /api/auth/me — редагування власного профілю (нік, дискорд, тема)
router.patch('/me', requireAuth, async (req, res) => {
  const { inGameNick, discordId, themePref } = req.body || {};
  const { rows } = await query(
    `UPDATE users SET
       in_game_nick = COALESCE($1, in_game_nick),
       discord_id   = COALESCE($2, discord_id),
       theme_pref   = COALESCE($3, theme_pref),
       updated_at   = now()
     WHERE id = $4
     RETURNING id, username, display_name, in_game_nick, discord_id, role, theme_pref`,
    [inGameNick ?? null, discordId ?? null, themePref ?? null, req.user.id]
  );
  res.json(rows[0]);
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Новий пароль має бути мінімум 8 символів.' });
  }
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  const ok = await bcrypt.compare(oldPassword, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Старий пароль невірний.' });

  const hash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
    hash,
    req.user.id,
  ]);
  res.json({ ok: true });
});

module.exports = router;
