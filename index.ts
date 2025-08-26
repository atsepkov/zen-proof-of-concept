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

// Heavy arithmetic rule to better stress the JS and Zen runtimes
// Generate a very large arithmetic expression by offsetting the base input
// and repeating the heavy calculation many times. Modulo keeps the number
// bounded so decision branches still vary.
const generateHeavyCalc = (iterations: number) => {
  const piece = (offset: number) => {
    const v = `(value + ${offset})`;
    return (
      `(((${v} * ${v} + ${v} / 3 - 4) * 2) % 97) + (${v} + 7) * (${v} - 3) - (${v} % 11) * 13 + ((${v} * 17) % 19) * 23 - ` +
      `(${v} + 5) * (${v} + 1)`
    );
  };
  const expr = Array.from({ length: iterations }, (_, i) => `(${piece(i)})`).join(' + ');
  return `(${expr}) % 1000`;
};

const heavyCalc = generateHeavyCalc(50);

// Native JS implementation mirroring the expanded heavy rule
const jsHeavy = (input: { value: number }) => {
  const base = input.value;
  let calc = 0;
  for (let i = 0; i < 50; i++) {
    const v = base + i;
    calc +=
      ((v * v + v / 3 - 4) * 2) % 97 +
      (v + 7) * (v - 3) -
      (v % 11) * 13 +
      ((v * 17) % 19) * 23 -
      (v + 5) * (v + 1);
  }
  calc = calc % 1000;
  return calc > 666 ? 'high' : calc > 333 ? 'mid' : 'low';
};

// Zen expression decision performing the same heavy arithmetic
const expressionDecision = engine.createDecision({
  nodes: [
    {
      id: 'start',
      type: 'inputNode',
      name: 'Start',
      position: { x: 0, y: 0 },
      content: { fields: [{ id: 'value', key: 'value', type: 'number', name: 'value' }] }
    },
    {
      id: 'expr',
      type: 'expressionNode',
      name: 'Expr',
      position: { x: 0, y: 0 },
      content: {
        expressions: [
          {
            id: 'res',
            key: 'result',
            value: `${heavyCalc} > 666 ? "high" : ${heavyCalc} > 333 ? "mid" : "low"`
          }
        ],
        passThrough: false,
        inputField: null,
        outputPath: null,
        executionMode: 'single'
      }
    },
    { id: 'out', type: 'outputNode', name: 'Result', position: { x: 0, y: 0 }, content: {} }
  ],
  edges: [
    { id: 'e1', type: 'edge', sourceId: 'start', targetId: 'expr' },
    { id: 'e2', type: 'edge', sourceId: 'expr', targetId: 'out' }
  ]
});

// Zen decision table evaluating the heavy rule via conditions
const tableDecision = engine.createDecision({
  nodes: [
    {
      id: 'start',
      type: 'inputNode',
      name: 'Start',
      position: { x: 0, y: 0 },
      content: { fields: [{ id: 'value', key: 'value', type: 'number', name: 'value' }] }
    },
    {
      id: 'table',
      type: 'decisionTableNode',
      name: 'Table',
      position: { x: 0, y: 0 },
      content: {
        hitPolicy: 'first',
        rules: [
          { i1: `${heavyCalc} > 666`, o1: '"high"' },
          { i1: `${heavyCalc} > 333`, o1: '"mid"' },
          { i1: 'true', o1: '"low"' }
        ],
        inputs: [{ id: 'i1', name: 'calc', field: '' }],
        outputs: [{ id: 'o1', name: 'result', field: 'result' }],
        passThrough: false,
        inputField: null,
        outputPath: null,
        executionMode: 'single'
      }
    },
    { id: 'out', type: 'outputNode', name: 'Result', position: { x: 0, y: 0 }, content: {} }
  ],
  edges: [
    { id: 'e1', type: 'edge', sourceId: 'start', targetId: 'table' },
    { id: 'e2', type: 'edge', sourceId: 'table', targetId: 'out' }
  ]
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
          value: Math.floor(Math.random() * 1000)
        }));

        let start = performance.now();
        for (const item of data) {
          jsHeavy(item);
        }
        let end = performance.now();
        const jsTime = end - start;

        start = performance.now();
        await Promise.all(data.map((item) => expressionDecision.evaluate(item)));
        end = performance.now();
        const exprTime = end - start;

        start = performance.now();
        await Promise.all(data.map((item) => tableDecision.evaluate(item)));
        end = performance.now();
        const tableTime = end - start;

        results[n] = { js: jsTime, expression: exprTime, table: tableTime };
      }
      return new Response(JSON.stringify(results), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not found', { status: 404 });
  }
});

console.log('Server running on http://localhost:3000');

