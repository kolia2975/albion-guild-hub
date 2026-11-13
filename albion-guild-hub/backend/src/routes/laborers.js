// -----------------------------------------------------------------------
// Модуль "Острови та Робітники" (особисті острови гравців).
// Формули:
//  - Цикл годування = feed_cycle_hours (за замовч. 22 год) від last_fed_at
//  - Щастя (happiness) максимум 1000 = 100%
//  - Потреба в їжі/журналах залежить від Тіру будинку (T4–T8)
// -----------------------------------------------------------------------
const express = require('express');
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Норми споживання на цикл (спрощена, репрезентативна таблиця -
// підлаштуй числа під актуальний баланс гри у цьому файлі).
const TIER_CONSUMPTION = {
  4: { meals: 4, journals: 2 },
  5: { meals: 6, journals: 3 },
  6: { meals: 8, journals: 4 },
  7: { meals: 10, journals: 5 },
  8: { meals: 12, journals: 6 },
};

function mealItem(tier) {
  return `T${tier}_MEAL_PIE`;
}
function journalItem(tier, journalType = 'HERO') {
  return `T${tier}_JOURNAL_${journalType}`;
}

function happinessNow(building) {
  const hoursSinceFed = (Date.now() - new Date(building.last_fed_at).getTime()) / 3_600_000;
  const decayPerHour = building.happiness_max / building.feed_cycle_hours;
  const value = Math.round(building.happiness_max - hoursSinceFed * decayPerHour);
  return Math.max(0, Math.min(building.happiness_max, value));
}

function feedDeadline(building) {
  return new Date(
    new Date(building.last_fed_at).getTime() + building.feed_cycle_hours * 3_600_000
  ).toISOString();
}

// GET /api/laborers/islands — усі острови поточного користувача (+ адмін бачить усі)
router.get('/islands', async (req, res) => {
  const isPrivileged = ['admin', 'roster', 'moderator'].includes(req.user.role);
  const { rows } = await query(
    isPrivileged
      ? 'SELECT * FROM islands ORDER BY created_at ASC'
      : 'SELECT * FROM islands WHERE owner_user_id = $1 ORDER BY created_at ASC',
    isPrivileged ? [] : [req.user.id]
  );
  res.json(rows);
});

// POST /api/laborers/islands — додати острів
router.post('/islands', async (req, res) => {
  const { name, city, tier } = req.body || {};
  if (!name || !city) return res.status(400).json({ error: 'name і city обов\'язкові.' });
  const { rows } = await query(
    `INSERT INTO islands (owner_user_id, name, city, tier) VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.user.id, name, city, tier || 1]
  );
  res.status(201).json(rows[0]);
});

// GET /api/laborers/islands/:islandId/buildings — робітники острова + статус
router.get('/islands/:islandId/buildings', async (req, res) => {
  const { rows: buildings } = await query(
    'SELECT * FROM laborer_buildings WHERE island_id = $1 ORDER BY created_at ASC',
    [req.params.islandId]
  );
  const { rows: inventory } = await query(
    'SELECT item_unique_name, quantity FROM island_inventory WHERE island_id = $1',
    [req.params.islandId]
  );
  const invMap = Object.fromEntries(inventory.map((i) => [i.item_unique_name, Number(i.quantity)]));

  const result = buildings.map((b) => {
    const norm = TIER_CONSUMPTION[b.building_tier] || TIER_CONSUMPTION[4];
    const needMeal = mealItem(b.building_tier);
    const needJournal = journalItem(b.building_tier);
    const haveMeal = invMap[needMeal] || 0;
    const haveJournal = invMap[needJournal] || 0;
    return {
      ...b,
      happiness_live: happinessNow(b),
      feed_deadline: feedDeadline(b),
      needs: {
        meal_item: needMeal,
        meal_required: norm.meals,
        meal_have: haveMeal,
        meal_deficit: Math.max(0, norm.meals - haveMeal),
        journal_item: needJournal,
        journal_required: norm.journals,
        journal_have: haveJournal,
        journal_deficit: Math.max(0, norm.journals - haveJournal),
      },
    };
  });
  res.json(result);
});

// POST /api/laborers/islands/:islandId/buildings — додати робітника (будівлю)
router.post('/islands/:islandId/buildings', async (req, res) => {
  const { buildingType, buildingTier, laborerName, targetItem, feedCycleHours } = req.body || {};
  if (!buildingType || !buildingTier || !targetItem) {
    return res.status(400).json({ error: 'buildingType, buildingTier, targetItem обов\'язкові.' });
  }
  const { rows } = await query(
    `INSERT INTO laborer_buildings
       (island_id, building_type, building_tier, laborer_name, target_item, feed_cycle_hours)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.params.islandId, buildingType, buildingTier, laborerName || null, targetItem, feedCycleHours || 22]
  );
  res.status(201).json(rows[0]);
});

// POST /api/laborers/buildings/:id/feed — "погодувати" робітника (скинути таймер)
router.post('/buildings/:id/feed', async (req, res) => {
  const { rows } = await query(
    `UPDATE laborer_buildings
     SET happiness_current = happiness_max, last_fed_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Робітника не знайдено.' });
  res.json(rows[0]);
});

// PUT /api/laborers/islands/:islandId/inventory — оновити склад їжі/журналів острова
router.put('/islands/:islandId/inventory', async (req, res) => {
  const { items } = req.body || {}; // [{ itemUniqueName, quantity }]
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items має бути масивом.' });
  for (const it of items) {
    await query(
      `INSERT INTO island_inventory (island_id, item_unique_name, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (island_id, item_unique_name)
       DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
      [req.params.islandId, it.itemUniqueName, it.quantity]
    );
  }
  res.json({ ok: true });
});

// GET /api/laborers/shopping-list — агрегований список закупів по всіх островах юзера
router.get('/shopping-list', async (req, res) => {
  const isPrivileged = ['admin', 'roster', 'moderator'].includes(req.user.role);
  const { rows: islands } = await query(
    isPrivileged
      ? 'SELECT id FROM islands'
      : 'SELECT id FROM islands WHERE owner_user_id = $1',
    isPrivileged ? [] : [req.user.id]
  );
  const islandIds = islands.map((i) => i.id);
  if (islandIds.length === 0) return res.json([]);

  const { rows: buildings } = await query(
    `SELECT * FROM laborer_buildings WHERE island_id = ANY($1::uuid[])`,
    [islandIds]
  );
  const { rows: inventory } = await query(
    `SELECT island_id, item_unique_name, quantity FROM island_inventory WHERE island_id = ANY($1::uuid[])`,
    [islandIds]
  );
  const invMap = {};
  for (const row of inventory) {
    invMap[`${row.island_id}:${row.item_unique_name}`] = Number(row.quantity);
  }

  const totals = {};
  for (const b of buildings) {
    const norm = TIER_CONSUMPTION[b.building_tier] || TIER_CONSUMPTION[4];
    const meal = mealItem(b.building_tier);
    const journal = journalItem(b.building_tier);
    const haveMeal = invMap[`${b.island_id}:${meal}`] || 0;
    const haveJournal = invMap[`${b.island_id}:${journal}`] || 0;
    const deficitMeal = Math.max(0, norm.meals - haveMeal);
    const deficitJournal = Math.max(0, norm.journals - haveJournal);
    totals[meal] = (totals[meal] || 0) + deficitMeal;
    totals[journal] = (totals[journal] || 0) + deficitJournal;
  }

  res.json(
    Object.entries(totals)
      .filter(([, qty]) => qty > 0)
      .map(([itemUniqueName, quantity]) => ({ itemUniqueName, quantity }))
  );
});

module.exports = router;
