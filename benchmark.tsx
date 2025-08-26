import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

const App = () => {
  const [propCount, setPropCount] = useState(100);
  const [partCount, setPartCount] = useState(1000);
  const [logicLen, setLogicLen] = useState(3);
  const [parts, setParts] = useState<any[]>([]);
  const [results, setResults] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [running, setRunning] = useState(false);

  const generate = () => {
    const arr = Array.from({ length: partCount }, () => {
      const obj: any = {};
      for (let i = 0; i < propCount; i++) {
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
      body: JSON.stringify({ parts, iterations: logicLen, propCount })
    });
    const data = await res.json();
    setResults(data);
    setHistory((h) => [
      { ts: Date.now(), params: { propCount, partCount, logicLen }, ...data },
      ...h,
    ]);
    setRunning(false);
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '1rem' }}>
      <h2>Zen Benchmark</h2>
      <div style={{ marginBottom: '0.5rem' }}>
        <label>
          Properties per Part:&nbsp;
          <input
            type="number"
            value={propCount}
            onChange={(e) => {
              setPropCount(Number(e.target.value));
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
      <div style={{ marginBottom: '0.5rem' }}>
        <label>
          Logic Length:&nbsp;
          <input
            type="number"
            value={logicLen}
            onChange={(e) => {
              setLogicLen(Number(e.target.value));
              setParts([]);
              setResults(null);
            }}
            style={{ width: '5rem' }}
          />
        </label>
      </div>
      <p style={{ maxWidth: '40rem' }}>
        <strong>Logic length</strong> is the number of times a long arithmetic formula is repeated for each
        property. The same calculation runs in native JavaScript, a Zen expression, and a Zen decision table so
        the comparisons below reflect equivalent work.
      </p>
      <div>
        <button onClick={generate}>Generate Parts</button>
      </div>
      {parts.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <p>
            Generated {parts.length} parts with {propCount} properties each and logic length {logicLen}.
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
            Expression: {results.expression.toFixed(3)} ms (build {results.build.expression.toFixed(3)} ms,
            compile {results.compile.expression.toFixed(3)} ms)
          </p>
          <p>
            Table: {results.table.toFixed(3)} ms (build {results.build.table.toFixed(3)} ms, compile{' '}
            {results.compile.table.toFixed(3)} ms)
          </p>
        </div>
      )}
      {history.length > 1 && (
        <div style={{ marginTop: '1rem' }}>
          <h4>Previous Runs</h4>
          <ul>
            {history.slice(1).map((h) => (
              <li key={h.ts}>
                {new Date(h.ts).toLocaleTimeString()}: {h.params.partCount} parts × {h.params.propCount} props, logic {h.params.logicLen}
                — JS {h.js.toFixed(3)} ms, Expr {h.expression.toFixed(3)} ms, Table {h.table.toFixed(3)} ms
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
