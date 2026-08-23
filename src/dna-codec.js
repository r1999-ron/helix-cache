import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const BASES = ['A', 'C', 'G', 'T'];
const BITS = { A: 0, C: 1, G: 2, T: 3 };

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function bytesToDna(buffer) {
  let dna = '';
  for (const byte of buffer) {
    dna += BASES[(byte >> 6) & 3] + BASES[(byte >> 4) & 3] + BASES[(byte >> 2) & 3] + BASES[byte & 3];
  }
  return dna;
}

export function dnaToBytes(dna) {
  if (dna.length % 4) throw new Error('DNA payload length is not divisible by four');
  const output = Buffer.alloc(dna.length / 4);
  for (let i = 0; i < dna.length; i += 4) {
    const values = [...dna.slice(i, i + 4)].map((base) => BITS[base]);
    if (values.some((value) => value === undefined)) throw new Error('DNA payload contains an invalid base');
    output[i / 4] = (values[0] << 6) | (values[1] << 4) | (values[2] << 2) | values[3];
  }
  return output;
}

export function encode(buffer, { strandLength = 160, copies = 3 } = {}) {
  const compressed = gzipSync(buffer);
  const dna = bytesToDna(compressed);
  const strands = [];
  for (let offset = 0, fragment = 0; offset < dna.length; offset += strandLength, fragment++) {
    const sequence = dna.slice(offset, offset + strandLength);
    for (let copy = 0; copy < copies; copy++) strands.push({ fragment, copy, sequence });
  }
  return {
    metadata: { version: 1, codec: 'gzip-2bit-rep3', originalBytes: buffer.length, compressedBytes: compressed.length, sha256: sha256(buffer), strandLength, copies, fragments: Math.ceil(dna.length / strandLength) },
    strands
  };
}

function consensus(sequences) {
  const maxLength = Math.max(...sequences.map((item) => item.length));
  let output = '';
  for (let index = 0; index < maxLength; index++) {
    const counts = new Map();
    for (const sequence of sequences) {
      const base = sequence[index];
      if (base) counts.set(base, (counts.get(base) || 0) + 1);
    }
    output += [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return output;
}

export function decode(archive) {
  const fragments = new Map();
  for (const strand of archive.strands) {
    if (!fragments.has(strand.fragment)) fragments.set(strand.fragment, []);
    fragments.get(strand.fragment).push(strand.sequence);
  }
  if (fragments.size !== archive.metadata.fragments) throw new Error('DNA archive is missing fragments');
  const dna = [...fragments.entries()].sort((a, b) => a[0] - b[0]).map(([, sequences]) => consensus(sequences)).join('');
  const result = gunzipSync(dnaToBytes(dna));
  if (sha256(result) !== archive.metadata.sha256) throw new Error('DNA archive checksum verification failed');
  return result;
}

export function toFasta(archive) {
  const header = `;helixcache ${Buffer.from(JSON.stringify(archive.metadata)).toString('base64url')}`;
  return header + '\n' + archive.strands.map((item) => `>fragment_${String(item.fragment).padStart(6, '0')}_copy_${item.copy}\n${item.sequence}`).join('\n') + '\n';
}

export function fromFasta(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines[0].startsWith(';helixcache ')) throw new Error('Invalid HelixCache FASTA header');
  const metadata = JSON.parse(Buffer.from(lines[0].slice(12), 'base64url').toString());
  const strands = [];
  for (let i = 1; i < lines.length; i += 2) {
    const match = lines[i].match(/^>fragment_(\d+)_copy_(\d+)$/);
    if (!match || !lines[i + 1]) throw new Error('Malformed FASTA strand');
    strands.push({ fragment: Number(match[1]), copy: Number(match[2]), sequence: lines[i + 1].trim() });
  }
  return { metadata, strands };
}

export function corrupt(archive, mutations = 1) {
  const clone = structuredClone(archive);
  for (let i = 0; i < mutations; i++) {
    const strand = clone.strands[i % clone.strands.length];
    const position = (i * 37 + 11) % strand.sequence.length;
    const current = strand.sequence[position];
    const replacement = BASES[(BASES.indexOf(current) + 1) % 4];
    strand.sequence = strand.sequence.slice(0, position) + replacement + strand.sequence.slice(position + 1);
  }
  return clone;
}

export function analyze(archive) {
  const sequence = archive.strands.map((strand) => strand.sequence).join('');
  const gc = [...sequence].filter((base) => base === 'G' || base === 'C').length;
  let longestHomopolymer = 0;
  for (const strand of archive.strands) {
    const runs = strand.sequence.match(/(.)\1*/g) || [];
    longestHomopolymer = Math.max(longestHomopolymer, ...runs.map((run) => run.length));
  }
  return {
    originalBytes: archive.metadata.originalBytes,
    compressedBytes: archive.metadata.compressedBytes,
    fragments: archive.metadata.fragments,
    physicalStrands: archive.strands.length,
    dnaBases: sequence.length,
    gcPercent: Number((gc / sequence.length * 100).toFixed(2)),
    longestHomopolymer,
    checksum: archive.metadata.sha256
  };
}
