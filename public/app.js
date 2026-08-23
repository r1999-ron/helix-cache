const $ = (selector) => document.querySelector(selector);
const api = async (path, options = {}) => { const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options }); const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; };
const safeId = (name) => name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const bytes = (value) => value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`;
let activePrefetchJob = null;

const renderPlan = (plan, prefetched = []) => {
  const moved = new Set(prefetched.map((item) => item.id));
  $('#planner-result').innerHTML = plan.artifacts.length ? `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Artifact</th><th>Confidence</th><th>Action</th><th>Result</th></tr></thead><tbody>${plan.artifacts.map((item) => `<tr><td>${item.order}</td><td><strong>${item.id}</strong></td><td>${(item.confidence * 100).toFixed(1)}%</td><td>${item.action}</td><td>${moved.has(item.id) ? '<span class="badge">prefetched</span>' : 'planned'}</td></tr>`).join('')}</tbody></table></div>` : '<p>No semantic matches. Try mentioning location, evaluation, finance, legal, model, or dataset concepts.</p>';
};

async function render() {
  const { artifacts, stats } = await api('/api/state');
  $('#stats').innerHTML = `<div class="card"><strong>${stats.measurements.wallClockLatencyMs} ms</strong><span>mean measured latency</span></div><div class="card"><strong>${(stats.measurements.cacheHitRate*100).toFixed(1)}%</strong><span>cache-hit rate</span></div><div class="card"><strong>${(stats.measurements.prefetchWasteRate*100).toFixed(1)}%</strong><span>prefetch waste</span></div><div class="card"><strong>$${stats.measurements.costUsd.toFixed(6)}</strong><span>measured transfer cost</span></div>`;
  $('#artifacts').innerHTML = artifacts.map((a) => `<tr><td><strong>${a.id}</strong><br><small>${a.originalName} · ${bytes(a.sizeBytes)}</small></td><td><span class="badge">${a.tier}</span>${a.tier !== a.recommendedTier ? `<br><small>suggest ${a.recommendedTier}</small>` : ''}</td><td>${Math.round(a.predictedDemand * 100)}%</td><td><div class="bar"><i style="width:${a.score * 100}%"></i></div><small>${a.score.toFixed(2)}</small></td><td><div class="button-row"><button data-action="archive" data-id="${a.id}">DNA</button><button data-action="retrieve" data-id="${a.id}">GPU</button><button data-action="download" data-id="${a.id}">Download</button></div></td></tr>`).join('');
  $('#experiment-artifact').innerHTML = artifacts.map((a) => `<option value="${a.id}" ${a.tier === 'DNA' ? 'selected' : ''}>${a.id} (${a.tier})</option>`).join('');
  $('#events').innerHTML = stats.events.slice(0, 10).map((e) => `<div class="event">${e.detail}<small>${e.type} · ${new Date(e.at).toLocaleTimeString()}</small></div>`).join('') || '<p>No activity yet.</p>';
  document.querySelectorAll('[data-action]').forEach((button) => button.onclick = async () => {
    const { id, action } = button.dataset;
    if (action === 'download') { location.href = `/api/artifacts/${encodeURIComponent(id)}/download`; return; }
    button.disabled = true;
    await api(`/api/artifacts/${encodeURIComponent(id)}/${action === 'archive' ? 'archive' : 'retrieve'}`, { method: 'POST', body: '{}' });
    await render();
  });
}

$('#file').onchange = () => { const file = $('#file').files[0]; if (file) $('#upload-id').value = safeId(file.name.replace(/\.[^.]+$/, '')); };
$('#upload').onclick = async () => {
  try {
    const file = $('#file').files[0]; if (!file) throw new Error('Choose a file first.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Portfolio demo limit: 10 MB.');
    const input = new Uint8Array(await file.arrayBuffer());
    let binary = ''; for (let index = 0; index < input.length; index += 32768) binary += String.fromCharCode(...input.subarray(index, index + 32768));
    const artifact = await api('/api/artifacts', { method: 'POST', body: JSON.stringify({ id: $('#upload-id').value || safeId(file.name), contentBase64: btoa(binary), originalName: file.name, mimeType: file.type, tier: 'SSD' }) });
    $('#upload-status').textContent = `${file.name} uploaded to ${artifact.tier}. Click DNA in its table row to archive it.`; await render();
  } catch (error) { $('#upload-status').textContent = error.message; }
};
$('#experiment').onclick = async () => {
  try {
    const id = $('#experiment-artifact').value;
    const data = await api(`/api/artifacts/${encodeURIComponent(id)}/dna-experiment`, { method: 'POST', body: JSON.stringify({ mutations: Number($('#mutations').value) }) });
    $('#experiment-result').innerHTML = `<div class="status">${data.recovered ? '✓ Original file fully recovered' : '✕ Recovery failed'}</div><div class="sequence">${data.preview}…</div><div class="metrics"><div class="metric"><strong>${data.mutations}</strong>mutations injected</div><div class="metric"><strong>${data.physicalStrands}</strong>DNA strands</div><div class="metric"><strong>${data.gcPercent}%</strong>GC content</div><div class="metric"><strong>${data.elapsedMs} ms</strong>decode time</div></div>`; await render();
  } catch (error) { $('#experiment-result').innerHTML = `<div class="status">${error.message}</div>`; }
};
$('#benchmark').onclick = async () => {
  const data = await api('/api/benchmark', { method: 'POST', body: JSON.stringify({ request: $('#request').value }) });
  const max = Math.max(data.withoutPrefetchMs, data.withPrefetchMs, 1);
  $('#benchmark-result').innerHTML = `<div class="timeline"><label><span>Without prefetch</span><strong>${data.withoutPrefetchMs} ms</strong></label><div class="bar without"><i style="width:${data.withoutPrefetchMs/max*100}%"></i></div><label><span>With prefetch</span><strong>${data.withPrefetchMs} ms</strong></label><div class="bar"><i style="width:${data.withPrefetchMs/max*100}%"></i></div></div><div class="status">Saves ${data.savedMs} ms (${data.improvementPercent}%)</div><small>Dependencies: ${data.dependencies.map((d) => `${d.id} [${d.tier}]`).join(', ') || 'none matched'}</small>`;
};
$('#build-plan').onclick = async () => {
  try {
    $('#planner-status').textContent = 'Building a semantic dependency plan…';
    const plan = await api('/api/plan', { method: 'POST', body: JSON.stringify({ request: $('#planner-request').value }) });
    renderPlan(plan);
    $('#planner-status').textContent = `${plan.strategy}: ${plan.artifacts.length} dependencies predicted.`;
  } catch (error) { $('#planner-status').textContent = error.message; }
};
$('#run-plan').onclick = async () => {
  const button = $('#run-plan');
  try {
    activePrefetchJob = globalThis.crypto.randomUUID();
    button.disabled = true; $('#cancel-plan').disabled = false;
    $('#planner-status').textContent = `Running prefetch job ${activePrefetchJob.slice(0, 8)}…`;
    const data = await api('/api/prefetch', { method: 'POST', body: JSON.stringify({ request: $('#planner-request').value, jobId: activePrefetchJob }) });
    renderPlan(data.plan, data.prefetched);
    $('#planner-status').textContent = data.cancelled ? `Cancelled after ${data.prefetched.length} transfers.` : `Plan complete: ${data.prefetched.length} cold artifacts moved to SSD.`;
    await render();
  } catch (error) { $('#planner-status').textContent = error.message; }
  finally { activePrefetchJob = null; button.disabled = false; $('#cancel-plan').disabled = true; }
};
$('#cancel-plan').onclick = async () => {
  if (!activePrefetchJob) return;
  const data = await api(`/api/prefetch/${encodeURIComponent(activePrefetchJob)}/cancel`, { method: 'POST', body: '{}' });
  $('#planner-status').textContent = data.cancelled ? 'Cancellation requested; the current transfer will finish.' : 'The plan already finished.';
};
$('#compare-policies').onclick = async () => {
  try {
    $('#planner-status').textContent = 'Forecasting demand and comparing policies…';
    const { policies } = await api('/api/policies');
    $('#policy-result').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Policy</th><th>Placement changes</th><th>Proposed tiers</th></tr></thead><tbody>${policies.map((policy) => `<tr><td><strong>${policy.policy}</strong></td><td>${policy.changes}</td><td>${policy.placements.map((item) => `${item.id}: ${item.currentTier} → ${item.tier} (${Math.round(item.forecast * 100)}%)`).join('<br>')}</td></tr>`).join('')}</tbody></table></div>`;
    $('#planner-status').textContent = 'Comparison ready. Percentages are access-history demand forecasts.';
  } catch (error) { $('#planner-status').textContent = error.message; }
};
$('#run-inference').onclick = async () => {
  const button = $('#run-inference');
  const status = $('#inference-status');
  const result = $('#inference-result');
  const prompt = $('#inference-prompt').value.trim();
  try {
    if (!prompt) throw new Error('Enter a prompt first.');
    const maxNewTokens = Math.max(1, Math.min(256, Number($('#inference-tokens').value) || 20));
    button.disabled = true;
    button.textContent = 'Loading model…';
    status.textContent = 'The first run can take a minute while the model loads.';
    result.hidden = true;
    const data = await api('/api/inference', { method: 'POST', body: JSON.stringify({ prompt, maxNewTokens }) });
    $('#inference-output').textContent = data.text;
    $('#inference-model').textContent = `Model · ${data.baseModel}`;
    $('#inference-adapter').textContent = `Adapter · ${data.adapter}`;
    $('#inference-latency').textContent = `Latency · ${(data.wallClockLatencyMs / 1000).toFixed(2)} s`;
    status.textContent = 'Inference completed successfully.';
    result.hidden = false;
    await render();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Run LoRA inference';
  }
};
$('#refresh').onclick = render;
$('#reset').onclick = async () => { await api('/api/reset', { method: 'POST' }); $('#result').textContent = 'Demo reset: two artifacts restored to DNA.'; await render(); };
$('#optimize').onclick = async () => { const data = await api('/api/optimize', { method: 'POST' }); $('#result').textContent = `${data.changes.length} placements changed.`; await render(); };
$('#prefetch').onclick = async () => { const data = await api('/api/prefetch', { method: 'POST', body: JSON.stringify({ request: $('#request').value }) }); $('#result').textContent = `Predicted ${data.predicted.length}; prefetched ${data.prefetched.length}.`; await render(); };
render();
