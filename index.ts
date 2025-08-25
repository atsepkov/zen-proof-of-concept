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

const loader = async (key: string) => {
    // support keys like "shipping@latest" or "shipping@42"
    const [id, ver] = key.split('@');
    let row;
    if (ver === 'latest') {
      row = db.prepare(`
        SELECT jdm FROM rulesets
        WHERE id = ? AND status = 'active'
        ORDER BY version DESC LIMIT 1
      `).get(id);
    } else {
      row = db.prepare(`
        SELECT jdm FROM rulesets
        WHERE id = ? AND version = ?
      `).get(id, Number(ver));
    }
    if (!row) throw new Error(`JDM not found for ${key}`);
    // Return raw JSON bytes; ZEN will parse them.
    return Buffer.from(row.jdm, 'utf8');
  };

// Zen engine instance with loader pulling JDM from SQLite
const engine = new ZenEngine({ loader });

// HTTP server
Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Serve editor assets
    if (req.method === 'GET' && url.pathname === '/editor') {
      const file = Bun.file('public/editor.html');
      return new Response(file, { headers: { 'Content-Type': 'text/html' } });
    }

    if (req.method === 'GET' && (url.pathname === '/editor.js' || url.pathname === '/editor.css')) {
      const path = `public${url.pathname}`;
      const type = url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript';
      const file = Bun.file(path);
      if (await file.exists()) {
        return new Response(file, { headers: { 'Content-Type': type } });
      }
    }

    // Serve analyze assets
    if (req.method === 'GET' && url.pathname === '/analyze') {
      const file = Bun.file('public/analyze.html');
      return new Response(file, { headers: { 'Content-Type': 'text/html' } });
    }

    if (req.method === 'GET' && (url.pathname === '/analyze.js' || url.pathname === '/analyze.css')) {
      const path = `public${url.pathname}`;
      const type = url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript';
      const file = Bun.file(path);
      if (await file.exists()) {
        return new Response(file, { headers: { 'Content-Type': type } });
      }
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

    // List all rule names (support trailing slash)
    if (req.method === 'GET' && (url.pathname === '/rules' || url.pathname === '/rules/')) {
      const rows = db.query(`SELECT DISTINCT id FROM rulesets ORDER BY id`).all() as any[];
      return new Response(JSON.stringify(rows.map((r) => r.id)), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Retrieve JDM or version metadata
    if (req.method === 'GET' && url.pathname.startsWith('/rules/')) {
      const key = decodeURIComponent(url.pathname.slice('/rules/'.length));
      if (!key.includes('@')) {
        const rows = db
          .query(`SELECT version, status, created_at FROM rulesets WHERE id = ? ORDER BY version DESC`)
          .all(key) as any[];
        return new Response(JSON.stringify(rows), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      try {
        const bytes = await loader(key);
        return new Response(bytes, {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err: any) {
        return new Response(String(err.message || err), { status: 404 });
      }
    }

    // Analyze parts via Zen engine
    if (req.method === 'POST' && url.pathname === '/analyze') {
      try {
        const body = await req.json();
        const key = body.key as string;
        const parts = body.parts as any[];
        if (!key || !Array.isArray(parts)) {
          return new Response('key and parts are required', { status: 400 });
        }
        const results = [] as any[];
        for (const part of parts) {
          try {
            const res = await engine.evaluate(key, part);
            results.push(res.result);
          } catch (err: any) {
            results.push({ error: err.message || String(err) });
          }
        }
        return new Response(JSON.stringify(results), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err: any) {
        return new Response(String(err.message || err), { status: 500 });
      }
    }

    return new Response('Not found', { status: 404 });
  }
});

console.log('Server running on http://localhost:3000');

