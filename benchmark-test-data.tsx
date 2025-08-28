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
      if (n.type === 'decisionTableNode') {
        for (const inp of n.content?.inputs || []) {
          if (typeof inp.field === 'string') props.add(inp.field);
        }
      } else if (n.type === 'switchNode') {
        for (const st of n.content?.statements || []) {
          const cond = typeof st.condition === 'string' ? st.condition : '';
          // strip string literals to avoid capturing quoted text
          const cleaned = cond.replace(/(['"])(?:\\.|[^\\])*?\1/g, '');
          for (const m of cleaned.match(/[a-zA-Z_][a-zA-Z0-9_.]*/g) || []) {
            if (!reserved.has(m)) {
              props.add(m);
            }
          }
        }
      } else if (n.type === 'expressionNode') {
        for (const exp of n.content?.expressions || []) {
          const val = typeof exp.value === 'string' ? exp.value : '';
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
        setByPath(obj, p, Math.floor(Math.random() * 100));
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
