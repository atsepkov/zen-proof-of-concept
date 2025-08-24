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
      id: 'input1',
      type: 'inputNode',
      name: 'Start',
      position: { x: 100, y: 100 },
      content: null
    },
    {
      id: 'expr1',
      type: 'expressionNode',
      name: 'Is adult?',
      position: { x: 400, y: 100 },
      content: {
        expressions: [
          { id: 'exp1', key: 'isAdult', value: 'input.age >= 18' }
        ],
        passThrough: false,
        inputField: null,
        outputPath: null,
        executionMode: 'single'
      }
    },
    {
      id: 'output1',
      type: 'outputNode',
      name: 'Result',
      position: { x: 700, y: 100 },
      content: null
    }
  ],
  edges: [
    { id: 'edge1', type: 'edge', sourceId: 'input1', targetId: 'expr1' },
    { id: 'edge2', type: 'edge', sourceId: 'expr1', targetId: 'output1' }
  ]
};

const App = () => {
  const [graph, setGraph] = useState<DecisionGraphType | undefined>(exampleGraph);
  const [id, setId] = useState('shipping');
  const [status, setStatus] = useState('draft');

  const publish = async () => {
    await fetch('/rulesets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, jdm: graph })
    });
    alert('Rule saved');
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
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">active</option>
            <option value="draft">draft</option>
            <option value="archived">archived</option>
          </select>
        </label>
        <button onClick={publish}>Publish</button>
      </div>
    </JdmConfigProvider>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
