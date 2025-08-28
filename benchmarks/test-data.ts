import type { ZenEngine } from '@gorules/zen-engine';
import { promises as fs } from 'fs';

function setByPath(obj: any, path: string, value: any) {
  const parts = path.split('.');
  let target = obj;
  while (parts.length > 1) {
    const key = parts.shift()!;
    if (typeof target[key] !== 'object' || target[key] === null) {
      target[key] = {};
    }
    target = target[key];
  }
  target[parts[0]] = value;
}

function buildJsHandler(jdm: any): ((input: any) => Promise<any>) | null {
  const nodes = new Map(jdm.nodes.map((n: any) => [n.id, n]));
  const edges = jdm.edges || [];
  const getNext = (id: string) => edges.find((e: any) => e.sourceId === id)?.targetId;
  let node = jdm.nodes.find((n: any) => n.type === 'inputNode');
  if (!node) return null;
  const steps: any[] = [];
  while (true) {
    const nextId = getNext(node.id);
    if (!nextId) break;
    node = nodes.get(nextId);
    if (!node || node.type === 'outputNode') break;
    steps.push(node);
  }

  const fns = steps.map((n) => {
    switch (n.type) {
      case 'functionNode': {
        if (typeof n.content === 'string') {
          try {
            const fn = new Function(`${n.content}; return handler;`)();
            return async (input: any) => fn(input, {});
          } catch {
            return null;
          }
        }
        return null;
      }
      case 'expressionNode': {
        try {
          const helpers = {
            sum: (arr: any[]) => arr.reduce((a, b) => a + b, 0),
            filter: (arr: any[], fn: (item: any) => boolean) => arr.filter(fn),
            map: (arr: any[], fn: (item: any) => any) => arr.map(fn),
            reduce: (
              arr: any[],
              fn: (total: any, item: any) => any,
              init: any
            ) => arr.reduce(fn, init),
          };
          const exps = n.content?.expressions || [];
          const compiled = exps.map((e: any) => {
            let val = typeof e.value === 'string' ? e.value : '';
            val = val.replace(/filter\(([^,]+),\s*([^()]+)\)/g, (_: any, arr: string, expr: string) =>
              `filter(${arr}, (item) => ${expr.replace(/#/g, 'item')})`
            );
            val = val.replace(/map\(([^,]+),\s*([^()]+)\)/g, (_: any, arr: string, expr: string) =>
              `map(${arr}, (item) => ${expr.replace(/#/g, 'item')})`
            );
            val = val.replace(/reduce\(([^,]+),\s*([^,]+),\s*([^()]+)\)/g, (_: any, arr: string, expr: string, init: string) =>
              `reduce(${arr}, (total, item) => ${expr
                .replace(/#/g, 'item')
                .replace(/total/g, 'total')}, ${init})`
            );
            const fn = new Function(
              'input',
              'helpers',
              `with(helpers){ with(input){ return (${val}); } }`
            );
            return { key: e.key, fn };
          });
          return async (input: any) => {
            for (const { key, fn } of compiled) {
              setByPath(input, key, fn(input, helpers));
            }
            return input;
          };
        } catch {
          return null;
        }
      }
      case 'decisionTableNode': {
        const content = n.content || {};
        const inputs = content.inputs || [];
        const outputs = content.outputs || [];
        const rules = content.rules || [];
        const compiledRules = rules.map((r: any) => {
          const conds = inputs.map((inp: any) => {
            const cond = r[inp.id];
            if (!cond) return null;
            const expr = `${inp.field} ${cond}`;
            return new Function('input', `with(input){ return (${expr}); }`);
          });
          const outs = outputs.map((out: any) => {
            const val = r[out.id];
            if (val === undefined) return null;
            const fn = new Function('input', `with(input){ return (${val}); }`);
            return { key: out.field, fn };
          }).filter(Boolean);
          return { conds, outs };
        });
        return async (input: any) => {
          for (const rule of compiledRules) {
            let match = true;
            for (const cond of rule.conds) {
              if (cond && !cond(input)) {
                match = false;
                break;
              }
            }
            if (match) {
              const result: any = {};
              for (const out of rule.outs) {
                setByPath(result, out.key, out.fn(input));
              }
              return result;
            }
          }
          return {};
        };
      }
      default:
        return null;
    }
  });

  if (fns.some((f) => !f)) return null;

  return async (input: any) => {
    let ctx = input;
    for (const fn of fns) {
      ctx = await fn(ctx);
    }
    return ctx;
  };
}

export async function runBenchmark(
  engine: ZenEngine,
  parts: any[],
  _iterations: number,
  _propCount: number,
  extra: any
) {
  const file = extra.file as string;
  const text = await fs.readFile(`test-data/${file}`, 'utf8');
  const jdm = JSON.parse(text);
  const decision = engine.createDecision(jdm);
  decision.validate();

  const jsHandler = buildJsHandler(jdm);

  let start = performance.now();
  if (jsHandler) {
    for (const p of parts) {
      await jsHandler(p);
    }
  }
  let end = performance.now();
  const jsTime = end - start;

  start = performance.now();
  for (const p of parts) {
    await decision.evaluate(p);
  }
  end = performance.now();
  const zenTime = end - start;

  return { js: jsTime, zen: zenTime };
}
