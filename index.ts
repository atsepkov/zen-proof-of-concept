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
const engine = new ZenEngine({
  loader,
  // Custom handler to support native decision-tree benchmark nodes
  async customHandler(req) {
    if (req.node.kind === 'heavyCalc') {
      const { prop, iterations } = req.node.config as any;
      const value = (req.input as any)[prop];
      const out = jsHeavyValue(value, iterations);
      return { output: { [prop]: out } };
    }
    return { output: req.input };
  }
});

// Heavy arithmetic rule generator and helpers
const generateHeavyCalc = (iterations: number, variable = 'value') => {
  const piece = (offset: number) => {
    const v = `(${variable} + ${offset})`;
    return `(((${v} * (${v} + 3)) % (${offset} + 5)) + (${v} * ${offset}) - ((${v} - ${offset}) * (${v} % (${offset} + 1))))`;
  };
  const expr = Array.from({ length: iterations }, (_, i) => piece(i)).join(' + ');
  return `(${expr}) % 1000`;
};

const jsHeavyValue = (value: number, iterations: number) => {
  let calc = 0;
  for (let i = 0; i < iterations; i++) {
    const v = value + i;
    calc += ((v * (v + 3)) % (i + 5)) + v * i - ((v - i) * (v % (i + 1)));
  }
  calc = calc % 1000;
  return calc > 666 ? 'high' : calc > 333 ? 'mid' : 'low';
};

const jsHeavyPart = (part: Record<string, number>, propCount: number, iterations: number) => {
  const out: Record<string, string> = {};
  for (let i = 0; i < propCount; i++) {
    const key = `p${i}`;
    out[key] = jsHeavyValue(part[key], iterations);
  }
  return out;
};

const buildExpressionDecision = (propCount: number, iterations: number) => {
  const inputFields = Array.from({ length: propCount }, (_, i) => ({
    id: `p${i}`,
    key: `p${i}`,
    type: 'number',
    name: `p${i}`
  }));
  const nodes: any[] = [
    {
      id: 'start',
      type: 'inputNode',
      name: 'Start',
      position: { x: 0, y: 0 },
      content: { fields: inputFields }
    }
  ];
  const edges: any[] = [];
  for (let i = 0; i < propCount; i++) {
    const expr = generateHeavyCalc(iterations, `p${i}`);
    nodes.push({
      id: `expr${i}`,
      type: 'expressionNode',
      name: `Expr${i}`,
      position: { x: 0, y: 0 },
      content: {
        expressions: [
          {
            id: `r${i}`,
            key: `p${i}`,
            value: `${expr} > 666 ? "high" : ${expr} > 333 ? "mid" : "low"`
          }
        ],
        passThrough: true,
        inputField: null,
        outputPath: null,
        executionMode: 'single'
      }
    });
    const prev = i === 0 ? 'start' : `expr${i - 1}`;
    edges.push({ id: `e${i}`, type: 'edge', sourceId: prev, targetId: `expr${i}` });
  }
  nodes.push({ id: 'out', type: 'outputNode', name: 'Result', position: { x: 0, y: 0 }, content: {} });
  edges.push({ id: 'e_out', type: 'edge', sourceId: `expr${propCount - 1}`, targetId: 'out' });
  return engine.createDecision({ nodes, edges });
};

const buildTableDecision = (propCount: number, iterations: number) => {
  const inputFields = Array.from({ length: propCount }, (_, i) => ({
    id: `p${i}`,
    key: `p${i}`,
    type: 'number',
    name: `p${i}`
  }));
  const nodes: any[] = [
    {
      id: 'start',
      type: 'inputNode',
      name: 'Start',
      position: { x: 0, y: 0 },
      content: { fields: inputFields }
    }
  ];
  const edges: any[] = [];
  const heavyValue = generateHeavyCalc(iterations, 'value');
  for (let i = 0; i < propCount; i++) {
    nodes.push({
      id: `table${i}`,
      type: 'decisionTableNode',
      name: `Table${i}`,
      position: { x: 0, y: 0 },
      content: {
        hitPolicy: 'first',
        rules: [
          { i1: `${heavyValue} > 666`, o1: '"high"' },
          { i1: `${heavyValue} > 333`, o1: '"mid"' },
          { i1: 'true', o1: '"low"' }
        ],
        inputs: [{ id: 'i1', name: 'val', field: `p${i}` }],
        outputs: [{ id: 'o1', name: 'result', field: `p${i}` }],
        passThrough: true,
        inputField: null,
        outputPath: null,
        executionMode: 'single'
      }
    });
    const prev = i === 0 ? 'start' : `table${i - 1}`;
    edges.push({ id: `t${i}`, type: 'edge', sourceId: prev, targetId: `table${i}` });
  }
  nodes.push({ id: 'out', type: 'outputNode', name: 'Result', position: { x: 0, y: 0 }, content: {} });
  edges.push({ id: 't_out', type: 'edge', sourceId: `table${propCount - 1}`, targetId: 'out' });
  return engine.createDecision({ nodes, edges });
};

