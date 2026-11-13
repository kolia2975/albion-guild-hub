// Захищає /api/bot/* — туди ходить лише наш Discord-бот, а не браузер.
// Бот надсилає заголовок X-Internal-Key, значення якого має збігатися
// з BOT_INTERNAL_API_KEY у .env (однакове і в backend, і в bot).
function requireInternalKey(req, res, next) {
  const key = req.headers['x-internal-key'];
  if (!key || key !== process.env.BOT_INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Невірний внутрішній ключ.' });
  }
  next();
}

module.exports = { requireInternalKey };
