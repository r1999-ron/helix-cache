import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, toFasta, fromFasta, corrupt } from '../src/dna-codec.js';

test('DNA archive round-trips arbitrary bytes through FASTA', () => {
  const input = Buffer.from(Array.from({ length: 1000 }, (_, index) => index % 256));
  const restored = decode(fromFasta(toFasta(encode(input))));
  assert.deepEqual(restored, input);
});

test('replicated strands recover from independent substitutions', () => {
  const input = Buffer.from('HelixCache survives isolated nucleotide corruption. '.repeat(20));
  assert.deepEqual(decode(corrupt(encode(input), 12)), input);
});
