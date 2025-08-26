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

// Sample business logic used across benchmarks
const jsLogic = (input: { a: number; b: number }) => {
  const sum = input.a + input.b;
  const category = sum > 1000 ? 'huge' : sum > 100 ? 'big' : 'small';
  return { sum, category };
};

// Helper nodes/graphs for Zen variants
const makeInputNode = () => ({
  id: 'start',
  type: 'inputNode',
  name: 'Start',
  position: { x: 0, y: 0 },
  content: {
    fields: [
      { id: 'a', key: 'a', type: 'number', name: 'a' },
      { id: 'b', key: 'b', type: 'number', name: 'b' }
    ]
  }
});

const makeOutputNode = () => ({
  id: 'out',
  type: 'outputNode',
  name: 'Result',
  position: { x: 0, y: 0 },
  content: {}
});

const functionDecision = engine.createDecision({
  nodes: [
    makeInputNode(),
    {
      id: 'fn',
      type: 'functionNode',
      name: 'Fn',
      position: { x: 0, y: 0 },
      content:
        'const handler = (input) => { const sum = input.a + input.b; const category = sum > 1000 ? "huge" : sum > 100 ? "big" : "small"; return { sum, category }; }'
    },
    makeOutputNode()
  ],
  edges: [
    { id: 'e1', type: 'edge', sourceId: 'start', targetId: 'fn' },
    { id: 'e2', type: 'edge', sourceId: 'fn', targetId: 'out' }
  ]
});

const expressionDecision = engine.createDecision({
  nodes: [
    makeInputNode(),
    {
      id: 'expr',
      type: 'expressionNode',
      name: 'Expr',
      position: { x: 0, y: 0 },
      content: {
        expressions: [
          { id: 'e1', key: 'sum', value: 'a + b' },
          {
            id: 'e2',
            key: 'category',
            value:
              'a + b > 1000 ? "huge" : a + b > 100 ? "big" : "small"'
          }
        ],
        passThrough: true,
        inputField: null,
        outputPath: null,
        executionMode: 'single'
      }
    },
    makeOutputNode()
  ],
  edges: [
    { id: 'e1', type: 'edge', sourceId: 'start', targetId: 'expr' },
    { id: 'e2', type: 'edge', sourceId: 'expr', targetId: 'out' }
  ]
});

const decisionTableDecision = engine.createDecision({
  nodes: [
    makeInputNode(),
    {
      id: 'table',
      type: 'decisionTableNode',
      name: 'Table',
      position: { x: 0, y: 0 },
      content: {
        hitPolicy: 'first',
        rules: [
          { i1: 'a + b <= 100', o1: 'a + b', o2: '"small"' },
          { i1: 'a + b <= 1000', o1: 'a + b', o2: '"big"' },
          { i1: 'a + b > 1000', o1: 'a + b', o2: '"huge"' }
        ],
        inputs: [{ id: 'i1', name: 'total', field: '' }],
        outputs: [
          { id: 'o1', name: 'sum', field: 'sum' },
          { id: 'o2', name: 'category', field: 'category' }
        ],
        passThrough: false,
        inputField: null,
        outputPath: null,
        executionMode: 'single'
      }
    },
    makeOutputNode()
  ],
  edges: [
    { id: 'e1', type: 'edge', sourceId: 'start', targetId: 'table' },
    { id: 'e2', type: 'edge', sourceId: 'table', targetId: 'out' }
  ]
});

const passDecision = engine.createDecision({
  nodes: [makeInputNode(), makeOutputNode()],
  edges: [{ id: 'e1', type: 'edge', sourceId: 'start', targetId: 'out' }]
});

// HTTP server
Bun.serve({
  port: 3000,
  // Allow long-running benchmark requests
  // bun types may not yet include this option
  // @ts-expect-error
  idleTimeout: 240,
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

    // Performance benchmark
    if (req.method === 'GET' && url.pathname === '/benchmark') {
      const sizesParam = url.searchParams.get('sizes');
      const sizes = sizesParam
        ? sizesParam.split(',').map((s) => Number(s)).filter((n) => n > 0)
        : [10_000, 100_000];
      const results: Record<number, any> = {};
      for (const n of sizes) {
        const data = Array.from({ length: n }, () => ({
          a: Math.random() * 1000,
          b: Math.random() * 1000
        }));

        let start = performance.now();
        for (const item of data) {
          jsLogic(item);
        }
        let end = performance.now();
        const jsSync = end - start;

        start = performance.now();
        await Promise.all(data.map((item) => Promise.resolve(jsLogic(item))));
        end = performance.now();
        const jsAsync = end - start;

        start = performance.now();
        await Promise.all(data.map((item) => functionDecision.evaluate(item)));
        end = performance.now();
        const fnTime = end - start;

        start = performance.now();
        await Promise.all(data.map((item) => expressionDecision.evaluate(item)));
        end = performance.now();
        const exprTime = end - start;

        start = performance.now();
        await Promise.all(data.map((item) => decisionTableDecision.evaluate(item)));
        end = performance.now();
        const tableTime = end - start;

        const batchSize = 1000;
        start = performance.now();
        for (let i = 0; i < data.length; i += batchSize) {
          const slice = data.slice(i, i + batchSize);
          await Promise.all(slice.map((item) => decisionTableDecision.evaluate(item)));
        }
        end = performance.now();
        const tableBatchTime = end - start;

        start = performance.now();
        await Promise.all(data.map((item) => passDecision.evaluate(item)));
        end = performance.now();
        const passTime = end - start;

        results[n] = {
          jsSync,
          jsAsync,
          function: fnTime,
          expression: exprTime,
          table: tableTime,
          tableBatch: tableBatchTime,
          passthrough: passTime
        };
      }
      return new Response(JSON.stringify(results), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not found', { status: 404 });
  }
});

console.log('Server running on http://localhost:3000');

