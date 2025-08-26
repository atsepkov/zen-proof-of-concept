import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

const App = () => {
  const [propCount, setPropCount] = useState(100);
  const [partCount, setPartCount] = useState(1000);
  const [logicLen, setLogicLen] = useState(3);
  const [parts, setParts] = useState<any[]>([]);
  const [results, setResults] = useState<any | null>(null);

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
  };

  const run = async () => {
    const res = await fetch('/benchmark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts, iterations: logicLen, propCount })
    });
    const data = await res.json();
    setResults(data);
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
            onChange={(e) => setPropCount(Number(e.target.value))}
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
            onChange={(e) => setPartCount(Number(e.target.value))}
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
            onChange={(e) => setLogicLen(Number(e.target.value))}
            style={{ width: '5rem' }}
          />
        </label>
      </div>
      <div>
        <button onClick={generate}>Generate Parts</button>
      </div>
      {parts.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <p>
            Generated {parts.length} parts with {propCount} properties each and logic length {logicLen}.
          </p>
          <button onClick={run}>Run Benchmark</button>
        </div>
      )}
      {results && (
        <div style={{ marginTop: '1rem' }}>
          <h4>Results</h4>
          <p>JS: {results.js.toFixed(3)} ms</p>
          <p>Expression: {results.expression.toFixed(3)} ms</p>
          <p>Table: {results.table.toFixed(3)} ms</p>
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
