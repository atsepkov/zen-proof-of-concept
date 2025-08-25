import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DecisionGraph,
  JdmConfigProvider,
  type DecisionGraphType
} from '@gorules/jdm-editor';
import '@gorules/jdm-editor/dist/style.css';

const clone = <T,>(val: T): T => JSON.parse(JSON.stringify(val));

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
      type: 'expressionNode',
      name: 'Base Rate',
      position: { x: 340, y: 100 },
      content: {
        expressions: [
          {
            id: 'e1',
            key: 'base',
            value: 'weight <= 5 ? 5 : weight <= 10 ? 8 : 12'
          },
          {
            id: 'b9333d19-ad3b-4c76-a623-f8ab9fe863b1',
            key: 'tariff_rate',
            value: "origin_country != 'US' ? origin_country == 'CN' ? 0.3 : 0.15 : 0"
          },
          {
            id: '35c7209d-6ef7-4f3f-b245-cab68a733dc4',
            key: '',
            value: ''
          }
        ],
        passThrough: true,
        inputField: null,
        outputPath: null,
        executionMode: 'single'
      }
    },
    {
      id: 'tariff',
      type: 'expressionNode',
      name: 'Tariff',
      position: { x: 580, y: 100 },
      content: {
        expressions: [
          {
            id: 'e332633e-044b-4c16-94e4-0c670817f755',
            key: 'shipping',
            value: 'base + weight * 2'
          },
          { id: 'e1', key: 'tariff', value: 'cost * tariff_rate' },
          {
            id: '45e10f1b-f273-4eb2-b07e-ad170b368dd2',
            key: 'total',
            value: '(weight * 5) + cost * (1 + tariff_rate)'
          }
        ],
        passThrough: true,
        inputField: null,
        outputPath: null,
        executionMode: 'single'
      }
    },
    {
      id: 'output',
      type: 'outputNode',
      name: 'Result',
      position: { x: 865, y: 100 },
      content: {}
    }
  ],
  edges: [
    { id: 'e1', type: 'edge', sourceId: 'start', targetId: 'base' },
    {
      id: '7dfe0558-aeb3-4b11-8bfd-85451378c501',
      sourceId: 'base',
      type: 'edge',
      targetId: 'tariff'
    },
    {
      id: '3f83a9de-7650-4d11-bcf6-5362186cd188',
      sourceId: 'tariff',
      type: 'edge',
      targetId: 'output'
    }
  ]
};

const App = () => {
  const [graph, setGraph] = useState<DecisionGraphType | undefined>(
    clone(exampleGraph)
  );
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
      setGraph(clone(data as any));
      alert('Rule loaded');
    } else {
      alert('Rule not found');
    }
  };

  return (
    <JdmConfigProvider>
      <div style={{ height: '80vh' }}>
        <DecisionGraph value={graph} onChange={(val) => setGraph(clone(val as any))} />
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
