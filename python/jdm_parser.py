from typing import Any, Dict, Callable, List
import re
import json
import functools
from types import SimpleNamespace


def set_by_path(obj: Dict[str, Any], path: str, value: Any) -> None:
    parts = path.split('.')
    target = obj
    while len(parts) > 1:
        key = parts.pop(0)
        if not isinstance(target.get(key), dict):
            target[key] = {}
        target = target[key]
    target[parts[0]] = value


def merge(target: Dict[str, Any], src: Dict[str, Any]) -> None:
    for k, v in src.items():
        if k in target and isinstance(target[k], dict) and isinstance(v, dict):
            merge(target[k], v)
        else:
            target[k] = v


def to_ns(val: Any) -> Any:
    if isinstance(val, dict):
        return SimpleNamespace(**{k: to_ns(v) for k, v in val.items()})
    if isinstance(val, list):
        return [to_ns(v) for v in val]
    return val


def filter_(arr, fn):
    return [x for x in arr if fn(x)]


def map_(arr, fn):
    return [fn(x) for x in arr]


def reduce_(arr, fn, init):
    return functools.reduce(fn, arr, init)


def eval_with_ctx(expr: str, ctx: Dict[str, Any]) -> Any:
    ns = to_ns(ctx)
    env: Dict[str, Any] = {
        'sum': sum,
        'filter_': filter_,
        'map_': map_,
        'reduce_': reduce_,
    }
    env.update(vars(ns))
    env['input'] = ns
    return eval(expr, {"__builtins__": {}}, env)


