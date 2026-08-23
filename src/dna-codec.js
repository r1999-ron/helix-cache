import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const BASES = ['A', 'C', 'G', 'T'], MAGIC = Buffer.from('HC'), HEADER_BYTES = 21;
const GF_EXP = new Uint8Array(512), GF_LOG = new Uint8Array(256);
let x = 1;
for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
const mul = (a, b) => (!a || !b) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
const inv = (a) => { if (!a) throw new Error('Singular Reed–Solomon matrix'); return GF_EXP[255 - GF_LOG[a]]; };
const pow = (a, n) => n === 0 ? 1 : (!a ? 0 : GF_EXP[(GF_LOG[a] * n) % 255]);
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

function alphabet(previous, gc, position) {
  const preferGc = gc * 2 < position;
  return BASES.filter((base) => base !== previous).sort((a, b) => {
    const ag = a === 'C' || a === 'G', bg = b === 'C' || b === 'G';
    return ag === bg ? a.localeCompare(b) : (ag === preferGc ? -1 : 1);
  });
}

// A byte becomes six trits. Excluding the prior base caps homopolymers at one;
// adaptive alphabet order keeps GC close to 50% and is exactly reversible.
export function bytesToDna(buffer) {
  let dna = '', previous = '', gc = 0;
  for (const byte of buffer) {
    let value = byte; const trits = Array(6);
    for (let i = 5; i >= 0; i--) { trits[i] = value % 3; value = Math.floor(value / 3); }
    for (const trit of trits) { previous = alphabet(previous, gc, dna.length + 1)[trit]; dna += previous; if ('CG'.includes(previous)) gc++; }
  }
  return dna;
}

export function dnaToBytes(dna) {
  if (dna.length % 6) throw new Error('DNA payload length is not divisible by six');
  const output = Buffer.alloc(dna.length / 6); let previous = '', gc = 0;
  for (let offset = 0; offset < dna.length; offset += 6) {
    let value = 0;
    for (let i = 0; i < 6; i++) {
      const base = dna[offset + i], choices = alphabet(previous, gc, offset + i + 1), trit = choices.indexOf(base);
      if (trit < 0) throw new Error('DNA constraint violation');
      value = value * 3 + trit; previous = base; if ('CG'.includes(base)) gc++;
    }
    if (value > 255) throw new Error('DNA payload contains a non-canonical codeword');
    output[offset / 6] = value;
  }
  return output;
}

function row(index, k) {
  if (index < k) return Array.from({ length: k }, (_, column) => column === index ? 1 : 0);
  return Array.from({ length: k }, (_, column) => pow(index - k + 1, column));
}

function invert(matrix) {
  const n = matrix.length, work = matrix.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
  for (let column = 0; column < n; column++) {
    const pivot = work.findIndex((r, i) => i >= column && r[column]);
    if (pivot < 0) throw new Error('Not enough independent Reed–Solomon strands');
    [work[column], work[pivot]] = [work[pivot], work[column]];
    const scale = inv(work[column][column]);
    for (let c = 0; c < 2 * n; c++) work[column][c] = mul(work[column][c], scale);
    for (let r = 0; r < n; r++) if (r !== column && work[r][column]) {
      const factor = work[r][column];
      for (let c = 0; c < 2 * n; c++) work[r][c] ^= mul(factor, work[column][c]);
    }
  }
  return work.map((r) => r.slice(n));
}

function makePacket(index, k, parity, archiveTag, payload) {
  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header); header[2] = 2; header.writeUInt16BE(index, 3); header.writeUInt16BE(k, 5); header.writeUInt16BE(parity, 7);
  header.writeUInt16BE(payload.length, 9); header.writeUInt16BE(payload.length, 11); archiveTag.copy(header, 13);
  header.writeUInt32BE(crc32(Buffer.concat([header.subarray(0, 17), payload])), 17);
  return Buffer.concat([header, payload]);
}

function parsePacket(sequence) {
  const packet = dnaToBytes(sequence);
  if (packet.length < HEADER_BYTES || !packet.subarray(0, 2).equals(MAGIC) || packet[2] !== 2) throw new Error('Invalid strand header');
  const length = packet.readUInt16BE(11), payload = packet.subarray(HEADER_BYTES);
  if (length !== payload.length || crc32(Buffer.concat([packet.subarray(0, 17), payload])) !== packet.readUInt32BE(17)) throw new Error('Strand checksum verification failed');
  return { index: packet.readUInt16BE(3), dataShards: packet.readUInt16BE(5), parityShards: packet.readUInt16BE(7), shardSize: packet.readUInt16BE(9), archiveTag: packet.subarray(13, 17).toString('hex'), payload };
}

function repairAndParse(sequence, expected) {
  const candidates = [];
  if (sequence.length === expected) candidates.push(sequence);
  if (sequence.length === expected + 1) for (let i = 0; i < sequence.length; i++) candidates.push(sequence.slice(0, i) + sequence.slice(i + 1));
  if (sequence.length === expected - 1) for (let i = 0; i <= sequence.length; i++) for (const base of BASES) candidates.push(sequence.slice(0, i) + base + sequence.slice(i));
  for (const candidate of candidates) { try { return parsePacket(candidate); } catch {} }
  if (sequence.length === expected) for (let i = 0; i < sequence.length; i++) for (const base of BASES) if (base !== sequence[i]) {
    try { return parsePacket(sequence.slice(0, i) + base + sequence.slice(i + 1)); } catch {}
  }
  return null;
}

