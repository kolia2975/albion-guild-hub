// -----------------------------------------------------------------------
// Модуль "Гільдійський Острів" (Guild Island).
//
// Факти з відкритої документації гравців (wiki.albiononline.com/wiki/Guild_Island,
// altarofgaming.com, heaven-guardian.com):
//  - Купується в Island Merchant у будь-якому столичному місті, без вимоги Premium.
//  - Апгрейд рівнів (tier) 1..6, кожен апгрейд ~2 хвилини реального часу.
//  - На відміну від особистого острова — ГІЛЬДІЙСЬКИЙ острів НЕ МАЄ грядок/ферм.
//  - На максимальному 6 рівні: 1 Large Plot (Guild Hall) + 16 Building Plot +
//    2 Small Building Plot, сумарна вартість купівлі+апгрейдів ≈ 27 462 500 срібла.
//  - Будівлі поділені на 3 категорії: Economy / Crafting / Houses
//    (довідник — таблиця guild_island_building_catalog, засіяна в db/init.sql).
//  - Переїзд острова в інше місто ЗНИЩУЄ весь прогрес (будівлі, матеріали, срібло).
//
// !! Ці числа Sandbox Interactive іноді змінює патчами. PLOTS_BY_TIER нижче —
// це наближена (не 1:1 підтверджена дев-командою для кожного проміжного рівня)
// прогресія, потрібна лише як зручний старт для кнопки "згенерувати плоти за
// замовчуванням". Адмін завжди може вручну додати/прибрати плоти через API,
// щоб відповідати реальному стану острова в грі.
// -----------------------------------------------------------------------
const express = require('express');
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(requireAuth);

const PLOTS_BY_TIER = {
  1: { large: 1, building: 3, small_building: 0 },
  2: { large: 1, building: 6, small_building: 1 },
  3: { large: 1, building: 9, small_building: 1 },
  4: { large: 1, building: 12, small_building: 2 },
  5: { large: 1, building: 14, small_building: 2 },
  6: { large: 1, building: 16, small_building: 2 },
};

// ---------- Острів ----------

