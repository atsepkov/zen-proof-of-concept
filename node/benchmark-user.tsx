import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

interface PropDef {
  name: string;
  type: 'number' | 'string';
  min?: number;
  max?: number;
  values?: string[];
}

const App = () => {
  const [rule, setRule] = useState('shipping@latest');
  const [count, setCount] = useState(100);
  const [props, setProps] = useState<PropDef[]>([]);
  const [parts, setParts] = useState<any[]>([]);
  const [results, setResults] = useState<any | null>(null);
  const [running, setRunning] = useState(false);

  const updateProp = (index: number, field: keyof PropDef, value: any) => {
    setProps((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };

  const addProp = () => setProps((p) => [...p, { name: '', type: 'number', min: 0, max: 0 }]);
  const removeProp = (index: number) => setProps((p) => p.filter((_, i) => i !== index));

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/rules/${encodeURIComponent(rule)}`);
        if (!res.ok) return;
        const jdm = await res.json();
        const input = jdm.nodes?.find((n: any) => n.type === 'inputNode');
        if (input?.content?.fields?.length) {
          setProps(
            input.content.fields.map((f: any) =>
              f.type === 'string'
                ? { name: f.key || f.name, type: 'string', values: ['US', 'CN', 'MX', 'CA'] }
                : { name: f.key || f.name, type: 'number', min: 0, max: 10 }
            )
          );
        }
      } catch {}
    })();
  }, [rule]);

  const generate = () => {
    const arr = Array.from({ length: count }, () => {
      const obj: any = {};
      for (const p of props) {
        if (p.type === 'string') {
          const opts = p.values && p.values.length ? p.values : ['US'];
          obj[p.name] = opts[Math.floor(Math.random() * opts.length)];
        } else {
          const min = p.min ?? 0;
          const max = p.max ?? min;
          const val = min + Math.random() * (max - min);
          obj[p.name] = Number(val.toFixed(2));
        }
      }
      return obj;
    });
    setParts(arr);
    setResults(null);
  };

  const run = async () => {
    setRunning(true);
    const res = await fetch('/benchmark/user-jdm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: rule, parts })
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
    <div style={{ fontFamily: 'sans-serif', padding: '1rem', height: '1500px' }}>
      <h2>User JDM Benchmark</h2>
      <div style={{ marginBottom: '1rem' }}>
        <label>
          Rule Key:&nbsp;
          <input value={rule} onChange={(e) => setRule(e.target.value)} />
        </label>
      </div>
      <div style={{ marginBottom: '1rem' }}>
        <label>
          Part Count:&nbsp;
          <input
            type="number"
            value={count}
            min={1}
            onChange={(e) => setCount(Number(e.target.value))}
            style={{ width: '5rem' }}
          />
        </label>
      </div>
      <div>
        <h4>Properties</h4>
        {props.map((p, i) => (
          <div key={i} style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center' }}>
            <input
              placeholder="name"
              value={p.name}
              onChange={(e) => updateProp(i, 'name', e.target.value)}
              style={{ width: '6rem' }}
            />
            <select
              value={p.type}
              onChange={(e) => updateProp(i, 'type', e.target.value as 'number' | 'string')}
              style={{ marginLeft: '0.5rem' }}
            >
              <option value="number">number</option>
              <option value="string">string</option>
            </select>
            {p.type === 'string' ? (
              <input
                placeholder="A,B,C"
                value={(p.values || []).join(',')}
                onChange={(e) => updateProp(i, 'values', e.target.value.split(',').map((v) => v.trim()))}
                style={{ width: '8rem', marginLeft: '0.5rem' }}
              />
            ) : (
              <>
                <input
                  type="number"
                  value={p.min}
                  onChange={(e) => updateProp(i, 'min', Number(e.target.value))}
                  style={{ width: '5rem', marginLeft: '0.5rem' }}
                />
                <input
                  type="number"
                  value={p.max}
                  onChange={(e) => updateProp(i, 'max', Number(e.target.value))}
                  style={{ width: '5rem', marginLeft: '0.5rem' }}
                />
              </>
            )}
            <button onClick={() => removeProp(i)} style={{ marginLeft: '0.5rem' }}>
              x
            </button>
          </div>
        ))}
        <button onClick={addProp}>Add Property</button>
      </div>
      <div style={{ marginTop: '1rem' }}>
        <button onClick={generate}>Generate Parts</button>
      </div>
      {parts.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <p>Generated {parts.length} parts.</p>
          <button onClick={run} disabled={running} style={{ opacity: running ? 0.5 : 1 }}>
            {running ? 'Running…' : 'Run Benchmark'}
          </button>
          <h4 style={{ marginTop: '1rem' }}>Sample Input</h4>
          <pre>{JSON.stringify(parts[0], null, 2)}</pre>
        </div>
      )}
      {results && (
        <div style={{ marginTop: '1rem' }}>
          <p>JS: {results.js.toFixed(3)} ms</p>
          <p>Zen: {results.zen.toFixed(3)} ms</p>
          {results.other && (
            <p>
              Last {results.other.language === 'python' ? 'Python' : 'JS'} run: {results.other.ms.toFixed(3)} ms
            </p>
          )}
          <h4>Sample Output</h4>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div>
              <h5>JS</h5>
              <pre>{results.sample.js !== null ? JSON.stringify(results.sample.js, null, 2) : 'N/A'}</pre>
            </div>
            <div>
              <h5>Zen</h5>
              <pre>{JSON.stringify(results.sample.zen, null, 2)}</pre>
            </div>
          </div>
          {results.mismatch ? (
            <div style={{ marginTop: '1rem' }}>
              <p style={{ color: 'red' }}>Mismatch at index {results.mismatch.index}</p>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div>
                  <h5>JS</h5>
                  <pre>{JSON.stringify(results.mismatch.js, null, 2)}</pre>
                </div>
                <div>
                  <h5>Zen</h5>
                  <pre>{JSON.stringify(results.mismatch.zen, null, 2)}</pre>
                </div>
              </div>
            </div>
          ) : (
            <p>All outputs matched.</p>
          )}
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
