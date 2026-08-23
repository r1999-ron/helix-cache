import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class LoraRuntime {
  constructor(env = process.env) { this.python = env.PYTHON_BIN || 'python3'; this.model = env.LORA_BASE_MODEL || 'hf-internal-testing/tiny-random-gpt2'; this.adapter = env.LORA_ADAPTER || ''; }
  infer(prompt, maxNewTokens = 24) {
    const worker = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lora_worker.py');
    const started = performance.now();
    return new Promise((resolve, reject) => {
      const child = spawn(this.python, [worker], { env: { ...process.env, LORA_BASE_MODEL: this.model, LORA_ADAPTER: this.adapter } });
      let stdout = '', stderr = ''; child.stdout.on('data', (x) => stdout += x); child.stderr.on('data', (x) => stderr += x);
      child.on('error', reject); child.on('close', (code) => { if (code) return reject(new Error(stderr.trim() || `LoRA worker exited ${code}`)); try { resolve({ ...JSON.parse(stdout), wallClockLatencyMs: Number((performance.now() - started).toFixed(3)) }); } catch { reject(new Error(`Invalid LoRA worker response: ${stdout}`)); } });
      child.stdin.end(JSON.stringify({ prompt, max_new_tokens: maxNewTokens }));
    });
  }
}
