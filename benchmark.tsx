import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

const App = () => {
  const [depth, setDepth] = useState(10);
  const [partCount, setPartCount] = useState(1000);
  const [parts, setParts] = useState<any[]>([]);
  const [results, setResults] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [running, setRunning] = useState(false);

  const generate = () => {
    const arr = Array.from({ length: partCount }, () => {
      const obj: any = {};
      for (let i = 0; i < depth; i++) {
        obj[`p${i}`] = Math.floor(Math.random() * 1000);
      }
      return obj;
    });
    setParts(arr);
    setResults(null);
    setRunning(false);
  };

  const run = async () => {
    setRunning(true);
    const res = await fetch('/benchmark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts, depth })
    });
    const data = await res.json();
    setResults(data);
    setHistory((h) => [
      { ts: Date.now(), params: { depth, partCount }, ...data },
      ...h,
    ]);
    setRunning(false);
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '1rem' }}>
      <h2>Zen Benchmark</h2>
      <div style={{ marginBottom: '0.5rem' }}>
        <label>
          Tree Depth:&nbsp;
          <input
            type="number"
            value={depth}
            onChange={(e) => {
              setDepth(Number(e.target.value));
              setParts([]);
              setResults(null);
            }}
            style={{ width: '5rem' }}
          />
        </label>
      </div>
      <div style={{ marginBottom: '0.5rem' }}>
        <label>
          Part Count:&nbsp;
          <input
            type="number"
            value={partCount}
            onChange={(e) => {
              setPartCount(Number(e.target.value));
              setParts([]);
              setResults(null);
            }}
            style={{ width: '6rem' }}
          />
        </label>
      </div>
      <p style={{ maxWidth: '40rem' }}>
        Generates a balanced decision tree comparing different properties at each level. Results show native
        JavaScript vs. the compiled Zen decision tree.
      </p>
      <div>
        <button onClick={generate}>Generate Parts</button>
      </div>
      {parts.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <p>
            Generated {parts.length} parts with depth {depth}.
          </p>
          <button onClick={run} disabled={running} style={{ opacity: running ? 0.5 : 1 }}>
            {running ? 'Running…' : 'Run Benchmark'}
          </button>
        </div>
      )}
      {results && (
        <div style={{ marginTop: '1rem' }}>
          <h4>Latest Result</h4>
          <p>JS: {results.js.toFixed(3)} ms</p>
          <p>
            Decision Tree: {results.tree.toFixed(3)} ms (build {results.build.tree.toFixed(3)} ms, compile{' '}
            {results.compile.tree.toFixed(3)} ms)
          </p>
        </div>
      )}
      {history.length > 1 && (
        <div style={{ marginTop: '1rem' }}>
          <h4>Previous Runs</h4>
          <ul>
            {history.slice(1).map((h) => (
              <li key={h.ts}>
                {new Date(h.ts).toLocaleTimeString()}: {h.params.partCount} parts, depth {h.params.depth}
                — JS {h.js.toFixed(3)} ms, Tree {h.tree.toFixed(3)} ms
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
