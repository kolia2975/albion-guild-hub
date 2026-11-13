// -----------------------------------------------------------------------
// Рольова модель доступу.
// 6 ролей: member, economist, accountant, roster, moderator, admin.
// admin завжди має доступ до всього ('*').
// Щоб додати новий дозвіл — допиши його рядок у PERMISSIONS
// і виклич requirePermission('твій:дозвіл') у потрібному роуті.
// -----------------------------------------------------------------------

const PERMISSIONS = {
  member: [
    'read:own', 'write:own_calculations', 'read:notifications', 'read:gear_sets',
  ],
  economist: [
    'read:own', 'write:own_calculations', 'read:notifications', 'read:gear_sets',
    'write:refining', 'write:arbitrage', 'write:focus', 'read:market',
  ],
  accountant: [
    'read:own', 'write:own_calculations', 'read:notifications', 'read:gear_sets',
    'read:treasury', 'write:treasury', 'read:reports',
  ],
  roster: [
    'read:own', 'write:own_calculations', 'read:notifications', 'read:gear_sets',
    'write:gear_sets', 'read:player_inventory_all', 'write:readiness_check',
  ],
  moderator: [
    'read:own', 'write:own_calculations', 'read:notifications', 'read:gear_sets',
    'manage:users_basic', 'manage:notifications', 'read:reports',
  ],
  admin: ['*'],
};

function hasPermission(role, permission) {
  const perms = PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(permission);
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Потрібна авторизація.' });
    }
    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({
        error: `Недостатньо прав. Потрібен дозвіл "${permission}", твоя роль — "${req.user.role}".`,
      });
    }
    next();
  };
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Потрібна авторизація.' });
    }
    if (req.user.role === 'admin' || allowedRoles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({
      error: `Ця дія доступна лише ролям: ${allowedRoles.join(', ')} (або admin).`,
    });
  };
}

module.exports = { PERMISSIONS, hasPermission, requirePermission, requireRole };
