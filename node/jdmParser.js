function setByPath(obj, path, value) {
  const parts = path.split('.');
  let target = obj;
  while (parts.length > 1) {
    const key = parts.shift();
    if (typeof target[key] !== 'object' || target[key] === null) {
      target[key] = {};
    }
    target = target[key];
  }
  target[parts[0]] = value;
}

function merge(target, src) {
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

export function buildJsHandler(jdm) {
  const nodes = new Map(jdm.nodes.map((n) => [n.id, n]));
  const edges = jdm.edges || [];
  const inputNode = jdm.nodes.find((n) => n.type === 'inputNode');
  const outputNodes = jdm.nodes.filter((n) => n.type === 'outputNode');
  if (!inputNode) return null;

  const outgoing = new Map();
  const indegree = new Map();
  const edgesBySource = new Map();
  for (const n of jdm.nodes) {
    outgoing.set(n.id, []);
    indegree.set(n.id, 0);
  }
  for (const e of edges) {
    outgoing.get(e.sourceId)?.push(e.targetId);
    indegree.set(e.targetId, (indegree.get(e.targetId) || 0) + 1);
    if (!edgesBySource.has(e.sourceId)) edgesBySource.set(e.sourceId, []);
    edgesBySource.get(e.sourceId).push(e);
  }

  const order = [];
  const queue = [inputNode.id];
  while (queue.length) {
    const id = queue.shift();
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

  const guards = new Map();
  guards.set(inputNode.id, {});
  const stack = [inputNode.id];
  while (stack.length) {
    const id = stack.pop();
    const base = guards.get(id);
    for (const e of edgesBySource.get(id) || []) {
      const next = e.targetId;
      const nextGuard = { ...base };
      if (nodes.get(id)?.type === 'switchNode' && e.sourceHandle) {
        nextGuard[id] = e.sourceHandle;
      }
      if (!guards.has(next)) {
        guards.set(next, nextGuard);
        stack.push(next);
      }
    }
  }

  const outputSources = new Set(
    edges
      .filter((e) => outputNodes.some((o) => o.id === e.targetId))
      .map((e) => e.sourceId)
  );
  const switchOutputs = new Map();
  for (const e of edges) {
    if (
      e.sourceHandle &&
      outputNodes.some((o) => o.id === e.targetId)
    ) {
      if (!switchOutputs.has(e.sourceId)) switchOutputs.set(e.sourceId, new Set());
      switchOutputs.get(e.sourceId).add(e.sourceHandle);
    }
  }

  const fns = order.map((n) => {
    const guard = guards.get(n.id) || {};
    let impl = null;
    switch (n.type) {
      case 'functionNode': {
        const src =
          typeof n.content === 'string'
            ? n.content
            : typeof n.content?.source === 'string'
            ? n.content.source
            : null;
        if (src) {
          try {
            const body = src.replace(/\bexport\s+/g, '');
            const fn = new Function(`${body}; return handler;`)();
            impl = async (ctx) => fn(ctx, {});
          } catch {
            impl = null;
          }
        }
        break;
      }
      case 'expressionNode': {
        try {
          const helpers = {
            sum: (arr) => arr.reduce((a, b) => a + b, 0),
            filter: (arr, fn) => arr.filter(fn),
            map: (arr, fn) => arr.map(fn),
            reduce: (arr, fn, init) => arr.reduce(fn, init),
          };
          const exps = n.content?.expressions || [];
          const compiled = exps.map((e) => {
            let val = typeof e.value === 'string' ? e.value : '';
            val = val.replace(/filter\(([^,]+),\s*([^()]+)\)/g, (_, arr, expr) =>
              `filter(${arr}, (item) => ${expr.replace(/#/g, 'item')})`
            );
            val = val.replace(/map\(([^,]+),\s*([^()]+)\)/g, (_, arr, expr) =>
              `map(${arr}, (item) => ${expr.replace(/#/g, 'item')})`
            );
            val = val.replace(/reduce\(([^,]+),\s*([^,]+),\s*([^()]+)\)/g, (_, arr, expr, init) =>
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
          impl = async (ctx) => {
            const result = {};
            for (const { key, fn } of compiled) {
              setByPath(result, key, fn(ctx, helpers));
            }
            return result;
          };
        } catch {
          impl = null;
        }
        break;
      }
      case 'decisionTableNode': {
        const content = n.content || {};
        const inputs = content.inputs || [];
        const outputs = content.outputs || [];
        const rules = content.rules || [];
        try {
          const compiledRules = rules.map((r) => {
            const conds = inputs.map((inp) => {
              const raw = r[inp.id];
              if (raw === undefined || raw === '') return null;
              let expr = '';
              if (typeof raw === 'string') {
                const trimmed = raw.trim().replace(/_/g, '');
                const range = trimmed.match(/^\[(.+)\.\.(.+)\]$/);
                if (range) {
                  expr = `${inp.field} >= ${range[1]} && ${inp.field} <= ${range[2]}`;
                } else {
                  let arr;
                  const normalized = trimmed.replace(/'/g, '"');
                  try {
                    arr = JSON.parse(`[${normalized}]`);
                  } catch {}
                  if (
                    Array.isArray(arr) &&
                    arr.every((v) => ['string', 'number', 'boolean'].includes(typeof v))
                  ) {
                    const arrExpr = `[${arr.map((v) => JSON.stringify(v)).join(',')}]`;
                    expr = `${arrExpr}.includes(${inp.field})`;
                  } else if (/^endsWith\(\$,\s*(.+)\)$/.test(trimmed)) {
                    const arg = trimmed.match(/^endsWith\(\$,\s*(.+)\)$/)[1].replace(/'/g, '"');
                    expr = `${inp.field}.endsWith(${arg})`;
                  } else if (/^startsWith\(\$,\s*(.+)\)$/.test(trimmed)) {
                    const arg = trimmed.match(/^startsWith\(\$,\s*(.+)\)$/)[1].replace(/'/g, '"');
                    expr = `${inp.field}.startsWith(${arg})`;
                  } else if (/^['"].*['"]$/.test(trimmed)) {
                    expr = `${inp.field} === ${normalized}`;
                  } else if (trimmed.includes('$')) {
                    expr = trimmed.replace(/\$/g, inp.field);
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
              .map((out) => {
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
          impl = async (ctx) => {
            for (const rule of compiledRules) {
              let match = true;
              for (const cond of rule.conds) {
                if (cond && !cond(ctx)) {
                  match = false;
                  break;
                }
              }
              if (match) {
                const result = {};
                for (const out of rule.outs) {
                  setByPath(result, out.key, out.fn(ctx));
                }
                return result;
              }
            }
            return {};
          };
        } catch {
          impl = null;
        }
        break;
      }
      case 'switchNode': {
        try {
          const stmts = n.content?.statements || [];
          const compiled = stmts.map((s) => {
            if (!s.condition) return { id: s.id, fn: null };
            try {
              return {
                id: s.id,
                fn: new Function('input', `with(input){ return (${s.condition}); }`),
              };
            } catch {
              return { id: s.id, fn: () => false };
            }
          });
          impl = async (ctx) => {
            let chosen = null;
            for (const { id, fn } of compiled) {
              if (!fn || fn(ctx)) {
                ctx[`__switch_${n.id}`] = id;
                chosen = id;
                break;
              }
            }
            if (chosen && switchOutputs.get(n.id)?.has(chosen)) {
              const out = {};
              for (const key of Object.keys(ctx)) {
                if (!key.startsWith('__switch_')) out[key] = ctx[key];
              }
              return out;
            }
            return {};
          };
        } catch {
          impl = null;
        }
        break;
      }
      default:
        impl = async () => ({});
    }
    return async (ctx) => {
      for (const [sid, handle] of Object.entries(guard)) {
        if (ctx[`__switch_${sid}`] !== handle) return {};
      }
      return impl(ctx);
    };
  });

  const handlers = order
    .map((n, i) => ({ id: n.id, fn: fns[i] }))
    .filter((h) => !!h.fn);

  return async (input) => {
    const ctx = JSON.parse(JSON.stringify(input));
    const output = {};
    if (outputSources.has(inputNode.id)) merge(output, ctx);
    for (const { id, fn } of handlers) {
      const res = await fn(ctx);
      if (res && typeof res === 'object') {
        merge(ctx, res);
        if (outputSources.has(id)) merge(output, res);
      }
    }
    return output;
  };
}

