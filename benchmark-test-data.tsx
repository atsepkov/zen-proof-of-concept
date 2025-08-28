import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

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
    const src = JSON.stringify(jdm);
    const props = Array.from(new Set([...src.matchAll(/input\.([a-zA-Z0-9_]+)/g)].map((m) => m[1])));
    const arr = Array.from({ length: count }, () => {
      const obj: any = {};
      for (const p of props) obj[p] = Math.floor(Math.random() * 100);
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
    const data = await res.json();
    setResults(data);
    setRunning(false);
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
