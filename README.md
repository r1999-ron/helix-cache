# HelixCache

**Agentic hierarchical memory for AI with real cache, SSD, object storage, metadata, and LoRA inference backends.**

[**Open the live HelixCache demo →**](https://helix-cache.onrender.com)

[![Live Demo](https://img.shields.io/badge/live_demo-open_HelixCache-16846B?style=for-the-badge)](https://helix-cache.onrender.com)
[![Tests](https://img.shields.io/badge/tests-5_passing-2E8B57?style=for-the-badge)](#guided-test)

HelixCache predicts which AI artifacts will be needed, places them across GPU,
RAM, SSD, object storage, and DNA tiers, and restores cold artifacts before
inference reaches them. The project combines storage optimization, a real
binary-to-DNA codec, error recovery, integrity verification, and predictive
prefetching. Phase 3 adds SQLite metadata, optional Redis, S3-compatible object
storage, and a genuine PEFT LoRA inference worker.

## Phase 3: real storage and inference

The default process uses SQLite (`data/helixcache.sqlite`), the actual SSD
filesystem, and an in-process hot cache. `REDIS_URL` replaces the hot cache with
Redis. The `S3_*` variables make the S3 tier use any SigV4-compatible service;
without them it uses a local filesystem fallback so the demo stays simple.

`POST /api/inference` launches the Python PEFT runtime. It loads `LORA_ADAPTER`
when supplied. Otherwise it creates, saves, reloads, and runs a genuine rank-4
LoRA adapter on the configured small base model. That is an honest runtime smoke
test: the generated adapter is real but randomly initialized, not trained.

Run Redis, MinIO, SQLite, SSD storage, and LoRA inference together:

```powershell
docker compose -f docker-compose.phase3.yml up --build
```

Every move, prefetch, cache lookup, transfer-cost estimate, and inference writes
a measurement to SQLite. `/api/state` exposes observed wall-clock latency,
accumulated cost, cache-hit rate, and prefetch waste. A prefetched artifact is
waste until a later retrieval consumes it.

> HelixCache does not claim that DNA itself accelerates inference. It explores
> the controller that can hide part of archival retrieval latency by starting
> restoration early.

## What the project demonstrates

```text
User request
    ↓
Predict required models and datasets
    ↓
Look up their current storage tiers
    ↓
Restore cold artifacts and verify checksums
    ↓
Prefetch to SSD, then load into the GPU tier
    ↓
Update usage and reconsider placement
```

The portfolio dashboard contains three hands-on experiments:

1. **Real file journey** — upload any file up to 10 MB, archive it as DNA,
   restore it, and download the byte-identical original.
2. **DNA damage lab** — inject nucleotide substitutions and observe replicated
   strands repair the artifact.
3. **Prefetch benchmark** — compare sequential cold retrieval with retrieval
   running in parallel with AI planning.

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser dashboard                           │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ JSON API
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           HelixCache                                │
│                                                                     │
│  Request resolver ──► Artifact registry ──► Tiering controller      │
│        │                    │                       │                 │
│        └──► Prefetch plan   └──► Usage metadata    └──► File moves  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
        GPU / RAM             SSD / S3         DNA archive
                                              gzip + constrained ternary codec
                                              Reed–Solomon + read copies
                                              SHA-256 verification
```

The system uses three logical agent responsibilities:

- **Router** — predicts artifacts from the request.
- **Retrieval controller** — restores, verifies, and promotes cold artifacts.
- **Tiering controller** — recommends long-term placement.

Encoding, checksums, file movement, and scoring remain deterministic tools.

## DNA codec

The archive pipeline is:

```text
Original file
    ↓ gzip
Compressed bytes
    ↓ split into systematic data shards + Reed–Solomon parity shards
Self-describing packets (index, geometry, archive tag, CRC-32)
    ↓ adaptive ternary mapping (balanced GC, no repeated adjacent base)
Constrained DNA strands
    ↓ optionally store multiple physical reads
FASTA-like .dna archive
```

Each strand carries its own index, Reed–Solomon geometry, archive tag, and
CRC-32 inside the encoded bases. During restoration, HelixCache uses that
checksum to repair a single substitution, insertion, or deletion in a read,
discards unusable reads, and reconstructs missing data shards from parity.
The restored file is finally verified with SHA-256.

Example archive:

```text
;helixcache <encoded metadata>
>strand_000000_copy_0
ACTTGAGTAAG...GAGTGTTC
>fragment_000000_copy_1
ACTTGAGTAAG...GAGTGTTC
>fragment_000000_copy_2
ACTTGAGTAAG...GAGTGTTC
```

## Placement policy

Every artifact receives an explainable score:

```text
score = 0.28 × frequency
      + 0.22 × recency
      + 0.28 × predicted demand
      + 0.22 × business priority
      - 0.10 × size penalty
```

| Score | Recommended tier |
|---:|---|
| `≥ 0.72` | GPU |
| `≥ 0.56` | RAM |
| `≥ 0.38` | SSD |
| `≥ 0.20` | S3 |
| `< 0.20` | DNA |

## Predictive prefetching

For a request such as:

```text
Compare address agents using the 2024 evaluation dataset
```

the resolver predicts dependencies such as `address-agent-2024` and
`evaluation-dataset-2024`. If they are in DNA, retrieval begins while the
request is still being planned.

The included benchmark is an explicit latency model, not a physical DNA
measurement. With a DNA dependency it demonstrates:

| Scenario | Modeled latency |
|---|---:|
| Without prefetch | 4,300 ms |
| With prefetch | 3,100 ms |
| Saved | 1,200 ms (27.9%) |

## Run locally

Requirements: Node.js 20 or newer. No packages, model downloads, or API keys
are required.

### Windows PowerShell

Use either command. Both avoid PowerShell's disabled `npm.ps1` policy:

```powershell
.\start-helixcache.cmd
```

```powershell
npm.cmd start
```

### macOS or Linux

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

The first run creates six sample artifacts. Runtime state is stored under
`data/`, which is ignored by Git. Use **Reset demo** in the dashboard to return
the samples to their original tiers.

## Deploy the complete Render demo

The Render Blueprint deploys the complete Phase 3/4 runtime: Node.js, Python,
PyTorch, Transformers, PEFT LoRA inference, a persistent SSD disk, and a managed
Redis-compatible hot cache. It uses Render's Standard web-service plan because
the 512 MB Free and Starter plans are too small for a reliable PyTorch runtime.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/r1999-ron/helix-cache)

Deployment steps:

1. Open the button above and connect the GitHub repository.
2. Review the `helix-cache` Standard web service, 1 GB persistent disk, and the
   `helix-cache-hot-cache` Key Value service. These resources can incur charges.
3. Enter the four requested S3 secrets, or leave all four blank to use the
   persistent filesystem fallback for the logical S3 tier.
4. Apply the Blueprint and wait for the larger Python image to build.
5. Wait for `/health` to pass and open the generated `onrender.com` URL.
6. Run the LoRA inference panel once. The first request downloads the tiny base
   model into the persistent disk and can therefore take longer.

Uploaded artifacts, SQLite metadata, model downloads, generated DNA archives,
and filesystem storage tiers persist under `/var/lib/helixcache`. Render disks
are attached to one service instance, which matches HelixCache's single-writer
SQLite design. Configure external S3-compatible storage for durable object
storage that is independent of the Render instance.

The container honors these environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP listening port; hosting platforms can override it |
| `DATA_ROOT` | `/var/lib/helixcache` | Persistent registry and tier storage root |
| `REDIS_URL` | unset | Redis endpoint for GPU/RAM hot objects |
| `S3_ENDPOINT` / `S3_BUCKET` | unset | S3-compatible store and bucket |
| `S3_REGION` | `us-east-1` | SigV4 signing region |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | unset | S3 credentials |
| `S3_EGRESS_USD_PER_GB` | `0.09` | Cost applied to measured S3 retrieval bytes |
| `PYTHON_BIN` | `python3` | Python executable for inference |
| `LORA_BASE_MODEL` | `hf-internal-testing/tiny-random-gpt2` | Small base model |
| `LORA_ADAPTER` | unset | Local path or Hugging Face PEFT adapter ID |

`REDIS_URL` is populated automatically from the Blueprint's Key Value service.
Add `LORA_ADAPTER` in the Render dashboard to use a trained adapter compatible
with `LORA_BASE_MODEL`; otherwise the demo creates and reloads a genuine but
randomly initialized PEFT LoRA adapter.

## Guided test

The full Phase 4 flow can be tested from the dashboard without API commands:

1. Click **Reset demo** to restore the six samples to their original tiers.
2. In **Intelligent prediction lab**, keep the example request and click
   **Build semantic plan**. Confirm that the embedding planner returns ranked
   dependencies with confidence, order, and prefetch actions.
3. Click **Run prefetch plan**. The two cold dependencies should be marked
   **prefetched** and move from DNA to SSD in the artifact registry. A warm
   dependency remains **planned** because it can be used in place.
4. Click **Compare policies**. Confirm that rule-based, learned, and hybrid
   policies show different proposed tiers and access-history demand forecasts.
5. To exercise cancellation, reset the demo, click **Run prefetch plan**, then
   immediately click **Cancel plan**. Local samples are intentionally tiny, so
   the plan may finish before the click; the automated suite tests the
   deterministic cancellation path.
6. In **Prefetch benchmark**, click **Compare speed** and confirm the modeled
   prefetch timeline is shorter than sequential cold retrieval.
7. Optionally upload a small file in **Real file journey**, archive it with
   **DNA**, run the **DNA damage lab**, restore it with **GPU**, and download it.

Run automated verification:

```powershell
npm.cmd test
```

The 12 tests cover DNA recovery and integrity, semantic multi-artifact planning,
access-history forecasting, placement-policy comparison, prefetch cancellation,
persistence, telemetry, and real binary restoration.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/state` | Registry, scores, tiers, and recent activity |
| `POST` | `/api/artifacts` | Register a text or base64-encoded binary artifact |
| `POST` | `/api/artifacts/:id/archive` | Encode and move an artifact to DNA |
| `POST` | `/api/artifacts/:id/retrieve` | Restore and promote an artifact |
| `GET` | `/api/artifacts/:id/download` | Download the verified original bytes |
| `POST` | `/api/artifacts/:id/dna-experiment` | Inject mutations and report recovery metrics |
| `POST` | `/api/prefetch` | Predict and restore cold dependencies to SSD |
| `POST` | `/api/plan` | Build a ranked semantic multi-artifact plan |
| `POST` | `/api/prefetch/:jobId/cancel` | Cancel remaining prefetch transfers |
| `GET` | `/api/policies` | Compare rule-based, learned, and hybrid placement |
| `POST` | `/api/benchmark` | Compare modeled latency with and without prefetch |
| `POST` | `/api/inference` | Generate with the loaded PEFT LoRA adapter |
| `POST` | `/api/optimize` | Apply placement recommendations |
| `POST` | `/api/reset` | Restore the seeded demo state |

## Repository structure

```text
src/
  intelligence.js    Semantic embeddings, planning, forecasting policy scores
  database.js        SQLite metadata, access history, events, and telemetry
  dna-codec.js       DNA conversion, FASTA, corruption, recovery, analysis
  helix-cache.js     Registry, scoring, retrieval, prefetch, benchmark
  server.js          HTTP server and API
public/
  index.html         Dashboard layout
  app.js             Dashboard interactions
test/                 Automated end-to-end tests
data/                 Generated runtime tiers and registry (Git-ignored)
```

## What is real vs. simulated

| Real software | Simulated abstraction |
|---|---|
| Gzip compression | Physical DNA synthesis and sequencing |
| Binary-to-DNA conversion | Actual GPU and RAM allocation |
| FASTA-like archive files | Cloud S3 infrastructure |
| Substitution/indel repair and missing-strand recovery | Production retrieval latency and cost |
| SHA-256 verification | Model inference |
| Real file upload and download | Multi-node orchestration |
| Local semantic embedding plans | Hosted LLM routing |

## Limitations

- The local read repair is intentionally bounded to one edit per physical read;
  production sequencing pipelines would use alignment and probabilistic decoding.
- Reed–Solomon recovery is limited to the configured parity-shard count and a
  maximum of 255 data shards per archive.
- The bundled semantic embedder is intentionally small and deterministic; it
  is not a substitute for a domain-trained embedding model on large registries.
- Storage tiers are folders, not CUDA memory, Redis, NVMe, or a cloud provider.
- Benchmark numbers are modeled constants and must not be presented as measured
  physical-DNA performance.
- The local SQLite registry is intended for a single controller, not concurrent writers.

## Roadmap

### Phase 2 — biologically aware DNA codec

- [x] Add systematic Reed–Solomon error correction.
- [x] Control GC balance and cap homopolymers at one base.
- [x] Handle insertions, deletions, substitutions, and missing strands.
- [x] Embed strand indexes and CRC-32 checksums inside each sequence.

### Phase 3 — real storage and inference

- Connect Redis or an in-memory cache, SSD, and S3-compatible storage.
- Load a genuine small LoRA adapter into an inference runtime.
- Move registry and event data into SQLite or PostgreSQL.
- Measure wall-clock latency, cost, cache-hit rate, and prefetch waste.

### Phase 4 — intelligent prediction (implemented)

- [x] Replace keyword matching with local embeddings.
- Local semantic embeddings replace literal keyword matching. Artifact descriptions and tags participate in ranking without sending registry data to an external service.
- Exponentially weighted access history forecasts demand over a configurable horizon.
- Ranked multi-artifact plans identify both dependencies and their prefetch actions. Prefetch jobs accept a caller-provided ID and can be cancelled between transfers.
- Rule-based, learned, and hybrid placement policies can be compared side-by-side before applying placement changes.

Phase 4 API additions:

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/plan` | Return a ranked semantic multi-artifact plan |
| `POST` | `/api/prefetch` | Execute a plan; accepts `request` and optional `jobId` |
| `POST` | `/api/prefetch/:jobId/cancel` | Cancel remaining transfers in a prefetch job |
| `GET` | `/api/policies` | Compare rule-based, learned, and hybrid placements |

## Portfolio description

> HelixCache is an autonomous storage controller that predicts AI artifact
> demand and dynamically tiers models and knowledge across GPU, RAM, SSD,
> object storage, and simulated DNA storage—with verified recovery and
> predictive prefetching.

For the complete project narrative, architecture, validation, limitations, and
future plan, see `HelixCache_Project_Report.docx`.
