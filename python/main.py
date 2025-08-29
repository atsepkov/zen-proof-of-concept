from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from typing import List, Any, Callable, Dict
from pathlib import Path
import sqlite3
import json
import os
import time
import re
import functools
from types import SimpleNamespace
from zen import ZenEngine

root = Path(__file__).resolve().parent.parent

# Initialize SQLite database and schema
conn = sqlite3.connect(root / "rules.db", check_same_thread=False)
conn.execute(
    """
    CREATE TABLE IF NOT EXISTS rulesets (
      id        TEXT NOT NULL,
      version   INTEGER NOT NULL,
      status    TEXT NOT NULL,
      jdm       TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id, version)
    );
    """
)
conn.execute(
    "CREATE INDEX IF NOT EXISTS rulesets_active_idx ON rulesets(id, status, version);"
)
conn.commit()

def loader(key: str) -> bytes:
    id, ver = key.split('@')
    cur = conn.cursor()
    if ver == 'latest':
        row = cur.execute(
            "SELECT jdm FROM rulesets WHERE id = ? AND status = 'active' ORDER BY version DESC LIMIT 1",
            (id,),
        ).fetchone()
    else:
        row = cur.execute(
            "SELECT jdm FROM rulesets WHERE id = ? AND version = ?",
            (id, int(ver)),
        ).fetchone()
    if not row:
        raise Exception(f"JDM not found for {key}")
    return row[0].encode('utf-8')

engine = ZenEngine({'loader': loader})
app = FastAPI()

# -------- Static file helpers --------
STATIC_FILES = {
    'editor.js', 'editor.css',
    'analyze.js', 'analyze.css',
    'benchmark.js', 'benchmark.css',
    'benchmark-js.js', 'benchmark-js.css',
    'benchmark-test-data.js', 'benchmark-test-data.css'
}

@app.get('/editor')
async def editor_page():
    return FileResponse(root / 'public' / 'editor.html', media_type='text/html')

@app.get('/analyze')
async def analyze_page():
    return FileResponse(root / 'public' / 'analyze.html', media_type='text/html')

@app.get('/benchmark')
async def benchmark_page():
    return FileResponse(root / 'public' / 'benchmark.html', media_type='text/html')

@app.get('/benchmark-js')
async def benchmark_js_page():
    return FileResponse(root / 'public' / 'benchmark-js.html', media_type='text/html')

@app.get('/benchmark-test-data')
async def benchmark_test_data_page():
    return FileResponse(root / 'public' / 'benchmark-test-data.html', media_type='text/html')

# -------- Test data endpoints --------
@app.get('/test-data')
async def list_test_data():
    files = [f for f in os.listdir(root / 'test-data') if f.endswith('.json')]
    return JSONResponse(files)

@app.get('/test-data/{name}')
async def get_test_data(name: str):
    path = root / 'test-data' / name
    if not path.exists():
        raise HTTPException(status_code=404, detail='Not found')
    return FileResponse(path, media_type='application/json')

# -------- Rule management --------
@app.post('/rulesets')
async def publish_ruleset(body: dict):
    id = body.get('id')
    status = body.get('status', 'draft')
    jdm = body.get('jdm')
    if not id or jdm is None:
        raise HTTPException(status_code=400, detail='id and jdm are required')
    cur = conn.cursor()
    row = cur.execute('SELECT COALESCE(MAX(version),0) + 1 FROM rulesets WHERE id = ?', (id,)).fetchone()
    version = row[0]
    cur.execute('INSERT INTO rulesets (id, version, status, jdm) VALUES (?, ?, ?, ?)',
                (id, version, status, json.dumps(jdm)))
    conn.commit()
    try:
        engine.create_decision(f"{id}@{version}")
        engine.create_decision(f"{id}@latest")
    except Exception as e:
        print('Failed to pre-create decision', e)
    return {"id": id, "version": version, "status": status}

@app.get('/rules')
async def list_rules():
    rows = conn.execute('SELECT DISTINCT id FROM rulesets ORDER BY id').fetchall()
    return [r[0] for r in rows]