router.get('/', async (_req, res) => {
  const { rows } = await query('SELECT * FROM guild_islands ORDER BY created_at ASC');
  res.json(rows);
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { name, city, tier, silverInvested, notes } = req.body || {};
  if (!city) return res.status(400).json({ error: 'city обов\'язкове.' });
  const { rows } = await query(
    `INSERT INTO guild_islands (name, city, tier, silver_invested, purchased_at, notes)
     VALUES ($1,$2,$3,$4, now(), $5) RETURNING *`,
    [name || 'Гільдійський острів', city, tier || 1, silverInvested || 0, notes || null]
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const { name, tier, silverInvested, notes } = req.body || {};
  const { rows } = await query(
    `UPDATE guild_islands SET
       name = COALESCE($1, name),
       tier = COALESCE($2, tier),
       silver_invested = COALESCE($3, silver_invested),
       notes = COALESCE($4, notes),
       updated_at = now()
     WHERE id = $5 RETURNING *`,
    [name || null, tier ?? null, silverInvested ?? null, notes ?? null, req.params.id]
  );
  res.json(rows[0]);
});

// POST /api/guild-islands/:id/generate-plots — заповнити плоти дефолтною прогресією для tier
router.post('/:id/generate-plots', requireRole('admin'), async (req, res) => {
  const { rows: islandRows } = await query('SELECT * FROM guild_islands WHERE id = $1', [req.params.id]);
  const island = islandRows[0];
  if (!island) return res.status(404).json({ error: 'Острів не знайдено.' });

  const plan = PLOTS_BY_TIER[island.tier] || PLOTS_BY_TIER[1];
  await query('DELETE FROM guild_island_plots WHERE guild_island_id = $1', [req.params.id]);

  for (const [plotType, count] of Object.entries(plan)) {
    for (let i = 1; i <= count; i += 1) {
      await query(
        `INSERT INTO guild_island_plots (guild_island_id, plot_type, plot_index, status)
         VALUES ($1,$2,$3,'empty')`,
        [req.params.id, plotType, i]
      );
    }
  }
  const { rows } = await query(
    'SELECT * FROM guild_island_plots WHERE guild_island_id = $1 ORDER BY plot_type, plot_index',
    [req.params.id]
  );
  res.json(rows);
});

// ---------- Плоти та будівлі ----------

router.get('/:id/plots', async (req, res) => {
  const { rows } = await query(
    `SELECT p.*, c.label AS building_label, c.category AS building_category
     FROM guild_island_plots p
     LEFT JOIN guild_island_building_catalog c ON c.code = p.building_code
     WHERE p.guild_island_id = $1
     ORDER BY p.plot_type, p.plot_index`,
    [req.params.id]
  );
  res.json(rows);
});

router.get('/meta/building-catalog', async (_req, res) => {
  const { rows } = await query('SELECT * FROM guild_island_building_catalog ORDER BY category, label');
  res.json(rows);
});

// PUT /api/guild-islands/plots/:plotId — призначити/оновити будівлю на плоті
router.put('/plots/:plotId', requirePermission('manage:notifications'), async (req, res) => {
  const { buildingCode, buildingTier, status, usageFeeSilver, managedByUserId } = req.body || {};

  if (buildingCode) {
    const { rows: catalog } = await query(
      'SELECT * FROM guild_island_building_catalog WHERE code = $1',
      [buildingCode]
    );
    if (!catalog[0]) return res.status(400).json({ error: 'Невідомий код будівлі.' });

    const { rows: plotRows } = await query('SELECT * FROM guild_island_plots WHERE id = $1', [req.params.plotId]);
    if (!plotRows[0]) return res.status(404).json({ error: 'Плот не знайдено.' });
    if (plotRows[0].plot_type !== catalog[0].required_plot_type) {
      return res.status(400).json({
        error: `Будівля "${catalog[0].label}" потребує плот типу "${catalog[0].required_plot_type}", а не "${plotRows[0].plot_type}".`,
      });
    }
  }

  const { rows } = await query(
    `UPDATE guild_island_plots SET
       building_code = COALESCE($1, building_code),
       building_tier = COALESCE($2, building_tier),
       status = COALESCE($3, status),
       usage_fee_silver = COALESCE($4, usage_fee_silver),
       managed_by_user_id = COALESCE($5, managed_by_user_id),
       built_at = CASE WHEN $3 = 'built' THEN now() ELSE built_at END
     WHERE id = $6 RETURNING *`,
    [buildingCode || null, buildingTier ?? null, status || null, usageFeeSilver ?? null, managedByUserId || null, req.params.plotId]
  );
  res.json(rows[0]);
});

router.delete('/plots/:plotId/building', requireRole('admin'), async (req, res) => {
  const { rows } = await query(
    `UPDATE guild_island_plots
     SET building_code = NULL, building_tier = NULL, status = 'empty', built_at = NULL
     WHERE id = $1 RETURNING *`,
    [req.params.plotId]
  );
  res.json(rows[0]);
});

// ---------- Робітники на гільдійському острові ----------

function happinessNow(row) {
  const hoursSinceFed = (Date.now() - new Date(row.last_fed_at).getTime()) / 3_600_000;
  const decayPerHour = 1000 / row.feed_cycle_hours;
  return Math.max(0, Math.min(1000, Math.round(1000 - hoursSinceFed * decayPerHour)));
}

router.get('/:id/laborers', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM guild_island_laborers WHERE guild_island_id = $1 ORDER BY created_at ASC',
    [req.params.id]
  );
  res.json(
    rows.map((r) => ({
      ...r,
      happiness_live: happinessNow(r),
      feed_deadline: new Date(new Date(r.last_fed_at).getTime() + r.feed_cycle_hours * 3_600_000),
    }))
  );
});

router.post('/:id/laborers', requirePermission('manage:notifications'), async (req, res) => {
  const { buildingType, buildingTier, targetItem, feedCycleHours } = req.body || {};
  if (!buildingType || !buildingTier || !targetItem) {
    return res.status(400).json({ error: 'buildingType, buildingTier, targetItem обов\'язкові.' });
  }
  const { rows } = await query(
    `INSERT INTO guild_island_laborers (guild_island_id, building_type, building_tier, target_item, feed_cycle_hours, fed_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.params.id, buildingType, buildingTier, targetItem, feedCycleHours || 22, req.user.id]
  );
  res.status(201).json(rows[0]);
});

router.post('/laborers/:laborerId/feed', async (req, res) => {
  const { rows } = await query(
    `UPDATE guild_island_laborers
     SET happiness_current = 1000, last_fed_at = now(), fed_by_user_id = $1
     WHERE id = $2 RETURNING *`,
    [req.user.id, req.params.laborerId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Робітника не знайдено.' });
  res.json(rows[0]);
});

// ---------- Права доступу ----------

router.get('/:id/access', requirePermission('manage:notifications'), async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, u.display_name, u.username
     FROM guild_island_access a JOIN users u ON u.id = a.user_id
     WHERE a.guild_island_id = $1`,
    [req.params.id]
  );
  res.json(rows);
});

router.put('/:id/access/:userId', requireRole('admin'), async (req, res) => {
  const { canBuild, canUseStorage, canManageFees } = req.body || {};
  const { rows } = await query(
    `INSERT INTO guild_island_access (guild_island_id, user_id, can_build, can_use_storage, can_manage_fees)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (guild_island_id, user_id)
     DO UPDATE SET can_build = EXCLUDED.can_build, can_use_storage = EXCLUDED.can_use_storage,
                   can_manage_fees = EXCLUDED.can_manage_fees
     RETURNING *`,
    [req.params.id, req.params.userId, !!canBuild, canUseStorage !== false, !!canManageFees]
  );
  res.json(rows[0]);
});

module.exports = router;
