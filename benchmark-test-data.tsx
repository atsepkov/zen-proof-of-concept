import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const setByPath = (obj: any, path: string, value: any) => {
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
};

const App = () => {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [count, setCount] = useState(100);
  const [items, setItems] = useState<any[]>([]);
  const [results, setResults] = useState<any | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetch('/test-data')
      .then((r) => r.json())
      .then((d) => setFiles(d));
  }, []);

  const generate = async () => {
    if (!selected) return;
    const res = await fetch(`/test-data/${selected}`);
    const jdm = await res.json();

    const props = new Set<string>();
    const arrays = new Set<string>();
    const strings = new Set<string>();
    const src = JSON.stringify(jdm);
    const reserved = new Set([
      'true',
      'false',
      'null',
      'undefined',
      'sum',
      'filter',
      'map',
      'reduce'
    ]);
    // Match direct references like input.foo or input.bar.baz
    for (const m of src.matchAll(/input\.([a-zA-Z0-9_.]+)/g)) {
      props.add(m[1]);
    }
    // Include decision table input fields, switch node conditions, and expression references
    for (const n of jdm.nodes || []) {
      if (n.type === 'inputNode') {
        if (typeof n.name === 'string') props.add(n.name);
      } else if (n.type === 'decisionTableNode') {
        for (const inp of n.content?.inputs || []) {
          if (typeof inp.field === 'string') props.add(inp.field);
          // check rules for string comparisons
          const rules = n.content?.rules || [];
          for (const r of rules) {
            const cond = r[inp.id];
            if (typeof cond === 'string' && /['"]/g.test(cond)) {
              strings.add(inp.field);
            }
          }
        }
      } else if (n.type === 'switchNode') {
        for (const st of n.content?.statements || []) {
          const cond = typeof st.condition === 'string' ? st.condition : '';
          const cleaned = cond.replace(/(['"])(?:\\.|[^\\])*?\1/g, '');
          for (const m of cleaned.match(/[a-zA-Z_][a-zA-Z0-9_.]*/g) || []) {
            if (!reserved.has(m)) {
              props.add(m);
            }
          }
          // detect string operations like color == 'red'
          const stringPatterns = [
            /([a-zA-Z0-9_.]+)\s*(?:===|==|!==|!=)\s*(['"][^'"]*['"])/g,
            /(['"][^'"]*['"])\s*(?:===|==|!==|!=)\s*([a-zA-Z0-9_.]+)/g
          ];
          for (const re of stringPatterns) {
            let m;
            while ((m = re.exec(cond)) !== null) {
              const id = m[1].startsWith("'") || m[1].startsWith('"') ? m[2] : m[1];
              if (!reserved.has(id)) strings.add(id);
            }
          }
        }
      } else if (n.type === 'expressionNode') {
        for (const exp of n.content?.expressions || []) {
          const val = typeof exp.value === 'string' ? exp.value : '';
          for (const fn of ['sum', 'filter', 'map', 'reduce']) {
            const re = new RegExp(`${fn}\\(([a-zA-Z0-9_.]+)`, 'g');
            let m;
            while ((m = re.exec(val)) !== null) {
              const prop = m[1];
              if (!reserved.has(prop)) {
                props.add(prop);
                arrays.add(prop);
              }
            }
          }
          // detect string concatenation and comparisons
          const stringPatterns = [
            /([a-zA-Z0-9_.]+)\s*\+\s*(['"][^'"]*['"])/g,
            /(['"][^'"]*['"])\s*\+\s*([a-zA-Z0-9_.]+)/g,
            /([a-zA-Z0-9_.]+)\s*(?:===|==|!==|!=)\s*(['"][^'"]*['"])/g,
            /(['"][^'"]*['"])\s*(?:===|==|!==|!=)\s*([a-zA-Z0-9_.]+)/g
          ];
          for (const re of stringPatterns) {
            let m;
            while ((m = re.exec(val)) !== null) {
              const id = m[1].startsWith("'") || m[1].startsWith('"') ? m[2] : m[1];
              if (!reserved.has(id)) strings.add(id);
            }
          }
          const cleaned = val.replace(/(['"])(?:\\.|[^\\])*?\1/g, '');
          for (const m of cleaned.match(/[a-zA-Z_][a-zA-Z0-9_.]*/g) || []) {
            if (!reserved.has(m)) {
              props.add(m);
            }
          }
        }
      }
    }

    const arr = Array.from({ length: count }, () => {
      const obj: any = {};
      for (const p of props) {
        if (arrays.has(p)) {
          setByPath(
            obj,
            p,
            Array.from({ length: 5 }, () => Math.floor(Math.random() * 100))
          );
        } else if (strings.has(p)) {
          setByPath(obj, p, Math.random().toString(36).slice(2, 8));
        } else {
          setByPath(obj, p, Math.floor(Math.random() * 100));
        }
      }
      return obj;
    });
    setItems(arr);
    setResults(null);
  };

  const run = async () => {
    setRunning(true);
    const res = await fetch('/benchmark/test-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: selected, parts: items })
    });
    let data: any;
    try {
      data = await res.json();
    } catch {
      data = { error: 'Invalid JSON response' };
    }
    setRunning(false);
    if (!res.ok) {
      alert(data.error || 'Benchmark failed');
      return;
    }
    setResults(data);
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '1rem' }}>
      <h2>Test Data Benchmark</h2>
      <div>
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setItems([]);
            setResults(null);
          }}
        >
          <option value="">Select JSON…</option>
          {files.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div style={{ marginTop: '0.5rem' }}>
        <label>
          Items:&nbsp;
          <input
            type="number"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            style={{ width: '5rem' }}
          />
        </label>
        <button onClick={generate} disabled={!selected} style={{ marginLeft: '0.5rem' }}>
          Generate
        </button>
      </div>
      {items.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <p>Generated {items.length} items.</p>
          <button onClick={run} disabled={running} style={{ opacity: running ? 0.5 : 1 }}>
            {running ? 'Running…' : 'Run Benchmark'}
          </button>
        </div>
      )}
      {results && (
        <div style={{ marginTop: '1rem' }}>
          <p>JS: {results.js.toFixed(3)} ms</p>
          <p>Zen: {results.zen.toFixed(3)} ms</p>
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