@app.get('/rules/{key:path}')
async def get_rule(key: str):
    if '@' not in key:
        rows = conn.execute(
            'SELECT version, status, created_at FROM rulesets WHERE id = ? ORDER BY version DESC',
            (key,)
        ).fetchall()
        return [{"version": r[0], "status": r[1], "created_at": r[2]} for r in rows]
    try:
        data = loader(key)
        return JSONResponse(json.loads(data))
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

# -------- Analyze endpoint --------
@app.post('/analyze')
async def analyze(body: dict):
    key = body.get('key')
    parts = body.get('parts')
    if not key or not isinstance(parts, list):
        raise HTTPException(status_code=400, detail='key and parts are required')
    try:
        decision = engine.get_decision(key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    results: List[Any] = []
    for part in parts:
        try:
            res = decision.evaluate(part)
            results.append(res.get('result') if isinstance(res, dict) else res)
        except Exception as e:
            results.append({"error": str(e)})
    return results

# -------- Benchmark helpers --------
def set_by_path(obj: Dict[str, Any], path: str, value: Any) -> None:
    parts = path.split('.')
    target = obj
    for p in parts[:-1]:
        if p not in target or not isinstance(target[p], dict):
            target[p] = {}
        target = target[p]
    target[parts[-1]] = value


def merge(target: Dict[str, Any], src: Dict[str, Any]) -> None:
    for k, v in src.items():
        if (
            k in target
            and isinstance(target[k], dict)
            and isinstance(v, dict)
        ):
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

    handlers: List[tuple[str, Callable[[Dict[str, Any]], Dict[str, Any]]]] = []
    for n in order:
        if n.get('type') == 'functionNode':
            return None
        guard = guards.get(n['id'], {})
        impl = None
        if n.get('type') == 'expressionNode':
            impl = compile_expression_node(n)
        elif n.get('type') == 'decisionTableNode':
            impl = compile_decision_table_node(n)
        elif n.get('type') == 'switchNode':
            impl = compile_switch_node(n)
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

# -------- Benchmark --------
@app.post('/benchmark/test-data')
async def benchmark_test_data(body: dict):
    parts = body.get('parts')
    file = body.get('file')
    if not isinstance(parts, list) or not file:
        raise HTTPException(status_code=400, detail='parts and file are required')
    text = (root / 'test-data' / file).read_text()
    jdm = json.loads(text)
    decision = engine.create_decision(jdm)
    decision.validate()
    handler = build_py_handler(jdm)

    def clone(obj):
        return json.loads(json.dumps(obj))

    py_outputs: List[Any] = []
    py_time = 0.0
    if handler:
        start = time.perf_counter()
        for p in parts:
            py_outputs.append(handler(clone(p)))
        py_time = (time.perf_counter() - start) * 1000

    start = time.perf_counter()
    zen_outputs: List[Any] = []
    for p in parts:
        res = decision.evaluate(clone(p))
        zen_outputs.append(res.get('result') if isinstance(res, dict) else res)
    zen_time = (time.perf_counter() - start) * 1000

    mismatch = None
    if handler:
        def stable(o):
            if isinstance(o, list):
                return [stable(v) for v in o]
            if isinstance(o, dict):
                return {k: stable(o[k]) for k in sorted(o.keys())}
            return o
        for idx, (a, b) in enumerate(zip(py_outputs, zen_outputs)):
            if json.dumps(stable(a)) != json.dumps(stable(b)):
                mismatch = {'index': idx, 'python': a, 'zen': b}
                break
    else:
        mismatch = {'index': 0, 'python': None, 'zen': zen_outputs[0]}

    return {
        'python': py_time,
        'zen': zen_time,
        'sample': {'input': parts[0], 'python': py_outputs[0] if handler else None, 'zen': zen_outputs[0]},
        'mismatch': mismatch
    }

# -------- Static assets fallback --------
@app.get('/{name}')
async def static_assets(name: str):
    if name in STATIC_FILES:
        path = root / 'public' / name
        if path.exists():
            media = 'text/css' if name.endswith('.css') else 'text/javascript'
            return FileResponse(path, media_type=media)
    raise HTTPException(status_code=404, detail='Not found')