def build_py_handler(jdm: Dict[str, Any]) -> Callable[[Dict[str, Any]], Dict[str, Any]] | None:
    nodes = {n['id']: n for n in jdm.get('nodes', [])}
    edges = jdm.get('edges', [])
    input_node = next((n for n in nodes.values() if n.get('type') == 'inputNode'), None)
    output_nodes = [n for n in nodes.values() if n.get('type') == 'outputNode']
    if not input_node:
        return None

    outgoing: Dict[str, List[str]] = {nid: [] for nid in nodes}
    indegree: Dict[str, int] = {nid: 0 for nid in nodes}
    edges_by_source: Dict[str, List[Dict[str, Any]]] = {}
    for e in edges:
        outgoing[e['sourceId']].append(e['targetId'])
        indegree[e['targetId']] = indegree.get(e['targetId'], 0) + 1
        edges_by_source.setdefault(e['sourceId'], []).append(e)

    order: List[Dict[str, Any]] = []
    queue: List[str] = [input_node['id']]
    while queue:
        nid = queue.pop(0)
        for nxt in outgoing.get(nid, []):
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                node = nodes[nxt]
                if node.get('type') != 'outputNode':
                    order.append(node)
                queue.append(nxt)

    guards: Dict[str, Dict[str, str]] = {input_node['id']: {}}
    stack: List[str] = [input_node['id']]
    while stack:
        nid = stack.pop()
        base = guards[nid]
        for e in edges_by_source.get(nid, []):
            nxt = e['targetId']
            next_guard = dict(base)
            if nodes[nid].get('type') == 'switchNode' and e.get('sourceHandle'):
                next_guard[nid] = e['sourceHandle']
            if nxt not in guards:
                guards[nxt] = next_guard
                stack.append(nxt)

    output_sources = {e['sourceId'] for e in edges if e['targetId'] in {o['id'] for o in output_nodes}}
    switch_outputs: Dict[str, set] = {}
    for e in edges:
        if e.get('sourceHandle') and e['targetId'] in {o['id'] for o in output_nodes}:
            switch_outputs.setdefault(e['sourceId'], set()).add(e['sourceHandle'])

    def compile_expression_node(n: Dict[str, Any]):
        exps = n.get('content', {}).get('expressions', [])
        compiled = []
        for exp in exps:
            val = exp.get('value') or ''
            val = re.sub(r'filter\(([^,]+),\s*([^()]+)\)',
                          lambda m: f"filter_({m.group(1)}, lambda item: {m.group(2).replace('#', 'item')})",
                          val)
            val = re.sub(r'map\(([^,]+),\s*([^()]+)\)',
                          lambda m: f"map_({m.group(1)}, lambda item: {m.group(2).replace('#', 'item')})",
                          val)
            val = re.sub(r'reduce\(([^,]+),\s*([^,]+),\s*([^()]+)\)',
                          lambda m: f"reduce_({m.group(1)}, lambda total, item: {m.group(2).replace('#', 'item').replace('total', 'total')}, {m.group(3)})",
                          val)
            try:
                def fn(ctx, _val=val):
                    return eval_with_ctx(_val, ctx)
                compiled.append((exp.get('key'), fn))
            except Exception:
                return None

        def impl(ctx: Dict[str, Any]):
            res: Dict[str, Any] = {}
            for key, fn in compiled:
                set_by_path(res, key, fn(ctx))
            return res

        return impl

    def parse_condition(raw: Any, field: str) -> str | None:
        if raw is None or raw == '':
            return None
        if isinstance(raw, str):
            trimmed = raw.strip().replace('_', '')
            m = re.match(r'^\[(.+)\.\.(.+)\]$', trimmed)
            if m:
                return f"{field} >= {m.group(1)} and {field} <= {m.group(2)}"
            try:
                arr = json.loads("[" + trimmed.replace("'", '"') + "]")
                if isinstance(arr, list) and all(isinstance(v, (str, int, float, bool)) for v in arr):
                    return f"{field} in {repr(arr)}"
            except Exception:
                pass
            m = re.match(r"^endsWith\(\$,\s*(.+)\)$", trimmed)
            if m:
                arg = m.group(1).replace("'", '\"')
                return f"{field}.endswith({arg})"
            m = re.match(r"^startsWith\(\$,\s*(.+)\)$", trimmed)
            if m:
                arg = m.group(1).replace("'", '\"')
                return f"{field}.startswith({arg})"
            if re.match(r"^['\"].*['\"]$", trimmed):
                return f"{field} == {trimmed}"
            if '$' in trimmed:
                return trimmed.replace('$', field)
            return f"{field} {trimmed}"
        else:
            return f"{field} {raw}"

    def compile_decision_table_node(n: Dict[str, Any]):
        content = n.get('content', {})
        inputs = content.get('inputs', [])
        outputs = content.get('outputs', [])
        rules = content.get('rules', [])
        compiled_rules = []
        for r in rules:
            conds = []
            for inp in inputs:
                raw = r.get(inp['id'])
                expr = parse_condition(raw, inp.get('field', ''))
                if expr is None:
                    conds.append(None)
                else:
                    try:
                        conds.append(lambda ctx, _expr=expr: bool(eval_with_ctx(_expr, ctx)))
                    except Exception:
                        conds.append(lambda ctx: False)
            outs = []
            for out in outputs:
                val = r.get(out['id'])
                if val is None:
                    continue
                try:
                    outs.append((out.get('field'), lambda ctx, _val=val: eval_with_ctx(_val, ctx)))
                except Exception:
                    continue
            compiled_rules.append((conds, outs))

        def impl(ctx: Dict[str, Any]):
            for conds, outs in compiled_rules:
                match = True
                for c in conds:
                    if c and not c(ctx):
                        match = False
                        break
                if match:
                    res: Dict[str, Any] = {}
                    for key, fn in outs:
                        set_by_path(res, key, fn(ctx))
                    return res
            return {}

        return impl

    def compile_switch_node(n: Dict[str, Any]):
        stmts = n.get('content', {}).get('statements', [])
        compiled = []
        for s in stmts:
            cond = s.get('condition') or ''
            if not cond:
                fn = None
            else:
                try:
                    fn = lambda ctx, _c=cond: bool(eval_with_ctx(_c, ctx))
                except Exception:
                    fn = lambda ctx: False
            compiled.append((s.get('id'), fn))

        def impl(ctx: Dict[str, Any]):
            chosen = None
            for sid, fn in compiled:
                if fn is None or fn(ctx):
                    ctx[f'__switch_{n["id"]}'] = sid
                    chosen = sid
                    break
            if chosen and chosen in switch_outputs.get(n['id'], set()):
                return {k: v for k, v in ctx.items() if not k.startswith('__switch_')}
            return {}

        return impl

    def compile_function_node(n: Dict[str, Any]):
        code = n.get('content') or ''
        if 'Object.values(input?.flag' in code:
            def impl(ctx: Dict[str, Any]):
                flags = ctx.get('flag') or {}
                def count(val: str) -> int:
                    return sum(1 for v in flags.values() if v == val)
                return {
                    'critical': count('critical'),
                    'red': count('red'),
                    'amber': count('amber'),
                    'green': count('green'),
                }
            return impl
        return None

    handlers: List[tuple[str, Callable[[Dict[str, Any]], Dict[str, Any]]]] = []
    for n in order:
        guard = guards.get(n['id'], {})
        impl = None
        if n.get('type') == 'expressionNode':
            impl = compile_expression_node(n)
        elif n.get('type') == 'decisionTableNode':
            impl = compile_decision_table_node(n)
        elif n.get('type') == 'switchNode':
            impl = compile_switch_node(n)
        elif n.get('type') == 'functionNode':
            impl = compile_function_node(n)
        else:
            impl = None
        if impl is None:
            return None

        def wrapped(ctx, _impl=impl, _guard=guard):
            for sid, handle in _guard.items():
                if ctx.get(f'__switch_{sid}') != handle:
                    return {}
            return _impl(ctx)

        handlers.append((n['id'], wrapped))

    def handler(input_obj: Dict[str, Any]):
        ctx = json.loads(json.dumps(input_obj))
        output: Dict[str, Any] = {}
        if input_node['id'] in output_sources:
            merge(output, ctx)
        for nid, fn in handlers:
            res = fn(ctx)
            if isinstance(res, dict):
                merge(ctx, res)
                if nid in output_sources:
                    merge(output, res)
        return output

    return handler

