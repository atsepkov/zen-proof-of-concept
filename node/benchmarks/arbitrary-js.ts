import { ZenEngine } from '@gorules/zen-engine';

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

const buildExpressionDecision = (engine: ZenEngine, propCount: number, iterations: number) => {
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

const buildTableDecision = (engine: ZenEngine, propCount: number, iterations: number) => {
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

export async function runBenchmark(
  engine: ZenEngine,
  parts: any[],
  iterations: number,
  propCount: number,
  _extra?: any
) {
  // Build decisions and capture build time
  let start = performance.now();
  const exprDecision = buildExpressionDecision(engine, propCount, iterations);
  let end = performance.now();
  const exprBuild = end - start;

  start = performance.now();
  const tableDecision = buildTableDecision(engine, propCount, iterations);
  end = performance.now();
  const tableBuild = end - start;

  // Build remote rule
  start = performance.now();
  await fetch('http://localhost:4000/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: jsHeavyPart.toString() })
  });
  end = performance.now();
  const remoteBuild = end - start;

  // Precompile decisions so evaluation doesn't include compilation
  start = performance.now();
  exprDecision.validate();
  end = performance.now();
  const exprCompile = end - start;

  start = performance.now();
  tableDecision.validate();
  end = performance.now();
  const tableCompile = end - start;

  // JS baseline
  start = performance.now();
  for (const item of parts) {
    jsHeavyPart(item, propCount, iterations);
  }
  end = performance.now();
  const jsTime = end - start;

  // Evaluate decisions sequentially to reuse compiled logic
  start = performance.now();
  for (const p of parts) {
    await exprDecision.evaluate(p);
  }
  end = performance.now();
  const exprTime = end - start;

  start = performance.now();
  for (const p of parts) {
    await tableDecision.evaluate(p);
  }
  end = performance.now();
  const tableTime = end - start;

  // Evaluate rule over HTTP for each part
  start = performance.now();
  for (const p of parts) {
    await fetch('http://localhost:4000/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part: p, propCount, iterations })
    });
  }
  end = performance.now();
  const remoteTime = end - start;

  return {
    js: jsTime,
    expression: exprTime,
    table: tableTime,
    remote: { build: remoteBuild, run: remoteTime },
    build: { expression: exprBuild, table: tableBuild },
    compile: { expression: exprCompile, table: tableCompile }
  };
}

