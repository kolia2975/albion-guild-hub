// Перевіряє JWT з заголовка Authorization: Bearer <token>
// і кладе дані користувача у req.user.
const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Потрібна авторизація (немає токена).' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, username, role, displayName }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Токен недійсний або протермінований.' });
  }
}

// М'яка версія: якщо токен є — розпарсить, якщо нема — просто піде далі без user.
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_) {
      /* ігноруємо невалідний токен у м'якому режимі */
    }
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
