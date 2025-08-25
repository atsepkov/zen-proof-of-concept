import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DecisionGraph,
  JdmConfigProvider,
  type DecisionGraphType
} from '@gorules/jdm-editor';
import '@gorules/jdm-editor/dist/style.css';

const exampleGraph: DecisionGraphType = {
  nodes: [
    {
      id: 'start',
      type: 'inputNode',
      name: 'Start',
      position: { x: 100, y: 100 },
      content: {
        fields: [
          { id: 'f1', key: 'weight', type: 'number', name: 'Weight' },
          { id: 'f2', key: 'cost', type: 'number', name: 'Cost' },
          {
            id: 'f3',
            key: 'origin_country',
            type: 'string',
            name: 'Origin Country'
          }
        ]
      }
    },
    {
      id: 'base',
      type: 'decisionTableNode',
      name: 'Base Rate',
      position: { x: 400, y: 100 },
      content: {
        hitPolicy: 'first',
        rules: [
          { i1: '< 5', o1: '5' },
          { i1: '[5..10]', o1: '8' },
          { i1: '> 10', o1: '12' }
        ],
        inputs: [{ id: 'i1', name: 'Weight', field: 'weight' }],
        outputs: [{ id: 'o1', name: 'Base', field: 'base' }]
      }
    },
    {
      id: 'intl',
      type: 'switchNode',
      name: 'International?',
      position: { x: 700, y: 100 },
      content: {
        hitPolicy: 'first',
        statements: [
          { id: 's1', condition: "origin_country != 'US'", isDefault: false },
          { id: 's2', condition: '', isDefault: true }
        ]
      }
    },
    {
      id: 'tariff',
      type: 'functionNode',
      name: 'Tariff',
      position: { x: 1000, y: 40 },
      content: {
        source: `({ cost }) => ({ tariff: cost * 0.15 })`
      }
    },
    {
      id: 'total',
      type: 'functionNode',
      name: 'Total Cost',
      position: { x: 1000, y: 180 },
      content: {
        source: `({ cost, base, tariff }) => {
  try {
    const total = Number(base) + cost * 0.1 + (tariff || 0);
    const res = { shippingCost: total };
    if (tariff) res.tariff = tariff;
    return res;
  } catch (err) {
    return { error: err.message };
  }
}`
      }
    },
    {
      id: 'output',
      type: 'outputNode',
      name: 'Result',
      position: { x: 1300, y: 100 },
      content: {}
    }
  ],
  edges: [
    { id: 'e1', type: 'edge', sourceId: 'start', targetId: 'base' },
    { id: 'e2', type: 'edge', sourceId: 'base', targetId: 'intl' },
    { id: 'e3', type: 'edge', sourceId: 'intl', sourceHandle: 's1', targetId: 'tariff' },
    { id: 'e4', type: 'edge', sourceId: 'tariff', targetId: 'total' },
    { id: 'e5', type: 'edge', sourceId: 'intl', sourceHandle: 's2', targetId: 'total' },
    { id: 'e6', type: 'edge', sourceId: 'total', targetId: 'output' }
  ]
};

const App = () => {
  const [graph, setGraph] = useState<DecisionGraphType | undefined>(exampleGraph);
  const [id, setId] = useState('shipping');
  const [status, setStatus] = useState('draft');
  const [version, setVersion] = useState('');

  const publish = async () => {
    await fetch('/rulesets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, jdm: graph })
    });
    alert('Rule saved');
  };

  const load = async () => {
    const key = version ? `${id}@${version}` : `${id}@latest`;
    const res = await fetch(`/rules/${encodeURIComponent(key)}`);
    if (res.ok) {
      const data = await res.json();
      setGraph(data as any);
      alert('Rule loaded');
    } else {
      alert('Rule not found');
    }
  };

  return (
    <JdmConfigProvider>
      <div style={{ height: '80vh' }}>
        <DecisionGraph value={graph} onChange={(val) => setGraph(val as any)} />
      </div>
      <div
        style={{
          padding: '12px',
          background: '#fafafa',
          display: 'flex',
          gap: '8px',
          alignItems: 'center'
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem' }}>
          Rule Name
          <input value={id} onChange={(e) => setId(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem' }}>
          Version
          <input
            value={version}
            placeholder="latest"
            onChange={(e) => setVersion(e.target.value)}
            style={{ width: '5rem' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">active</option>
            <option value="draft">draft</option>
            <option value="archived">archived</option>
          </select>
        </label>
        <button onClick={load}>Load</button>
        <button onClick={publish}>Publish</button>
      </div>
    </JdmConfigProvider>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
