import { Database } from 'bun:sqlite';
import { ZenEngine } from '@gorules/zen-engine';

// Initialize SQLite database and schema
const db = new Database('rules.db');
db.exec(`
CREATE TABLE IF NOT EXISTS rulesets (
  id        TEXT NOT NULL,
  version   INTEGER NOT NULL,
  status    TEXT NOT NULL,
  jdm       TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, version)
);
CREATE INDEX IF NOT EXISTS rulesets_active_idx ON rulesets(id, status, version);
`);

// Zen engine instance with loader pulling JDM from SQLite
const engine = new ZenEngine({
  loader: async (key: string) => {
    const [id, ver] = key.split('@');
    let row: { jdm: string } | undefined;
    if (ver === 'latest') {
      row = db
        .query(`SELECT jdm FROM rulesets WHERE id = ? AND status = 'active' ORDER BY version DESC LIMIT 1`)
        .get(id) as any;
    } else {
      row = db
        .query(`SELECT jdm FROM rulesets WHERE id = ? AND version = ?`)
        .get(id, Number(ver)) as any;
    }
    if (!row) throw new Error(`JDM not found for ${key}`);
    return Buffer.from(row.jdm, 'utf8');
  }
});

// HTTP server
Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Serve simple JDM editor
    if (req.method === 'GET' && url.pathname === '/editor') {
      const file = Bun.file('public/editor.html');
      return new Response(file, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // Publish ruleset
    if (req.method === 'POST' && url.pathname === '/rulesets') {
      const body = await req.json();
      const id = body.id as string;
      const status = (body.status as string) || 'draft';
      const jdm = body.jdm;
      if (!id || !jdm) {
        return new Response('id and jdm are required', { status: 400 });
      }
      const next = db
        .query(`SELECT COALESCE(MAX(version), 0) + 1 as version FROM rulesets WHERE id = ?`)
        .get(id) as any;
      const version = next.version as number;
      db.query(`INSERT INTO rulesets (id, version, status, jdm) VALUES (?, ?, ?, ?)`)
        .run(id, version, status, JSON.stringify(jdm));
      return new Response(JSON.stringify({ id, version, status }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Retrieve JDM by key, e.g. /rules/shipping@latest
    if (req.method === 'GET' && url.pathname.startsWith('/rules/')) {
      const key = decodeURIComponent(url.pathname.slice('/rules/'.length));
      try {
        const bytes = await engine.loader(key);
        return new Response(bytes, {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err: any) {
        return new Response(String(err.message || err), { status: 404 });
      }
    }

    return new Response('Not found', { status: 404 });
  }
});

console.log('Server running on http://localhost:3000');