// Build a balanced decision tree using Switch nodes
const buildTreeDecision = (depth: number) => {
  const inputFields = Array.from({ length: depth }, (_, i) => ({
    id: `p${i}`,
    key: `p${i}`,
    type: 'number',
    name: `p${i}`
  }));
  const nodes: any[] = [
    {
      id: 'start',
      type: 'inputNode',
      name: 'Start',
      position: { x: 0, y: 0 },
      content: { fields: inputFields }
    },
    { id: 'out', type: 'outputNode', name: 'Result', position: { x: 0, y: 0 }, content: {} }
  ];
  const edges: any[] = [];

  let counter = 0;
  const addNode = (level: number, parent: string, sourcePort?: string) => {
    const id = `s${counter++}`;
    nodes.push({
      id,
      type: 'switchNode',
      name: `S${id}`,
      position: { x: 0, y: 0 },
      content: {
        hitPolicy: 'first',
        statements: [
          { id: `${id}_l`, condition: `p${level} < 500` },
          { id: `${id}_r`, condition: 'true' }
        ]
      }
    });
    edges.push({ id: `e_${parent}_${id}`, type: 'edge', sourceId: parent, ...(sourcePort ? { sourcePort } : {}), targetId: id });
    if (level + 1 >= depth) {
      edges.push({ id: `e_${id}_l_out`, type: 'edge', sourceId: id, sourcePort: `${id}_l`, targetId: 'out' });
      edges.push({ id: `e_${id}_r_out`, type: 'edge', sourceId: id, sourcePort: `${id}_r`, targetId: 'out' });
    } else {
      addNode(level + 1, id, `${id}_l`);
      addNode(level + 1, id, `${id}_r`);
    }
  };

  addNode(0, 'start');
  return engine.createDecision({ nodes, edges });
};

const jsTree = (part: Record<string, number>, depth: number) => {
  let idx = 0;
  for (let i = 0; i < depth; i++) {
    idx = idx * 2 + (part[`p${i}`] < 500 ? 1 : 2);
  }
  return idx;
};
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

      // Serve benchmark assets
      if (req.method === 'GET' && url.pathname === '/benchmark') {
        const file = Bun.file('public/benchmark.html');
        return new Response(file, { headers: { 'Content-Type': 'text/html' } });
      }

      if (req.method === 'GET' && (url.pathname === '/benchmark.js' || url.pathname === '/benchmark.css')) {
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
          return new Response(
            JSON.stringify({ error: 'key and parts are required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
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
        console.error('Analyze error', err);
        return new Response(
          JSON.stringify({ error: err.message || String(err) }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

      // Performance benchmark
      if (req.method === 'POST' && url.pathname === '/benchmark') {
        try {
          const body = await req.json();
          const parts = body.parts as any[];
          const depth = Number(body.depth) || (parts[0] ? Object.keys(parts[0]).length : 0);
          if (!Array.isArray(parts) || depth === 0) {
            return new Response(
              JSON.stringify({ error: 'parts are required' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }
          // Build decision tree and measure build time
          let start = performance.now();
          const treeDecision = buildTreeDecision(depth);
          let end = performance.now();
          const treeBuild = end - start;

          // Precompile decision
          start = performance.now();
          treeDecision.validate();
          end = performance.now();
          const treeCompile = end - start;

          // JS baseline
          start = performance.now();
          for (const item of parts) {
            jsTree(item, depth);
          }
          end = performance.now();
          const jsTime = end - start;

          // Evaluate decision tree
          start = performance.now();
          for (const p of parts) {
            await treeDecision.evaluate(p);
          }
          end = performance.now();
          const treeTime = end - start;

          return new Response(
            JSON.stringify({
              js: jsTime,
              tree: treeTime,
              build: { tree: treeBuild },
              compile: { tree: treeCompile }
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        } catch (err: any) {
          console.error('Benchmark error', err);
          return new Response(
            JSON.stringify({ error: err.message || String(err) }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

    return new Response('Not found', { status: 404 });
  }
});

console.log('Server running on http://localhost:3000');

