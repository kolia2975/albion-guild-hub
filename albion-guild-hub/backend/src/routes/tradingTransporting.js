// -----------------------------------------------------------------------
// Модуль "Арбітраж та Логістика" — міжміська торгівля / Чорний Ринок.
// buyCost   = buyPrice * quantity
// sellGross = sellPrice * quantity
// sellTax   = sellGross * sellTaxPercent   (4% з преміумом / 8% без)
// setupFee  = sellGross * setupFeePercent  (2.5% за виставлення лоту)
// netProfit = sellGross - sellTax - setupFee - buyCost
// roi%      = netProfit / buyCost * 100
// -----------------------------------------------------------------------
const express = require('express');
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');

const router = express.Router();
router.use(requireAuth);

function calcArbitrage({ buyPrice, sellPrice, quantity = 1, sellTaxPercent = 4, setupFeePercent = 2.5 }) {
  const buyCost = buyPrice * quantity;
  const sellGross = sellPrice * quantity;
  const sellTax = sellGross * (sellTaxPercent / 100);
  const setupFee = sellGross * (setupFeePercent / 100);
  const netProfit = sellGross - sellTax - setupFee - buyCost;
  const roiPercent = buyCost > 0 ? (netProfit / buyCost) * 100 : 0;

  return {
    buyCost: Math.round(buyCost),
    sellGross: Math.round(sellGross),
    sellTax: Math.round(sellTax),
    setupFee: Math.round(setupFee),
    netProfit: Math.round(netProfit),
    roiPercent: Number(roiPercent.toFixed(2)),
  };
}

// POST /api/arbitrage/calculate
router.post('/calculate', (req, res) => {
  const b = req.body || {};
  if (b.buyPrice === undefined || b.sellPrice === undefined) {
    return res.status(400).json({ error: 'buyPrice і sellPrice обов\'язкові.' });
  }
  res.json(calcArbitrage(b));
});

// POST /api/arbitrage/save
router.post('/save', requirePermission('write:arbitrage'), async (req, res) => {
  const b = req.body || {};
  const result = calcArbitrage(b);
  const { rows } = await query(
    `INSERT INTO arbitrage_calculations
       (user_id, item_unique_name, buy_city, sell_city, buy_price_silver, sell_price_silver,
        sell_tax_percent, setup_fee_percent, quantity, net_profit_silver, roi_percent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      req.user.id,
      b.itemUniqueName || 'Невідомий предмет',
      b.buyCity || '?',
      b.sellCity || '?',
      b.buyPrice,
      b.sellPrice,
      b.sellTaxPercent || 4,
      b.setupFeePercent || 2.5,
      b.quantity || 1,
      result.netProfit,
      result.roiPercent,
    ]
  );
  res.status(201).json(rows[0]);
});

// GET /api/arbitrage/history
router.get('/history', async (req, res) => {
  const isPrivileged = ['admin', 'accountant', 'moderator'].includes(req.user.role);
  const { rows } = await query(
    isPrivileged
      ? 'SELECT * FROM arbitrage_calculations ORDER BY created_at DESC LIMIT 200'
      : 'SELECT * FROM arbitrage_calculations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200',
    isPrivileged ? [] : [req.user.id]
  );
  res.json(rows);
});

module.exports = router;
