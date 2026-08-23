import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HelixCache } from './helix-cache.js';

const cache = await new HelixCache(process.env.DATA_ROOT || undefined).init();
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

async function seed(force = false) {
  if (force) await cache.clear();
  if (cache.list().length) return;
  const samples = [
    ['java-expert', 13500, 1, .9, .94, 'GPU'], ['maps-address-v2', 7200, 2, .85, .87, 'RAM'],
    ['finance-v4', 2500, 8, .8, .51, 'SSD'], ['legal-us-v1', 14, 70, .65, .03, 'S3'],
    ['address-agent-2024', 7, 183, .7, .04, 'DNA'], ['evaluation-dataset-2024', 2, 220, .45, .003, 'DNA']
  ];
  for (const [id, accessCount, lastAccessDays, businessPriority, predictedDemand, tier] of samples) {
    await cache.register({ id, content: JSON.stringify({ id, kind: id.includes('dataset') ? 'dataset' : 'lora-adapter', version: 1, payload: `Demo artifact for ${id}` }), accessCount, lastAccessDays, businessPriority, predictedDemand, tier });
  }
}
await seed();

const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
const body = async (req) => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString() || '{}'); };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(await readFile(path.join(publicDir, 'index.html'))); }
    if (req.method === 'GET' && url.pathname === '/app.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(await readFile(path.join(publicDir, 'app.js'))); }
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { status: 'ok', artifacts: cache.list().length });
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, { artifacts: cache.list().map((item) => ({ ...item, score: cache.score(item), recommendedTier: cache.recommendedTier(item) })), stats: cache.stats() });
    if (req.method === 'POST' && url.pathname === '/api/artifacts') return json(res, 201, await cache.register(await body(req)));
    if (req.method === 'POST' && url.pathname === '/api/optimize') return json(res, 200, { changes: await cache.optimize() });
    if (req.method === 'POST' && url.pathname === '/api/reset') { await seed(true); return json(res, 200, { artifacts: cache.list() }); }
    if (req.method === 'POST' && url.pathname === '/api/prefetch') return json(res, 200, await cache.prefetch((await body(req)).request || ''));
    if (req.method === 'POST' && url.pathname === '/api/benchmark') return json(res, 200, cache.benchmark((await body(req)).request || ''));
    if (req.method === 'POST' && url.pathname === '/api/inference') { const input = await body(req); return json(res, 200, await cache.runInference(input.prompt || '', input.maxNewTokens || 24)); }
    const retrieve = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/retrieve$/);
    if (req.method === 'POST' && retrieve) return json(res, 200, await cache.retrieve(decodeURIComponent(retrieve[1]), (await body(req)).targetTier || 'GPU'));
    const archive = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/archive$/);
    if (req.method === 'POST' && archive) return json(res, 200, await cache.move(decodeURIComponent(archive[1]), 'DNA'));
    const experiment = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/dna-experiment$/);
    if (req.method === 'POST' && experiment) return json(res, 200, await cache.dnaExperiment(decodeURIComponent(experiment[1]), (await body(req)).mutations ?? 12));
    const download = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/download$/);
    if (req.method === 'GET' && download) {
      const { artifact, data } = await cache.readArtifact(decodeURIComponent(download[1]));
      res.writeHead(200, { 'content-type': artifact.mimeType, 'content-disposition': `attachment; filename="${artifact.originalName.replace(/["\r\n]/g, '_')}"`, 'content-length': data.length });
      return res.end(data);
    }
    json(res, 404, { error: 'Not found' });
  } catch (error) { json(res, 400, { error: error.message }); }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`HelixCache is running at http://localhost:${port}`));

const shutdown = (signal) => {
  console.log(`${signal} received; closing HelixCache cleanly.`);
  server.close(() => { cache.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