export function encode(buffer, { strandLength = 300, copies = 3, parityShards } = {}) {
  const compressed = gzipSync(buffer), shardSize = Math.max(1, Math.floor(strandLength / 6) - HEADER_BYTES), k = Math.ceil(compressed.length / shardSize);
  if (k > 255) throw new Error('Archive needs more than 255 data shards; increase strandLength');
  const parity = parityShards ?? Math.max(2, Math.ceil(k / 3));
  const data = Array.from({ length: k }, (_, i) => { const shard = Buffer.alloc(shardSize); compressed.copy(shard, 0, i * shardSize, (i + 1) * shardSize); return shard; });
  const shards = [...data];
  for (let p = 0; p < parity; p++) {
    const coefficients = row(k + p, k), shard = Buffer.alloc(shardSize);
    for (let column = 0; column < k; column++) for (let i = 0; i < shardSize; i++) shard[i] ^= mul(coefficients[column], data[column][i]);
    shards.push(shard);
  }
  const tag = createHash('sha256').update(compressed).digest().subarray(0, 4), strands = [];
  shards.forEach((payload, fragment) => {
    const sequence = bytesToDna(makePacket(fragment, k, parity, tag, payload));
    for (let copy = 0; copy < copies; copy++) strands.push({ fragment, copy, sequence });
  });
  return { metadata: { version: 2, codec: 'gzip-rs-ternary', originalBytes: buffer.length, compressedBytes: compressed.length, sha256: sha256(buffer), strandLength: (HEADER_BYTES + shardSize) * 6, copies, fragments: shards.length, dataShards: k, parityShards: parity, shardSize, archiveTag: tag.toString('hex'), maxHomopolymer: 1 }, strands };
}

export function decode(archive) {
  if (archive.metadata.version !== 2) throw new Error('Unsupported DNA archive version');
  const valid = new Map(), m = archive.metadata;
  for (const strand of archive.strands) {
    const packet = repairAndParse(strand.sequence.toUpperCase(), m.strandLength);
    if (packet && packet.archiveTag === m.archiveTag && packet.dataShards === m.dataShards && packet.parityShards === m.parityShards && packet.shardSize === m.shardSize && packet.index < m.fragments && !valid.has(packet.index)) valid.set(packet.index, packet);
  }
  if (valid.size < m.dataShards) throw new Error(`DNA archive is missing too many strands (need ${m.dataShards}, found ${valid.size})`);
  const selected = [...valid.values()].slice(0, m.dataShards), inverse = invert(selected.map((packet) => row(packet.index, m.dataShards)));
  const data = Array.from({ length: m.dataShards }, () => Buffer.alloc(m.shardSize));
  for (let r = 0; r < m.dataShards; r++) for (let c = 0; c < m.dataShards; c++) for (let i = 0; i < m.shardSize; i++) data[r][i] ^= mul(inverse[r][c], selected[c].payload[i]);
  const result = gunzipSync(Buffer.concat(data).subarray(0, m.compressedBytes));
  if (sha256(result) !== m.sha256) throw new Error('DNA archive checksum verification failed');
  return result;
}

export function toFasta(archive) {
  return `;helixcache ${Buffer.from(JSON.stringify(archive.metadata)).toString('base64url')}\n` + archive.strands.map((item) => `>strand_${String(item.fragment).padStart(6, '0')}_copy_${item.copy}\n${item.sequence}`).join('\n') + '\n';
}

export function fromFasta(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines[0].startsWith(';helixcache ')) throw new Error('Invalid HelixCache FASTA header');
  const metadata = JSON.parse(Buffer.from(lines[0].slice(12), 'base64url').toString()), strands = [];
  for (let i = 1; i < lines.length; i += 2) {
    const match = lines[i].match(/^>(?:strand|fragment)_(\d+)_copy_(\d+)$/);
    if (!match || !lines[i + 1]) throw new Error('Malformed FASTA strand');
    strands.push({ fragment: Number(match[1]), copy: Number(match[2]), sequence: lines[i + 1].trim() });
  }
  return { metadata, strands };
}

export function corrupt(archive, mutations = 1) {
  const clone = structuredClone(archive);
  for (let i = 0; i < mutations; i++) {
    const strand = clone.strands[i % clone.strands.length], position = (i * 37 + 11) % strand.sequence.length;
    strand.sequence = strand.sequence.slice(0, position) + BASES[(BASES.indexOf(strand.sequence[position]) + 1) % 4] + strand.sequence.slice(position + 1);
  }
  return clone;
}

export function analyze(archive) {
  const sequence = archive.strands.map((strand) => strand.sequence).join(''), gc = [...sequence].filter((base) => 'CG'.includes(base)).length;
  let longestHomopolymer = 0;
  for (const strand of archive.strands) for (const run of strand.sequence.match(/(.)\1*/g) || []) longestHomopolymer = Math.max(longestHomopolymer, run.length);
  return { originalBytes: archive.metadata.originalBytes, compressedBytes: archive.metadata.compressedBytes, fragments: archive.metadata.fragments, dataShards: archive.metadata.dataShards, parityShards: archive.metadata.parityShards, physicalStrands: archive.strands.length, dnaBases: sequence.length, gcPercent: Number((gc / sequence.length * 100).toFixed(2)), longestHomopolymer, checksum: archive.metadata.sha256 };
}
