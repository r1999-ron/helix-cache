const SYNONYMS = new Map(Object.entries({
  address: ['location', 'map', 'geocode', 'postal'], location: ['address', 'map', 'geocode'],
  finance: ['financial', 'money', 'market', 'banking'], legal: ['law', 'contract', 'compliance'],
  evaluation: ['eval', 'benchmark', 'test', 'dataset'], dataset: ['data', 'evaluation', 'benchmark'],
  agent: ['model', 'adapter', 'assistant'], model: ['agent', 'adapter', 'inference'],
  archive: ['history', 'cold', 'storage'], compare: ['evaluation', 'benchmark', 'versus']
}));

const tokens = (text) => String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
const hash = (value) => { let result = 2166136261; for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619); return result >>> 0; };

// A dependency-free embedding suited to small private registries. It combines
// word/synonym features with character trigrams, so it handles semantic aliases
// and identifiers without sending artifact names to an external service.
export function embed(text, dimensions = 256) {
  const vector = new Float64Array(dimensions);
  const add = (feature, weight) => { const h = hash(feature); vector[h % dimensions] += (h & 1 ? 1 : -1) * weight; };
  for (const word of tokens(text)) {
    add(`w:${word}`, 1.5);
    for (const synonym of SYNONYMS.get(word) || []) add(`w:${synonym}`, .75);
    const padded = `^${word}$`;
    for (let i = 0; i < padded.length - 2; i++) add(`c:${padded.slice(i, i + 3)}`, .18);
  }
  const norm = Math.hypot(...vector) || 1;
  return Array.from(vector, (value) => value / norm);
}

export function similarity(left, right) { return left.reduce((sum, value, index) => sum + value * right[index], 0); }

export function artifactText(artifact) {
  return [artifact.id, artifact.originalName, artifact.mimeType, artifact.description, ...(artifact.tags || [])].filter(Boolean).join(' ');
}

export function semanticPlan(request, artifacts, limit = 4) {
  const query = embed(request);
  const ranked = artifacts.map((artifact) => ({
    artifact,
    confidence: Math.max(0, similarity(query, embed(artifactText(artifact))))
  })).filter((item) => item.confidence >= .08)
    .sort((a, b) => b.confidence - a.confidence || b.artifact.predictedDemand - a.artifact.predictedDemand)
    .slice(0, limit);
  return {
    request,
    strategy: 'local-embedding',
    artifacts: ranked.map(({ artifact, confidence }, index) => ({
      id: artifact.id, confidence: Number(confidence.toFixed(4)), order: index + 1,
      action: ['S3', 'DNA'].includes(artifact.tier) ? 'prefetch-to-ssd' : 'use-in-place'
    }))
  };
}

export function placementScore(artifact, forecast, policy = 'hybrid') {
  const days = Math.max(0, (Date.now() - new Date(artifact.lastAccess)) / 86400000);
  const rule = .45 * Math.min(1, Math.log10(artifact.accessCount + 1) / 5) + .35 * Math.exp(-days / 30) + .2 * artifact.businessPriority;
  const learned = .8 * forecast + .2 * artifact.businessPriority;
  return policy === 'rule-based' ? rule : policy === 'learned' ? learned : .45 * rule + .55 * learned;
}

export function tierForScore(score) {
  if (score >= .72) return 'GPU'; if (score >= .56) return 'RAM'; if (score >= .38) return 'SSD'; if (score >= .2) return 'S3'; return 'DNA';
}
