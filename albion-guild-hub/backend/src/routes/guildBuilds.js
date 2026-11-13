// -----------------------------------------------------------------------
// Модуль "Гільдійські Сети та КТА".
//  - Сети вручну збирає admin/roster (is_admin_curated = true за замовч.)
//  - Авто-підбір: для кожного гравця рахуємо % відповідності сету його
//    рівням майстерок (player_crafting_specializations), щоб порадити,
//    які сети йому реально під силу скрафтити/зібрати самому.
//  - Чеклист готовності: порівнює предмети сету з player_inventory.
// -----------------------------------------------------------------------
const express = require('express');
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');

const router = express.Router();
router.use(requireAuth);

// ---------- Сети ----------

// GET /api/builds/sets?contentType=ZvZ
router.get('/sets', async (req, res) => {
  const { contentType } = req.query;
  const { rows } = await query(
    contentType
      ? 'SELECT * FROM gear_sets WHERE content_type = $1 ORDER BY created_at DESC'
      : 'SELECT * FROM gear_sets ORDER BY created_at DESC',
    contentType ? [contentType] : []
  );
  res.json(rows);
});

// GET /api/builds/sets/:id — сет разом з предметами
router.get('/sets/:id', async (req, res) => {
  const { rows: setRows } = await query('SELECT * FROM gear_sets WHERE id = $1', [req.params.id]);
  if (!setRows[0]) return res.status(404).json({ error: 'Сет не знайдено.' });
  const { rows: items } = await query(
    `SELECT gsi.*, cl.label AS crafting_line_label
     FROM gear_set_items gsi
     LEFT JOIN crafting_lines cl ON cl.id = gsi.crafting_line_id
     WHERE gsi.gear_set_id = $1 ORDER BY gsi.slot`,
    [req.params.id]
  );
  res.json({ ...setRows[0], items });
});

// POST /api/builds/sets — створити сет (admin або roster)
router.post('/sets', requirePermission('write:gear_sets'), async (req, res) => {
  const { name, contentType, description } = req.body || {};
  if (!name || !contentType) return res.status(400).json({ error: 'name і contentType обов\'язкові.' });
  const { rows } = await query(
    `INSERT INTO gear_sets (name, content_type, description, is_admin_curated, created_by)
     VALUES ($1,$2,$3, TRUE, $4) RETURNING *`,
    [name, contentType, description || null, req.user.id]
  );
  res.status(201).json(rows[0]);
});

// PUT /api/builds/sets/:id
router.put('/sets/:id', requirePermission('write:gear_sets'), async (req, res) => {
  const { name, contentType, description } = req.body || {};
  const { rows } = await query(
    `UPDATE gear_sets SET
       name = COALESCE($1, name),
       content_type = COALESCE($2, content_type),
       description = COALESCE($3, description),
       updated_at = now()
     WHERE id = $4 RETURNING *`,
    [name || null, contentType || null, description ?? null, req.params.id]
  );
  res.json(rows[0]);
});

