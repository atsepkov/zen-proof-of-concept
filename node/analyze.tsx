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
  const [count, setCount] = useState(5);
  const [props, setProps] = useState<PropDef[]>([
    { name: 'weight', type: 'number', min: 1, max: 10 },
    { name: 'cost', type: 'number', min: 10, max: 100 },
    {
      name: 'origin_country',
      type: 'string',
      values: ['US', 'CN', 'MX', 'CA']
    }
  ]);
  const [parts, setParts] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);

  const updateProp = (index: number, field: keyof PropDef, value: any) => {
    setProps((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };

  const addProp = () =>
    setProps((p) => [...p, { name: '', type: 'number', min: 0, max: 0 }]);
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
                ? {
                    name: f.key || f.name,
                    type: 'string',
                    values: ['US', 'CN', 'MX', 'CA']
                  }
                : {
                    name: f.key || f.name,
                    type: 'number',
                    min: 0,
                    max: 10
                  }
            )
          );
        }
      } catch {
        /* ignore */
      }
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
    setResults([]);
  };

  const analyze = async () => {
    const res = await fetch('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: rule, parts })
    });
    const data = await res.json();
    setResults(data);
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '1rem' }}>
      <h2>Zen Engine Analyzer</h2>
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
            style={{ width: '4rem' }}
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
          <h4>Generated Parts</h4>
          <pre>{JSON.stringify(parts, null, 2)}</pre>
          <button onClick={analyze}>Run Analysis</button>
        </div>
      )}
      {results.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h4>Results</h4>
          <table border={1} cellPadding={4}>
            <thead>
              <tr>
                <th>Input</th>
                <th>Output</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td>
                    <pre>{JSON.stringify(parts[i], null, 2)}</pre>
                  </td>
                  <td>
                    <pre>{JSON.stringify(r, null, 2)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
