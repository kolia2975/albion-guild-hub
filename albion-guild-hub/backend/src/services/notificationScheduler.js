// -----------------------------------------------------------------------
// notificationScheduler — запускається один раз при старті сервера
// (див. server.js) і кожні 5 хвилин перевіряє:
//   1) чи не проголодались робітники (особисті + гільдійський острів)
//   2) чи не наближається/минув таймер фракційної війни
//   3) чи не наближається відновлення ресурсної зони
// Створені записи в таблиці notifications далі забирає:
//   - фронтенд (поллінг GET /api/notifications?unread=true)
//   - Discord-бот (поллінг GET /api/bot/pending-notifications)
// -----------------------------------------------------------------------
const cron = require('node-cron');
const { query } = require('../db/pool');

const DEDUPE_HOURS = 6; // не спамити тим самим попередженням частіше, ніж раз на N год.

async function alreadyNotifiedRecently(type, relatedEntityId) {
  const { rows } = await query(
    `SELECT 1 FROM notifications
     WHERE type = $1 AND related_entity_id = $2
       AND created_at > now() - ($3 || ' hours')::interval
     LIMIT 1`,
    [type, relatedEntityId, DEDUPE_HOURS]
  );
  return rows.length > 0;
}

async function createNotification({ type, title, message, severity, relatedEntityId, targetRole }) {
  await query(
    `INSERT INTO notifications (type, title, message, severity, related_entity_id, target_role)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [type, title, message, severity || 'warning', relatedEntityId || null, targetRole || null]
  );
}

async function checkPersonalLaborers() {
  const { rows } = await query(`
    SELECT lb.id, lb.building_type, lb.target_item, i.name AS island_name,
           u.display_name AS owner_name, u.id AS owner_id
    FROM laborer_buildings lb
    JOIN islands i ON i.id = lb.island_id
    LEFT JOIN users u ON u.id = i.owner_user_id
    WHERE lb.last_fed_at + (lb.feed_cycle_hours || ' hours')::interval < now()
  `);
  for (const row of rows) {
    if (await alreadyNotifiedRecently('laborer_hunger', row.id)) continue;
    await createNotification({
      type: 'laborer_hunger',
      title: `Робітник голодний: ${row.building_type}`,
      message: `${row.owner_name || 'Гравець'} — острів "${row.island_name}", робітник "${row.building_type}" (${row.target_item}) чекає на їжу/журнали.`,
      severity: 'warning',
      relatedEntityId: row.id,
    });
  }
}

async function checkGuildIslandLaborers() {
  const { rows } = await query(`
    SELECT gil.id, gil.building_type, gil.target_item, gi.name AS island_name
    FROM guild_island_laborers gil
    JOIN guild_islands gi ON gi.id = gil.guild_island_id
    WHERE gil.last_fed_at + (gil.feed_cycle_hours || ' hours')::interval < now()
  `);
  for (const row of rows) {
    if (await alreadyNotifiedRecently('guild_laborer_hunger', row.id)) continue;
    await createNotification({
      type: 'guild_laborer_hunger',
      title: `Гільдійський робітник голодний: ${row.building_type}`,
      message: `Острів "${row.island_name}" — робітник "${row.building_type}" (${row.target_item}) потребує годування.`,
      severity: 'warning',
      relatedEntityId: row.id,
    });
  }
}

async function checkFactionTimers() {
  const { rows } = await query(`
    SELECT * FROM faction_warfare_timers
    WHERE timer_ends_at BETWEEN now() AND now() + interval '30 minutes'
  `);
  for (const row of rows) {
    if (await alreadyNotifiedRecently('faction_timer', row.id)) continue;
    await createNotification({
      type: 'faction_timer',
      title: `Фракційка: ${row.zone_name}`,
      message: `Таймер зони "${row.zone_name}" (статус: ${row.flag_status}) закінчується менш ніж за 30 хв.`,
      severity: 'critical',
      relatedEntityId: row.id,
    });
  }
}

async function checkResourceTimers() {
  const { rows } = await query(`
    SELECT * FROM zone_resource_timers
    WHERE respawns_at BETWEEN now() AND now() + interval '15 minutes'
  `);
  for (const row of rows) {
    if (await alreadyNotifiedRecently('resource_timer', row.id)) continue;
    await createNotification({
      type: 'resource_timer',
      title: `Відновлення ресурсів: ${row.zone_name}`,
      message: `Зона "${row.zone_name}" (${row.resource_type}${row.tier ? `, T${row.tier}` : ''}) відновлюється менш ніж за 15 хв.`,
      severity: 'info',
      relatedEntityId: row.id,
    });
  }
}

async function runAllChecks() {
  try {
    await Promise.all([
      checkPersonalLaborers(),
      checkGuildIslandLaborers(),
      checkFactionTimers(),
      checkResourceTimers(),
    ]);
  } catch (err) {
    console.error('[scheduler] Помилка під час перевірки нотифікацій:', err);
  }
}

function startNotificationScheduler() {
  // Кожні 5 хвилин. Синтаксис: хв година день місяць день-тижня.
  cron.schedule('*/5 * * * *', runAllChecks);
  console.log('[scheduler] Планувальник нотифікацій запущено (кожні 5 хв).');
  // Перша перевірка одразу при старті, не чекаючи 5 хв.
  runAllChecks();
}

module.exports = { startNotificationScheduler, runAllChecks };
