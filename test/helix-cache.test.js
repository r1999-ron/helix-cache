import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HelixCache } from '../src/helix-cache.js';

test('archives, restores, and predicts dependencies', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'helixcache-'));
  try {
    const cache = await new HelixCache(root).init();
    await cache.register({ id: 'address-agent-2024', content: 'adapter', accessCount: 1, lastAccessDays: 200, predictedDemand: .01, businessPriority: .2, tier: 'DNA' });
    const result = await cache.prefetch('analyze address failures from 2024');
    assert.deepEqual(result.predicted, ['address-agent-2024']);
    assert.equal(cache.registry['address-agent-2024'].tier, 'SSD');
    assert.equal(result.prefetched[0].checksumVerified, true);
  } finally { await rm(root, { recursive: true }); }
});

test('real binary files survive DNA archive, corruption experiment, and download', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'helixcache-'));
  try {
    const cache = await new HelixCache(root).init();
    const original = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 251));
    await cache.register({ id: 'my-real-file', contentBase64: original.toString('base64'), originalName: 'sample.dat', tier: 'SSD' });
    await cache.move('my-real-file', 'DNA');
    const experiment = await cache.dnaExperiment('my-real-file', 20);
    assert.equal(experiment.recovered, true);
    assert.equal(experiment.mutations, 20);
    const restored = await cache.readArtifact('my-real-file');
    assert.deepEqual(restored.data, original);
  } finally { await rm(root, { recursive: true }); }
});

test('prefetch benchmark reports the overlap benefit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'helixcache-'));
  try {
    const cache = await new HelixCache(root).init();
    await cache.register({ id: 'legal-archive-2024', content: 'model', tier: 'DNA' });
    const result = cache.benchmark('compare legal archive from 2024');
    assert.equal(result.dependencies[0].tier, 'DNA');
    assert.ok(result.withPrefetchMs < result.withoutPrefetchMs);
    assert.equal(result.savedMs, 1200);
  } finally { await rm(root, { recursive: true }); }
});
