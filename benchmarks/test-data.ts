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
  const inputNode = jdm.nodes.find((n: any) => n.type === 'inputNode');
  const outputNode = jdm.nodes.find((n: any) => n.type === 'outputNode');
  if (!inputNode) return null;

  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const n of jdm.nodes) {
    outgoing.set(n.id, []);
    indegree.set(n.id, 0);
  }
  for (const e of edges) {
    outgoing.get(e.sourceId)?.push(e.targetId);
    indegree.set(e.targetId, (indegree.get(e.targetId) || 0) + 1);
  }

  const order: any[] = [];
  const queue: string[] = [inputNode.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of outgoing.get(id) || []) {
      indegree.set(next, (indegree.get(next) || 0) - 1);
      if (indegree.get(next) === 0) {
        const node = nodes.get(next);
        if (node && node.type !== 'outputNode') {
          order.push(node);
        }
        queue.push(next);
      }
    }
  }

  const outputSources = new Set(
    edges
      .filter((e: any) => e.targetId === outputNode?.id)
      .map((e: any) => e.sourceId)
  );

  function merge(target: any, src: any) {
    for (const key of Object.keys(src)) {
      const val = src[key];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        if (!target[key] || typeof target[key] !== 'object') target[key] = {};
        merge(target[key], val);
      } else {
        target[key] = val;
      }
    }
  }

  const fns = order.map((n) => {
    switch (n.type) {
      case 'functionNode': {
        if (typeof n.content === 'string') {
          try {
            const fn = new Function(`${n.content}; return handler;`)();
            return async (ctx: any) => fn(ctx, {});
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
          return async (ctx: any) => {
            const result: any = {};
            for (const { key, fn } of compiled) {
              setByPath(result, key, fn(ctx, helpers));
            }
            return result;
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
              const raw = r[inp.id];
              if (raw === undefined || raw === '') return null;
              let expr = '';
              if (typeof raw === 'string') {
                const trimmed = raw.trim().replace(/_/g, '');
                const range = trimmed.match(/^\[(.+)\.\.(.+)\]$/);
                if (range) {
                  expr = `${inp.field} >= ${range[1]} && ${inp.field} <= ${range[2]}`;
                } else {
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
                    expr = `${inp.field} ${trimmed}`;
                  }
                }
              } else {
                expr = `${inp.field} ${raw}`;
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
          return async (ctx: any) => {
            for (const rule of compiledRules) {
              let match = true;
              for (const cond of rule.conds) {
                if (cond && !cond(ctx)) {
                  match = false;
                  break;
                }
              }
              if (match) {
                const result: any = {};
                for (const out of rule.outs) {
                  setByPath(result, out.key, out.fn(ctx));
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

  const handlers = order.map((n, i) => ({ id: n.id, fn: fns[i] }));

  return async (input: any) => {
    const ctx = JSON.parse(JSON.stringify(input));
    const output: any = {};
    if (outputSources.has(inputNode.id)) merge(output, ctx);
    for (const { id, fn } of handlers) {
      const res = await fn!(ctx);
      if (res && typeof res === 'object') {
        merge(ctx, res);
        if (outputSources.has(id)) merge(output, res);
      }
    }
    return output;
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
    const stable = (obj: any): any => {
      if (Array.isArray(obj)) return obj.map(stable);
      if (obj && typeof obj === 'object') {
        const out: any = {};
        for (const key of Object.keys(obj).sort()) {
          out[key] = stable(obj[key]);
        }
        return out;
      }
      return obj;
    };
    for (let i = 0; i < parts.length; i++) {
      if (JSON.stringify(stable(jsOutputs[i])) !== JSON.stringify(stable(zenOutputs[i]))) {
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
