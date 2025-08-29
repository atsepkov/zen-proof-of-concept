import React from 'react';
import { createRoot } from 'react-dom/client';

const App = () => (
  <div style={{ fontFamily: 'sans-serif', padding: '1rem' }}>
    <h2>Zen Benchmarks</h2>
    <ul>
      <li><a href="/benchmark-user">User JDM Benchmark</a></li>
      <li><a href="/benchmark-test-data">Test Data Benchmark</a></li>
    </ul>
  </div>
);

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
