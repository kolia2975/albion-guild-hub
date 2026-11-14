const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');
async function migrate() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(8675309)');
    await c.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const dir = path.join(__dirname, '../../migrations');
    console.log('[migrate] dir:', dir);
    console.log('[migrate] files:', fs.existsSync(dir) ? fs.readdirSync(dir) : 'DIR NOT FOUND');
    for (const name of fs
      .readdirSync(dir)
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      const r = await c.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
      if (!r.rowCount) {
        await c.query(fs.readFileSync(path.join(dir, name), 'utf8'));
        await c.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
        console.log('[migration]', name);
      }
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
module.exports = { migrate };
