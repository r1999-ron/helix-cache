# HelixCache

**Agentic hierarchical memory for AI using simulated DNA archival storage.**

HelixCache predicts which AI artifacts will be needed, places them across GPU,
RAM, SSD, object storage, and DNA tiers, and restores cold artifacts before
inference reaches them. The project combines storage optimization, a real
binary-to-DNA codec, error recovery, integrity verification, and predictive
prefetching in a zero-dependency Node.js application.

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
                                              gzip + 2-bit codec
                                              replicated strands
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
    ↓ 00=A, 01=C, 10=G, 11=T
DNA bases
    ↓ split into fragments and store three copies
FASTA-like .dna archive
```

Each archive includes codec metadata and the original SHA-256 checksum. During
restoration, HelixCache performs majority voting across the three copies at
each nucleotide position, decodes and decompresses the result, and rejects it
if the checksum differs.

Example archive:

```text
;helixcache <encoded metadata>
>fragment_000000_copy_0
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

## Deploy the portfolio demo

The repository includes a production Docker image and a Render Blueprint with
an encrypted 1 GB persistent disk. The disk preserves uploaded artifacts, the
registry, and generated DNA archives across restarts and deployments.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/r1999-ron/helix-cache)

Deployment steps:

1. Open the button above and connect the GitHub repository.
2. Review the `helix-cache` Blueprint service.
3. Approve the Starter instance and 1 GB persistent disk, then deploy.
4. Wait for `/health` to pass and open the generated `onrender.com` URL.

The persistent disk requires a paid Render service. This is intentional: free
instances use an ephemeral filesystem, which would erase uploaded artifacts and
DNA archives after a restart. If persistence is not needed for a temporary demo,
remove the `disk` block and change `plan` to `free` in `render.yaml`.

The container honors these environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP listening port; hosting platforms can override it |
| `DATA_ROOT` | `/var/lib/helixcache` | Persistent registry and tier storage root |

## Guided test

1. Click **Reset demo** and confirm that two artifacts are in DNA.
2. Upload a small file in **Real file journey**.
3. Find its registry row and click **DNA**.
4. Run the **DNA damage lab** with 12 mutations and confirm recovery succeeds.
5. Click **GPU** to restore the artifact, then **Download**.
6. Compare the original and downloaded SHA-256 hashes.
7. Reset again, run **Compare speed**, click **Prefetch now**, and compare speed
   a second time.

Run automated verification:

```powershell
npm.cmd test
```

The five tests cover arbitrary byte round-trips, substitution recovery,
dependency resolution, real binary restoration, and the prefetch benchmark.

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
| `POST` | `/api/benchmark` | Compare modeled latency with and without prefetch |
| `POST` | `/api/optimize` | Apply placement recommendations |
| `POST` | `/api/reset` | Restore the seeded demo state |

## Repository structure

```text
src/
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
| Substitution injection and repair | Production retrieval latency and cost |
| SHA-256 verification | Model inference |
| Real file upload and download | Multi-node orchestration |
| Placement and prefetch decisions | Semantic LLM routing |

## Limitations

- The basic two-bit codec can create long homopolymers and does not enforce GC
  balance.
- Triple replication is less efficient and powerful than production error-
  correction codes.
- Dependency prediction currently uses keyword overlap rather than semantic
  understanding.
- Storage tiers are folders, not CUDA memory, Redis, NVMe, or a cloud provider.
- Benchmark numbers are modeled constants and must not be presented as measured
  physical-DNA performance.
- The JSON registry is intended for a local experiment, not concurrent use.

## Roadmap

### Phase 2 — biologically aware DNA codec

- Add Reed–Solomon or fountain-code error correction.
- Control GC balance and maximum homopolymer length.
- Handle insertions, deletions, and missing strands.
- Embed strand indexes and checksums inside the encoded sequence.

### Phase 3 — real storage and inference

- Connect Redis or an in-memory cache, SSD, and S3-compatible storage.
- Load a genuine small LoRA adapter into an inference runtime.
- Move registry and event data into SQLite or PostgreSQL.
- Measure wall-clock latency, cost, cache-hit rate, and prefetch waste.

### Phase 4 — intelligent prediction

- Replace keyword matching with embeddings or an LLM planner.
- Forecast demand from access history.
- Support multi-artifact plans and prefetch cancellation.
- Compare rule-based, learned, and hybrid placement policies.

## Portfolio description

> HelixCache is an autonomous storage controller that predicts AI artifact
> demand and dynamically tiers models and knowledge across GPU, RAM, SSD,
> object storage, and simulated DNA storage—with verified recovery and
> predictive prefetching.

For the complete project narrative, architecture, validation, limitations, and
future plan, see `HelixCache_Project_Report.docx`.
