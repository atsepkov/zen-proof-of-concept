import http from 'http';

// Simple service to mimic a remote rules engine for benchmarking network overhead

let ruleFn = null;

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/build') {
    const body = JSON.parse(await parseBody(req));
    const code = body.code;
    ruleFn = new Function('part', 'propCount', 'iterations', code);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'built' }));
    return;
  }
  if (req.method === 'POST' && req.url === '/run') {
    const body = JSON.parse(await parseBody(req));
    const { parts, propCount, iterations } = body;
    const fn = ruleFn;
    const start = Date.now();
    const results = parts.map((p) => fn(p, propCount, iterations));
    const ms = Date.now() - start;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ results, ms }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const port = process.env.REMOTE_PORT ? Number(process.env.REMOTE_PORT) : 4000;
server.listen(port, () => {
  console.log(`Remote rule service running on http://localhost:${port}`);
});