// DELETE /api/builds/sets/:id
router.delete('/sets/:id', requirePermission('write:gear_sets'), async (req, res) => {
  await query('DELETE FROM gear_sets WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// POST /api/builds/sets/:id/items — додати слот екіпіровки в сет
router.post('/sets/:id/items', requirePermission('write:gear_sets'), async (req, res) => {
  const { slot, itemUniqueName, tier, enchant, craftingLineCode, quantity } = req.body || {};
  if (!slot || !itemUniqueName || !tier) {
    return res.status(400).json({ error: 'slot, itemUniqueName, tier обов\'язкові.' });
  }
  let craftingLineId = null;
  if (craftingLineCode) {
    const { rows } = await query('SELECT id FROM crafting_lines WHERE code = $1', [craftingLineCode]);
    craftingLineId = rows[0]?.id || null;
  }
  const { rows } = await query(
    `INSERT INTO gear_set_items (gear_set_id, slot, item_unique_name, tier, enchant, crafting_line_id, quantity)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.id, slot, itemUniqueName, tier, enchant || 0, craftingLineId, quantity || 1]
  );
  res.status(201).json(rows[0]);
});

// DELETE /api/builds/items/:itemId
router.delete('/items/:itemId', requirePermission('write:gear_sets'), async (req, res) => {
  await query('DELETE FROM gear_set_items WHERE id = $1', [req.params.itemId]);
  res.json({ ok: true });
});

// ---------- Авто-підбір за майстерками профілю ----------

// GET /api/builds/suggestions/:userId — рекомендовані сети, відсортовані за % відповідності
router.get('/suggestions/:userId', async (req, res) => {
  const { rows: specs } = await query(
    `SELECT crafting_line_id, mastery_level FROM player_crafting_specializations WHERE user_id = $1`,
    [req.params.userId]
  );
  const masteryMap = Object.fromEntries(specs.map((s) => [s.crafting_line_id, s.mastery_level]));

  const { rows: sets } = await query('SELECT * FROM gear_sets ORDER BY created_at DESC');
  const suggestions = [];

  for (const set of sets) {
    const { rows: items } = await query(
      'SELECT slot, item_unique_name, crafting_line_id FROM gear_set_items WHERE gear_set_id = $1',
      [set.id]
    );
    if (items.length === 0) continue;

    let scoreSum = 0;
    let scored = 0;
    const matchedSlots = [];
    for (const item of items) {
      if (!item.crafting_line_id) continue;
      scored += 1;
      const mastery = masteryMap[item.crafting_line_id] || 0;
      scoreSum += mastery;
      if (mastery >= 50) matchedSlots.push(item.slot);
    }
    const matchPercent = scored > 0 ? Math.round(scoreSum / scored) : 0;

    suggestions.push({
      setId: set.id,
      name: set.name,
      contentType: set.content_type,
      matchPercent,
      matchedSlots,
      totalItems: items.length,
    });
  }

  suggestions.sort((a, b) => b.matchPercent - a.matchPercent);
  res.json(suggestions);
});

// ---------- Інвентар гравця (для чеклиста готовності) ----------

// GET /api/builds/inventory/:userId
router.get('/inventory/:userId', async (req, res) => {
  const { rows } = await query('SELECT * FROM player_inventory WHERE user_id = $1', [req.params.userId]);
  res.json(rows);
});

// PUT /api/builds/inventory/:userId — масове оновлення інвентарю (сам гравець або roster/admin)
router.put('/inventory/:userId', async (req, res) => {
  if (req.user.id !== req.params.userId && !['admin', 'roster'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Редагувати можна лише власний інвентар (або бути roster/admin).' });
  }
  const { items } = req.body || {}; // [{ itemUniqueName, tier, enchant, quantity, location }]
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items має бути масивом.' });
  for (const it of items) {
    await query(
      `INSERT INTO player_inventory (user_id, item_unique_name, tier, enchant, quantity, location)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, item_unique_name, tier, enchant, location)
       DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
      [req.params.userId, it.itemUniqueName, it.tier, it.enchant || 0, it.quantity, it.location || 'guild_bank']
    );
  }
  res.json({ ok: true });
});

// GET /api/builds/sets/:id/readiness/:userId — перевірка готовності (жива, не з кешу)
router.get('/sets/:id/readiness/:userId', async (req, res) => {
  const { rows: items } = await query('SELECT * FROM gear_set_items WHERE gear_set_id = $1', [req.params.id]);
  const { rows: inventory } = await query('SELECT * FROM player_inventory WHERE user_id = $1', [
    req.params.userId,
  ]);

  const invMap = {};
  for (const row of inventory) {
    const key = `${row.item_unique_name}:${row.tier}:${row.enchant}`;
    invMap[key] = (invMap[key] || 0) + Number(row.quantity);
  }

  const missing = [];
  for (const item of items) {
    const key = `${item.item_unique_name}:${item.tier}:${item.enchant}`;
    const have = invMap[key] || 0;
    if (have < item.quantity) {
      missing.push({
        slot: item.slot,
        itemUniqueName: item.item_unique_name,
        tier: item.tier,
        enchant: item.enchant,
        required: item.quantity,
        have,
      });
    }
  }

  const status = missing.length === 0 ? 'ready' : missing.length === items.length ? 'missing' : 'partial';

  await query(
    `INSERT INTO gear_readiness (gear_set_id, user_id, status, missing_items, checked_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (gear_set_id, user_id)
     DO UPDATE SET status = EXCLUDED.status, missing_items = EXCLUDED.missing_items, checked_at = now()`,
    [req.params.id, req.params.userId, status, JSON.stringify(missing)]
  );

  res.json({ status, missing, totalSlots: items.length });
});

// GET /api/builds/roster-readiness/:setId — зведення готовності всього складу для КТА (roster/admin)
router.get('/roster-readiness/:setId', requirePermission('write:readiness_check'), async (req, res) => {
  const { rows } = await query(
    `SELECT gr.status, gr.checked_at, u.id AS user_id, u.display_name, u.in_game_nick
     FROM gear_readiness gr
     JOIN users u ON u.id = gr.user_id
     WHERE gr.gear_set_id = $1
     ORDER BY gr.status, u.display_name`,
    [req.params.setId]
  );
  res.json(rows);
});

module.exports = router;
