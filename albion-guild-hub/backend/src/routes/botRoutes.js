// -----------------------------------------------------------------------
// Бот-Хаб: єдина точка входу для Discord-бота (bot/index.js).
// Захищено внутрішнім ключем (X-Internal-Key), а не JWT користувача —
// бот не є "юзером" сайту.
// -----------------------------------------------------------------------
const express = require('express');
const { query } = require('../db/pool');
const { requireInternalKey } = require('../middleware/internalKey');

const router = express.Router();
router.use(requireInternalKey);

// GET /api/bot/summary — для команди /status в Discord
router.get('/summary', async (_req, res) => {
  const [{ rows: treasury }, { rows: islands }, { rows: hungry }, { rows: factionTimers }, { rows: guildIsland }, { rows: pending }] =
    await Promise.all([
      query(`SELECT
               COALESCE(SUM(amount_silver) FILTER (WHERE entry_type = 'income'), 0) AS income,
               COALESCE(SUM(amount_silver) FILTER (WHERE entry_type = 'expense'), 0) AS expense
             FROM guild_treasury_ledger`),
      query('SELECT COUNT(*) AS count FROM islands'),
      query(`SELECT COUNT(*) AS count FROM laborer_buildings
             WHERE last_fed_at + (feed_cycle_hours || ' hours')::interval < now()`),
      query(`SELECT zone_name, flag_status, timer_ends_at FROM faction_warfare_timers
             WHERE timer_ends_at > now() ORDER BY timer_ends_at ASC LIMIT 5`),
      query('SELECT name, city, tier FROM guild_islands ORDER BY created_at ASC LIMIT 1'),
      query('SELECT COUNT(*) AS count FROM notifications WHERE deliver_discord = TRUE AND delivered_discord_at IS NULL'),
    ]);

  res.json({
    treasuryBalance: Number(treasury[0].income) - Number(treasury[0].expense),
    islandsCount: Number(islands[0].count),
    hungryLaborersCount: Number(hungry[0].count),
    upcomingFactionTimers: factionTimers,
    guildIsland: guildIsland[0] || null,
    pendingNotificationsCount: Number(pending[0].count),
    generatedAt: new Date().toISOString(),
  });
});

// GET /api/bot/pending-notifications — те, що бот ще не запостив у Discord
router.get('/pending-notifications', async (_req, res) => {
  const { rows } = await query(
    `SELECT * FROM notifications
     WHERE deliver_discord = TRUE AND delivered_discord_at IS NULL
     ORDER BY created_at ASC LIMIT 20`
  );
  res.json(rows);
});

// POST /api/bot/notifications/:id/ack — позначити, що бот вже надіслав
router.post('/notifications/:id/ack', async (req, res) => {
  const { rows } = await query(
    'UPDATE notifications SET delivered_discord_at = now() WHERE id = $1 RETURNING *',
    [req.params.id]
  );
  res.json(rows[0] || { ok: true });
});

// GET /api/bot/laborers-hungry — детальний список голодних робітників (особисті + гільдійські)
router.get('/laborers-hungry', async (_req, res) => {
  const { rows: personal } = await query(
    `SELECT lb.id, lb.building_type, lb.target_item, i.name AS island_name, u.display_name AS owner,
            lb.last_fed_at, lb.feed_cycle_hours
     FROM laborer_buildings lb
     JOIN islands i ON i.id = lb.island_id
     LEFT JOIN users u ON u.id = i.owner_user_id
     WHERE lb.last_fed_at + (lb.feed_cycle_hours || ' hours')::interval < now()`
  );
  const { rows: guildOnes } = await query(
    `SELECT gil.id, gil.building_type, gil.target_item, gi.name AS island_name, 'Гільдія' AS owner,
            gil.last_fed_at, gil.feed_cycle_hours
     FROM guild_island_laborers gil
     JOIN guild_islands gi ON gi.id = gil.guild_island_id
     WHERE gil.last_fed_at + (gil.feed_cycle_hours || ' hours')::interval < now()`
  );
  res.json([...personal, ...guildOnes]);
});

// GET /api/bot/faction-timers — для команди /factionwar в Discord
router.get('/faction-timers', async (_req, res) => {
  const { rows } = await query(
    `SELECT zone_name, tier, flag_status, timer_ends_at FROM faction_warfare_timers
     WHERE timer_ends_at > now() - interval '1 hour'
     ORDER BY timer_ends_at ASC LIMIT 10`
  );
  res.json(rows);
});

module.exports = router;
