import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { encode, decode, toFasta, fromFasta, sha256, corrupt, analyze } from './dna-codec.js';
import { MetadataStore } from './database.js';
import { TierStorage } from './storage.js';
import { LoraRuntime } from './inference-runtime.js';
import { semanticPlan, placementScore, tierForScore } from './intelligence.js';

export const TIERS = ['GPU', 'RAM', 'SSD', 'S3', 'DNA'];
const latency = { GPU: 1, RAM: 5, SSD: 30, S3: 250, DNA: 2500 };
const cost = { GPU: 10, RAM: 6, SSD: 2, S3: 0.8, DNA: 0.1 };

export class HelixCache {
  constructor(root = path.resolve('data')) {
    this.root = root;
    this.registryFile = path.join(root, 'registry.json');
    this.dbFile = path.join(root, 'helixcache.sqlite');
    this.storage = new TierStorage(root);
    this.inference = new LoraRuntime();
    this.prefetchJobs = new Map();
  }

  async init() {
    await mkdir(this.root, { recursive: true });
    await this.storage.init();
    this.metadata = new MetadataStore(this.dbFile);
    this.registry = this.metadata.artifacts();
    // One-time migration from the Phase 2 JSON registry.
    if (!Object.keys(this.registry).length) {
    try {
      const legacy = JSON.parse(await readFile(this.registryFile, 'utf8'));
      this.registry = legacy;
      for (const artifact of Object.values(this.registry)) {
        artifact.originalName ||= `${artifact.id}.bin`;
        artifact.mimeType ||= 'application/octet-stream';
        this.metadata.putArtifact(artifact);
      }
    }
    catch { this.registry = {}; }
    }
    return this;
  }

  async save(artifact) { if (artifact) this.metadata.putArtifact(artifact); else for (const item of Object.values(this.registry)) this.metadata.putArtifact(item); }
  async clear() {
    for (const artifact of this.list()) await this.storage.delete(artifact.tier, artifact.id).catch(() => {});
    this.registry = {};
    this.metadata.deleteArtifacts();
  }
  emit(type, detail) { this.metadata.event(type, detail); }
  list() { return Object.values(this.registry).sort((a, b) => b.accessCount - a.accessCount); }

  fileFor(artifact, tier = artifact.tier) {
    const extension = tier === 'DNA' ? '.dna' : '.bin';
    return path.join(this.root, tier.toLowerCase(), artifact.id + extension);
  }

