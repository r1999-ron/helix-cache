import { DatabaseSync } from 'node:sqlite';

export class MetadataStore {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, type TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS measurements (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, operation TEXT NOT NULL,
        artifact_id TEXT, latency_ms REAL NOT NULL, cost_usd REAL NOT NULL DEFAULT 0,
        cache_hit INTEGER, prefetched INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS measurements_operation ON measurements(operation, at);
    `);
    this.putArtifactStmt = this.db.prepare('INSERT INTO artifacts(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data');
  }
  artifacts() { return Object.fromEntries(this.db.prepare('SELECT id,data FROM artifacts').all().map(({ id, data }) => [id, JSON.parse(data)])); }
  putArtifact(value) { this.putArtifactStmt.run(value.id, JSON.stringify(value)); }
  deleteArtifacts() { this.db.exec('DELETE FROM artifacts; DELETE FROM events; DELETE FROM measurements;'); }
  event(type, detail) { this.db.prepare('INSERT INTO events(at,type,detail) VALUES(?,?,?)').run(new Date().toISOString(), type, detail); }
  events(limit = 100) { return this.db.prepare('SELECT at,type,detail FROM events ORDER BY seq DESC LIMIT ?').all(limit); }
  measure({ operation, artifactId = null, latencyMs, costUsd = 0, cacheHit = null, prefetched = false, consumed = false, detail = null }) {
    this.db.prepare('INSERT INTO measurements(at,operation,artifact_id,latency_ms,cost_usd,cache_hit,prefetched,consumed,detail) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(new Date().toISOString(), operation, artifactId, latencyMs, costUsd, cacheHit === null ? null : Number(cacheHit), Number(prefetched), Number(consumed), detail && JSON.stringify(detail));
  }
  consumePrefetch(id) { this.db.prepare("UPDATE measurements SET consumed=1 WHERE seq=(SELECT seq FROM measurements WHERE artifact_id=? AND prefetched=1 AND consumed=0 ORDER BY seq DESC LIMIT 1)").run(id); }
  metrics() {
    const row = this.db.prepare(`SELECT COUNT(*) operations, COALESCE(AVG(latency_ms),0) avg_latency_ms,
      COALESCE(SUM(cost_usd),0) cost_usd, COALESCE(SUM(CASE WHEN cache_hit=1 THEN 1 ELSE 0 END),0) hits,
      COALESCE(SUM(CASE WHEN cache_hit IS NOT NULL THEN 1 ELSE 0 END),0) cache_lookups,
      COALESCE(SUM(CASE WHEN prefetched=1 THEN 1 ELSE 0 END),0) prefetched,
      COALESCE(SUM(CASE WHEN prefetched=1 AND consumed=0 THEN 1 ELSE 0 END),0) waste FROM measurements`).get();
    return { operations: Number(row.operations), wallClockLatencyMs: Number(Number(row.avg_latency_ms).toFixed(3)), costUsd: Number(Number(row.cost_usd).toFixed(8)), cacheHitRate: row.cache_lookups ? Number((row.hits / row.cache_lookups).toFixed(4)) : 0, prefetchWasteRate: row.prefetched ? Number((row.waste / row.prefetched).toFixed(4)) : 0, prefetched: Number(row.prefetched), wastedPrefetches: Number(row.waste) };
  }
  close() { this.db.close(); }
}
