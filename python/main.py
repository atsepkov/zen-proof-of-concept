from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from typing import List, Any
from pathlib import Path
import sqlite3
import json
import os
import time
from zen import ZenEngine
from .jdm_parser import build_py_handler

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
