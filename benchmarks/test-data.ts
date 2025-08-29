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
        try {
          const compiledRules = rules.map((r: any) => {
            const conds = inputs.map((inp: any) => {
              const cond = r[inp.id];
              if (!cond) return null;
              let expr: string = '';
              if (typeof cond === 'string') {
                const trimmed = cond.trim();
                let arr: any;
                try {
                  arr = JSON.parse(`[${trimmed}]`);
                } catch {}
                if (
                  Array.isArray(arr) &&
                  arr.every((v: any) => ['string', 'number', 'boolean'].includes(typeof v))
                ) {
                  const arrExpr = `[${arr.map((v: any) => JSON.stringify(v)).join(',')}]`;
                  expr = `${arrExpr}.includes(${inp.field})`;
                } else {
                  expr = `${inp.field} ${cond}`;
                }
              } else {
                expr = `${inp.field} ${cond}`;
              }
              try {
                return new Function('input', `with(input){ return (${expr}); }`);
              } catch {
                return null;
              }
            });
            const outs = outputs
              .map((out: any) => {
                const val = r[out.id];
                if (val === undefined) return null;
                try {
                  const fn = new Function('input', `with(input){ return (${val}); }`);
                  return { key: out.field, fn };
                } catch {
                  return null;
                }
              })
              .filter(Boolean);
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
        } catch {
          return null;
        }
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

  const clone = (obj: any) => JSON.parse(JSON.stringify(obj));

  const jsOutputs: any[] = [];
  let start = performance.now();
  if (jsHandler) {
    for (const p of parts) {
      const out = await jsHandler(clone(p));
      jsOutputs.push(out);
    }
  }
  let end = performance.now();
  const jsTime = end - start;

  const zenOutputs: any[] = [];
  start = performance.now();
  for (const p of parts) {
    const res = await decision.evaluate(clone(p));
    zenOutputs.push((res as any)?.result ?? res);
  }
  end = performance.now();
  const zenTime = end - start;

  let mismatch: any = null;
  if (jsHandler) {
    for (let i = 0; i < parts.length; i++) {
      if (JSON.stringify(jsOutputs[i]) !== JSON.stringify(zenOutputs[i])) {
        mismatch = { index: i, js: jsOutputs[i], zen: zenOutputs[i] };
        break;
      }
    }
  }

  return {
    js: jsTime,
    zen: zenTime,
    sample: {
      input: parts[0],
      js: jsHandler ? jsOutputs[0] : null,
      zen: zenOutputs[0]
    },
    mismatch
  };
}
