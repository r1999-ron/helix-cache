import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

class MemoryCache {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key) || null; }
  async set(key, value) { this.values.set(key, Buffer.from(value)); }
  async delete(key) { this.values.delete(key); }
  async clear() { this.values.clear(); }
}

class RedisCache {
  constructor(url) { this.url = new URL(url); }
  command(parts) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.url.hostname, port: Number(this.url.port || 6379) });
      const payload = `*${parts.length}\r\n${parts.map((p) => { const b = Buffer.from(p); return `$${b.length}\r\n${b.toString()}\r\n`; }).join('')}`;
      const chunks = []; let settled = false;
      const finish = () => {
        const out = Buffer.concat(chunks); if (!out.length) return;
        let complete = out.includes('\r\n');
        if (out[0] === 36) { const split = out.indexOf('\r\n'); if (split < 0) return; const n = Number(out.subarray(1, split)); complete = n < 0 || out.length >= split + 2 + n + 2; }
        if (!complete || settled) return; settled = true; socket.end();
        if (out[0] === 45) reject(new Error(out.toString()));
        else if (out[0] === 36) { const split = out.indexOf('\r\n'); const n = Number(out.subarray(1, split)); resolve(n < 0 ? null : out.subarray(split + 2, split + 2 + n)); }
        else resolve(out);
      };
      socket.setTimeout(3000); socket.on('connect', () => socket.write(payload)); socket.on('data', (chunk) => { chunks.push(chunk); finish(); });
      socket.on('end', finish);
      socket.on('timeout', () => socket.destroy(new Error('Redis timeout'))); socket.on('error', reject);
    });
  }
  async set(key, value) { await this.command(['SET', key, Buffer.from(value).toString('base64')]); }
  async delete(key) { await this.command(['DEL', key]); }
  async clear() { await this.command(['FLUSHDB']); }
  async get(key) { const value = await this.command(['GET', key]); return value ? Buffer.from(value.toString(), 'base64') : null; }
}

export class S3Store {
  constructor({ endpoint, bucket, region = 'us-east-1', accessKey, secretKey, forcePathStyle = true }) { Object.assign(this, { endpoint: endpoint?.replace(/\/$/, ''), bucket, region, accessKey, secretKey, forcePathStyle }); }
  enabled() { return Boolean(this.endpoint && this.bucket && this.accessKey && this.secretKey); }
  async request(method, key, body = Buffer.alloc(0)) {
    if (!this.enabled()) throw new Error('S3 storage is not configured');
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    const url = new URL(this.forcePathStyle ? `${this.endpoint}/${this.bucket}/${encoded}` : `${this.endpoint}/${encoded}`);
    const now = new Date(), amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), date = amzDate.slice(0, 8), payloadHash = sha256(body);
    const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    const canonical = `${method}\n${url.pathname}\n\nhost:${headers.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n\nhost;x-amz-content-sha256;x-amz-date\n${payloadHash}`;
    const scope = `${date}/${this.region}/s3/aws4_request`, stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.secretKey}`, date), this.region), 's3'), 'aws4_request');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${createHmac('sha256', signingKey).update(stringToSign).digest('hex')}`;
    const response = await fetch(url, { method, headers, body: ['GET', 'DELETE'].includes(method) ? undefined : body });
    if (!response.ok && !(method === 'DELETE' && response.status === 404)) throw new Error(`S3 ${method} failed: ${response.status} ${await response.text()}`);
    return Buffer.from(await response.arrayBuffer());
  }
  put(key, data) { return this.request('PUT', key, data); } get(key) { return this.request('GET', key); } delete(key) { return this.request('DELETE', key); }
}

export class TierStorage {
  constructor(root, env = process.env) {
    this.root = root; this.cache = env.REDIS_URL ? new RedisCache(env.REDIS_URL) : new MemoryCache();
    this.s3 = new S3Store({ endpoint: env.S3_ENDPOINT, bucket: env.S3_BUCKET, region: env.S3_REGION, accessKey: env.S3_ACCESS_KEY_ID, secretKey: env.S3_SECRET_ACCESS_KEY, forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false' });
  }
  async init() { await Promise.all(['ssd', 'dna', 's3'].map((x) => mkdir(path.join(this.root, x), { recursive: true }))); }
  file(tier, id) { return path.join(this.root, tier.toLowerCase(), id + (tier === 'DNA' ? '.dna' : '.bin')); }
  async put(tier, id, data) { if (tier === 'GPU' || tier === 'RAM') return this.cache.set(`${tier}:${id}`, data); if (tier === 'S3' && this.s3.enabled()) return this.s3.put(`artifacts/${id}.bin`, data); return writeFile(this.file(tier, id), data); }
  async get(tier, id) { if (tier === 'GPU' || tier === 'RAM') return this.cache.get(`${tier}:${id}`); if (tier === 'S3' && this.s3.enabled()) return this.s3.get(`artifacts/${id}.bin`); return readFile(this.file(tier, id)); }
  async delete(tier, id) { if (tier === 'GPU' || tier === 'RAM') return this.cache.delete(`${tier}:${id}`); if (tier === 'S3' && this.s3.enabled()) return this.s3.delete(`artifacts/${id}.bin`); return rm(this.file(tier, id), { force: true }); }
  backend(tier) { if (['GPU', 'RAM'].includes(tier)) return process.env.REDIS_URL ? 'redis' : 'memory'; if (tier === 'S3') return this.s3.enabled() ? 's3' : 'filesystem-fallback'; return 'filesystem'; }
}
