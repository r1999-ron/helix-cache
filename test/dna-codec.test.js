import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, toFasta, fromFasta, corrupt, analyze } from '../src/dna-codec.js';

test('DNA archive round-trips arbitrary bytes through FASTA', () => {
  const input = Buffer.from(Array.from({ length: 1000 }, (_, index) => index % 256));
  const restored = decode(fromFasta(toFasta(encode(input))));
  assert.deepEqual(restored, input);
});

test('replicated strands recover from independent substitutions', () => {
  const input = Buffer.from('HelixCache survives isolated nucleotide corruption. '.repeat(20));
  assert.deepEqual(decode(corrupt(encode(input), 12)), input);
});

test('constrained encoding controls GC content and homopolymers', () => {
  const archive = encode(Buffer.from(Array.from({ length: 2048 }, (_, index) => (index * 73) % 256)));
  const metrics = analyze(archive);
  assert.ok(metrics.gcPercent >= 45 && metrics.gcPercent <= 55, `GC was ${metrics.gcPercent}%`);
  assert.equal(metrics.longestHomopolymer, 1);
});

test('Reed–Solomon parity restores missing strands using embedded indexes', () => {
  const input = Buffer.from(Array.from({ length: 1800 }, (_, index) => (index * 41 + 17) % 256));
  const archive = encode(input, { copies: 2 });
  const missing = new Set(Array.from({ length: archive.metadata.parityShards }, (_, index) => index));
  archive.strands = archive.strands
    .filter((strand) => !missing.has(strand.fragment))
    .reverse()
    .map((strand, index) => ({ ...strand, fragment: 9000 + index }));
  assert.deepEqual(decode(archive), input);
});

test('strand checksums guide recovery from insertions and deletions', () => {
  const input = Buffer.from('indel-aware molecular storage '.repeat(80));
  const archive = encode(input, { copies: 1, parityShards: 3 });
  const deletion = archive.strands[0], insertion = archive.strands[1];
  deletion.sequence = deletion.sequence.slice(0, 47) + deletion.sequence.slice(48);
  insertion.sequence = insertion.sequence.slice(0, 91) + 'A' + insertion.sequence.slice(91);
  assert.deepEqual(decode(archive), input);
});
