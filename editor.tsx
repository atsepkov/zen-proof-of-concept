import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DecisionGraph,
  JdmConfigProvider,
  type DecisionGraphType
} from '@gorules/jdm-editor';
import '@gorules/jdm-editor/dist/style.css';

const App = () => {
  const [graph, setGraph] = useState<DecisionGraphType | undefined>();
  const [id, setId] = useState('shipping');
  const [status, setStatus] = useState('active');

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
      <div style={{ marginTop: '8px' }}>
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="rule id" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">active</option>
          <option value="draft">draft</option>
          <option value="archived">archived</option>
        </select>
        <button onClick={publish}>Publish</button>
      </div>
    </JdmConfigProvider>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