  async register({ id, content, contentBase64, originalName, mimeType, description = '', tags = [], sizeBytes, accessCount = 0, lastAccessDays = 0, businessPriority = 0.5, predictedDemand = 0.2, tier }) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new Error('Artifact id contains unsupported characters');
    const buffer = contentBase64 ? Buffer.from(contentBase64, 'base64') : content ? Buffer.from(content) : Buffer.alloc(sizeBytes || 1024, id.charCodeAt(0) || 1);
    const artifact = { id, originalName: originalName || `${id}.bin`, mimeType: mimeType || 'application/octet-stream', description, tags, tier: tier || 'SSD', sizeBytes: buffer.length, accessCount, lastAccess: new Date(Date.now() - lastAccessDays * 86400000).toISOString(), businessPriority, predictedDemand, checksum: sha256(buffer), retrievals: 0 };
    this.registry[id] = artifact;
    const stored = artifact.tier === 'DNA' ? Buffer.from(toFasta(encode(buffer))) : buffer;
    await this.storage.put(artifact.tier, id, stored);
    await this.save(artifact); this.emit('registered', `${id} → ${artifact.tier}`);
    return artifact;
  }

  score(artifact) {
    const days = Math.max(0, (Date.now() - new Date(artifact.lastAccess)) / 86400000);
    const frequency = Math.min(1, Math.log10(artifact.accessCount + 1) / 5);
    const recency = Math.exp(-days / 30);
    const sizePenalty = Math.min(1, artifact.sizeBytes / 1e9);
    return Number((0.28 * frequency + 0.22 * recency + 0.28 * artifact.predictedDemand + 0.22 * artifact.businessPriority - 0.1 * sizePenalty).toFixed(4));
  }

  recommendedTier(artifact) {
    const score = this.score(artifact);
    if (score >= 0.72) return 'GPU';
    if (score >= 0.56) return 'RAM';
    if (score >= 0.38) return 'SSD';
    if (score >= 0.2) return 'S3';
    return 'DNA';
  }

  forecastDemand(artifact, horizonDays = 7) {
    const history = this.metadata.accessHistory(artifact.id, 90).map((at) => new Date(at).getTime());
    if (!history.length) return Number(artifact.predictedDemand || 0);
    const now = Date.now();
    let weighted = 0, weight = 0;
    for (let week = 0; week < 12; week++) {
      const end = now - week * 7 * 86400000, start = end - 7 * 86400000;
      const decay = Math.exp(-week / 4);
      weighted += history.filter((at) => at >= start && at < end).length * decay; weight += decay;
    }
    const weeklyRate = weighted / weight;
    return Number(Math.min(1, (1 - Math.exp(-weeklyRate * horizonDays / 7))).toFixed(4));
  }

  comparePolicies() {
    const names = ['rule-based', 'learned', 'hybrid'];
    return names.map((policy) => {
      const placements = this.list().map((artifact) => {
        const forecast = this.forecastDemand(artifact), score = placementScore(artifact, forecast, policy);
        return { id: artifact.id, forecast, score: Number(score.toFixed(4)), tier: tierForScore(score), currentTier: artifact.tier };
      });
      return { policy, changes: placements.filter((item) => item.tier !== item.currentTier).length, placements };
    });
  }

  async move(id, targetTier) {
    const artifact = this.registry[id];
    if (!artifact) throw new Error(`Unknown artifact: ${id}`);
    if (!TIERS.includes(targetTier)) throw new Error(`Unknown tier: ${targetTier}`);
    if (artifact.tier === targetTier) return artifact;
    const started = performance.now();
    const stored = await this.storage.get(artifact.tier, id);
    if (!stored) throw new Error(`Hot-cache object is missing: ${id}`);
    const raw = artifact.tier === 'DNA' ? decode(fromFasta(stored.toString('utf8'))) : stored;
    const target = targetTier === 'DNA' ? Buffer.from(toFasta(encode(raw))) : raw;
    await this.storage.put(targetTier, id, target);
    await this.storage.delete(artifact.tier, id);
    const previous = artifact.tier; artifact.tier = targetTier;
    await this.save(artifact); this.emit('moved', `${id}: ${previous} → ${targetTier}`);
    const elapsed = performance.now() - started;
    const costUsd = previous === 'S3' ? raw.length / 1073741824 * Number(process.env.S3_EGRESS_USD_PER_GB || 0.09) : 0;
    this.metadata.measure({ operation: 'move', artifactId: id, latencyMs: elapsed, costUsd, cacheHit: ['GPU', 'RAM'].includes(previous), detail: { source: previous, target: targetTier, bytes: raw.length } });
    return artifact;
  }

  async optimize() {
    const changes = [];
    for (const artifact of this.list()) {
      const target = this.recommendedTier(artifact);
      if (target !== artifact.tier) { await this.move(artifact.id, target); changes.push({ id: artifact.id, tier: target }); }
    }
    this.emit('optimized', `${changes.length} placement changes`); return changes;
  }

  async retrieve(id, targetTier = 'GPU') {
    const artifact = this.registry[id];
    if (!artifact) throw new Error(`Unknown artifact: ${id}`);
    const source = artifact.tier;
    const started = Date.now();
    if (source === targetTier && ['GPU', 'RAM'].includes(source)) {
      const cached = await this.storage.get(source, id);
      const hit = Boolean(cached && sha256(cached) === artifact.checksum);
      this.metadata.measure({ operation: 'cache-lookup', artifactId: id, latencyMs: Date.now() - started, cacheHit: hit, detail: { tier: source } });
      if (!hit) throw new Error(`Hot-cache object is missing or corrupt: ${id}`);
    } else await this.move(id, targetTier);
    artifact.lastAccess = new Date().toISOString(); artifact.accessCount++; artifact.retrievals++;
    this.metadata.recordAccess(id, artifact.lastAccess);
    await this.save(artifact); this.metadata.consumePrefetch(id);
    const result = { id, source, target: targetTier, elapsedMs: Date.now() - started, checksumVerified: true, sourceBackend: this.storage.backend(source), targetBackend: this.storage.backend(targetTier) };
    this.emit('retrieved', `${id}: ${source} → ${targetTier}`); return result;
  }

  async dnaExperiment(id, mutations = 12) {
    const artifact = this.registry[id];
    if (!artifact) throw new Error(`Unknown artifact: ${id}`);
    const stored = await this.storage.get(artifact.tier, id);
    const raw = artifact.tier === 'DNA' ? decode(fromFasta(stored.toString('utf8'))) : stored;
    const archive = encode(raw);
    const damaged = corrupt(archive, Math.max(0, Math.min(1000, Number(mutations) || 0)));
    const started = performance.now();
    const restored = decode(damaged);
    const elapsedMs = Number((performance.now() - started).toFixed(3));
    const recovered = restored.equals(raw);
    const metrics = analyze(archive);
    this.emit('dna-test', `${id}: ${mutations} mutations, ${recovered ? 'recovered' : 'failed'}`);
    return { id, mutations: Number(mutations), recovered, elapsedMs, ...metrics, preview: archive.strands[0]?.sequence.slice(0, 96) || '' };
  }

  async readArtifact(id) {
    const artifact = this.registry[id];
    if (!artifact) throw new Error(`Unknown artifact: ${id}`);
    const stored = await this.storage.get(artifact.tier, id);
    if (!stored) throw new Error(`Hot-cache object is missing: ${id}`);
    const data = artifact.tier === 'DNA' ? decode(fromFasta(stored.toString('utf8'))) : stored;
    if (sha256(data) !== artifact.checksum) throw new Error('Artifact checksum verification failed');
    return { artifact, data };
  }

  resolveRequest(request) {
    const plan = this.planRequest(request);
    return plan.artifacts.map((item) => this.registry[item.id]);
  }

  planRequest(request, limit = 4) { return semanticPlan(request, this.list(), limit); }

  async prefetch(request, { jobId = globalThis.crypto.randomUUID(), signal } = {}) {
    const controller = new AbortController();
    if (signal?.aborted) controller.abort();
    else if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    this.prefetchJobs.set(jobId, controller);
    const plan = this.planRequest(request), candidates = plan.artifacts.map((item) => this.registry[item.id]);
    const results = [];
    for (const item of candidates.filter((candidate) => ['S3', 'DNA'].includes(candidate.tier))) {
      if (controller.signal.aborted) break;
      results.push(await this.retrieve(item.id, 'SSD'));
    }
    for (const result of results) this.metadata.measure({ operation: 'prefetch', artifactId: result.id, latencyMs: result.elapsedMs, prefetched: true, detail: { request } });
    const cancelled = controller.signal.aborted;
    this.prefetchJobs.delete(jobId);
    this.emit(cancelled ? 'prefetch-cancelled' : 'prefetch', `${results.length} artifacts for “${request}”`);
    return { jobId, request, plan, predicted: candidates.map((item) => item.id), prefetched: results, cancelled };
  }

  cancelPrefetch(jobId) { const job = this.prefetchJobs.get(jobId); if (!job) return false; job.abort(); return true; }

  benchmark(request) {
    const predicted = this.resolveRequest(request).slice(0, 4);
    const dependencies = predicted.map((item) => ({ id: item.id, tier: item.tier, retrievalMs: latency[item.tier] }));
    const retrievalMs = Math.max(0, ...dependencies.map((item) => item.retrievalMs));
    const planningMs = 1200, loadMs = 100, inferenceMs = 500;
    const withoutPrefetchMs = planningMs + retrievalMs + loadMs + inferenceMs;
    const withPrefetchMs = Math.max(planningMs, retrievalMs) + loadMs + inferenceMs;
    const savedMs = withoutPrefetchMs - withPrefetchMs;
    return { request, dependencies, timeline: { planningMs, retrievalMs, loadMs, inferenceMs }, withoutPrefetchMs, withPrefetchMs, savedMs, improvementPercent: withoutPrefetchMs ? Number((savedMs / withoutPrefetchMs * 100).toFixed(1)) : 0 };
  }

  stats() {
    const artifacts = this.list();
    const tiers = Object.fromEntries(TIERS.map((tier) => [tier, artifacts.filter((item) => item.tier === tier).length]));
    return { artifacts: artifacts.length, tiers, estimatedStorageCost: Number(artifacts.reduce((sum, item) => sum + cost[item.tier] * item.sizeBytes / 1048576, 0).toFixed(3)), events: this.metadata.events(), measurements: this.metadata.metrics(), backends: Object.fromEntries(TIERS.map((tier) => [tier, this.storage.backend(tier)])) };
  }

  async runInference(prompt, maxNewTokens = 24) {
    const result = await this.inference.infer(prompt, maxNewTokens);
    this.metadata.measure({ operation: 'inference', latencyMs: result.wallClockLatencyMs, detail: { baseModel: result.baseModel, adapter: result.adapter } });
    this.emit('inference', `${result.adapter} · ${result.wallClockLatencyMs} ms`);
    return result;
  }

  close() { this.metadata?.close(); }
}
