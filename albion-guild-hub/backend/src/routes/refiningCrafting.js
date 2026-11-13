// -----------------------------------------------------------------------
// Модуль "Переробка та Крафт".
// Формула повернення ресурсів (Return Rate Formula, RRF):
//   чисті витрати сировини = базові_витрати * (1 - RRF/100) * (1 - міський_бонус/100)
// RRF залежить від рівня спеціалізації + витраченого фокусу на верстаті
// (типові значення в грі: 15.2% / 21.2% / 27.2% / 33.2% / 43.5% / 53.9% —
//  онови під актуальний баланс, якщо Sandbox Interactive змінить цифри).
// -----------------------------------------------------------------------
const express = require('express');
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');

const router = express.Router();
router.use(requireAuth);

function calcRefining({
  rawMaterialQtyPerCraft,
  rawMaterialPrice,
  outputQuantity,
  outputPrice,
  returnRatePercent,
  cityBonusPercent = 0,
  stationFeeSilver = 0,
  marketTaxPercent = 4,
}) {
  const consumptionFactor = (1 - returnRatePercent / 100) * (1 - cityBonusPercent / 100);
  const netRawMaterials = rawMaterialQtyPerCraft * consumptionFactor;

  const rawCostSilver = netRawMaterials * rawMaterialPrice;
  const totalCostSilver = rawCostSilver + stationFeeSilver;

  const grossRevenueSilver = outputQuantity * outputPrice;
  const marketTaxSilver = grossRevenueSilver * (marketTaxPercent / 100);
  const netRevenueSilver = grossRevenueSilver - marketTaxSilver;

  const netProfitSilver = netRevenueSilver - totalCostSilver;
  const profitMarginPercent = totalCostSilver > 0 ? (netProfitSilver / totalCostSilver) * 100 : 0;

  return {
    netRawMaterials: Number(netRawMaterials.toFixed(4)),
    rawCostSilver: Math.round(rawCostSilver),
    totalCostSilver: Math.round(totalCostSilver),
    grossRevenueSilver: Math.round(grossRevenueSilver),
    marketTaxSilver: Math.round(marketTaxSilver),
    netRevenueSilver: Math.round(netRevenueSilver),
    netProfitSilver: Math.round(netProfitSilver),
    profitMarginPercent: Number(profitMarginPercent.toFixed(2)),
  };
}

// POST /api/refining/calculate — швидкий розрахунок без збереження
router.post('/calculate', (req, res) => {
  const b = req.body || {};
  const required = ['rawMaterialQtyPerCraft', 'rawMaterialPrice', 'outputQuantity', 'outputPrice', 'returnRatePercent'];
  for (const key of required) {
    if (b[key] === undefined) return res.status(400).json({ error: `Поле "${key}" обов'язкове.` });
  }
  res.json(calcRefining(b));
});

// POST /api/refining/save — зберегти розрахунок в історію (для звітів обліковця)
router.post('/save', requirePermission('write:refining'), async (req, res) => {
  const b = req.body || {};
  const result = calcRefining(b);
  const { rows } = await query(
    `INSERT INTO refining_calculations
       (user_id, recipe_name, city, resource_tier, enchant, return_rate_percent, station_fee_silver,
        inputs, outputs, raw_cost_silver, product_revenue_silver, market_tax_percent,
        net_profit_silver, profit_margin_percent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      req.user.id,
      b.recipeName || 'Без назви',
      b.city || 'Невідомо',
      b.resourceTier || 4,
      b.enchant || 0,
      b.returnRatePercent,
      b.stationFeeSilver || 0,
      JSON.stringify({ rawMaterialQtyPerCraft: b.rawMaterialQtyPerCraft, rawMaterialPrice: b.rawMaterialPrice }),
      JSON.stringify({ outputQuantity: b.outputQuantity, outputPrice: b.outputPrice }),
      result.rawCostSilver,
      result.grossRevenueSilver,
      b.marketTaxPercent || 4,
      result.netProfitSilver,
      result.profitMarginPercent,
    ]
  );
  res.status(201).json(rows[0]);
});

// GET /api/refining/history
router.get('/history', async (req, res) => {
  const isPrivileged = ['admin', 'accountant', 'moderator'].includes(req.user.role);
  const { rows } = await query(
    isPrivileged
      ? 'SELECT * FROM refining_calculations ORDER BY created_at DESC LIMIT 200'
      : 'SELECT * FROM refining_calculations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200',
    isPrivileged ? [] : [req.user.id]
  );
  res.json(rows);
});

module.exports = router;
