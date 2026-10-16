
# Q-Guard

**Intelligent Investigation Platform for Fraud, AML, and Player Protection**

Q-Guard is a research and demonstration platform developed for ThunderHacks 2026, addressing the Ontario Lottery and Gaming Corporation (OLG) intelligent player protection and fraud detection challenge.

It combines trained machine-learning models, a Python inference service, and a React investigator dashboard to support the identification, prioritization, and human review of potentially suspicious player activity.

## Features

### Implemented backend

- CSV upload and structural validation
- SHA-256 file integrity checks
- SQLite dataset and scan registration
- Operational fraud, AML, and protection inference
- Three trained LightGBM classifiers
- Saved prediction outputs and scan summaries
- REST API for dataset upload, model status, scans, and results

### Frontend

- React and TypeScript
- Vite
- Tailwind CSS and shadcn/ui components
- TanStack Router
- Operational Command Centre
- Data Intake and risk scan interface (integration in progress)
- Light and dark themes

### Planned investigation functionality

- Searchable Investigation Queue
- Account 360-degree evidence review
- Historical behavioral context
- Valid historical model-score timelines
- Relationship Explorer
- Investigator decisions and audit history
- Classical versus Quantum V4 comparison

## Architecture

```text
React / shadcn dashboard
          |
          | HTTP REST API
          v
      FastAPI
          |
          +-- CSV validation and hashing
          +-- Feature compatibility checks
          +-- Fraud V3 LightGBM
          +-- AML Context V2 LightGBM
          +-- Protection Context V2 LightGBM
          +-- SQLite metadata
          +-- CSV inference results
          |
          v
  Investigator dashboard
```

## Technology

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite |
| UI | shadcn/ui, Tailwind CSS |
| Routing | TanStack Router |
| Visualization | Recharts |
| Backend | Python, FastAPI |
| Database | SQLite |
| Operational ML | LightGBM |
| Data | Pandas, NumPy, PyArrow |
| Research ML | PyTorch and quantum-hybrid models |

## Requirements

- Node.js 24 or another version supported by the installed Vite release
- npm
- Python 3.13 (current tested environment)
- Conda or a Python virtual environment
- Trained Q-Guard model bundle for inference

## Installation

Clone the repository and enter its directory.

### Frontend

```bash
npm ci
npm run dev
```

Vite normally serves the application at:

http://localhost:5173

### Backend

Using the existing Conda environment:

```bash
conda activate hackathon
python -m pip install -r backend/requirements.txt
```

Or create a fresh environment:

```bash
conda create -n qguard-backend python=3.13 pip -y
conda activate qguard-backend
python -m pip install -r backend/requirements.txt
```

Start the API from the project root:

```bash
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir backend
```

API documentation:

http://127.0.0.1:8000/docs

## Model bundle

Place the prepared Q-Guard model bundle at:

```text
qguard_dashboard_bundle/
├── dashboard_manifest.json
├── models/
│   ├── fraud_v3/
│   ├── context_v2/
│   └── neural_v4/
├── data/
├── predictions/
└── reports/
```

The bundle is excluded from Git because it contains large model artifacts and datasets.

The prepared bundle contains synthetic retrospective data and saved predictions. It does not contain the original complete raw transaction dataset.

## Operational models

| Category | Model |
|---|---|
| Fraud | Fraud V3, weighted LightGBM |
| AML | AML Context V2, LightGBM |
| Player Protection | Protection Context V2, LightGBM |

Each operational model requires 71 engineered features.

The supported inference CSV provides `account_id` and 62 source features. The backend constructs nine derived ratio features.

**Raw timestamped transactions are not currently supported as direct operational inference input.**

## REST API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health and SQLite check |
| GET | `/api/overview` | Saved operational overview |
| GET | `/api/models` | Model status and input schema |
| POST | `/api/datasets` | Upload and register CSV |
| GET | `/api/datasets/{id}` | Dataset metadata |
| POST | `/api/scans` | Start operational inference |
| GET | `/api/scans/{id}` | Inference job status |
| GET | `/api/scans/{id}/results` | Preview generated predictions |

The other planned investigation and audit endpoints have not yet been implemented.

## Testing

Check backend health:

```bash
curl http://127.0.0.1:8000/api/health
```

Check model availability:

```bash
curl http://127.0.0.1:8000/api/models
```

Generate synthetic smoke-test features:

```bash
python -m backend.examples.create_test_features
```

Upload the resulting file through the API or the Data Intake interface.

The smoke-test feature values are artificial. They are intended to verify execution, not model accuracy.

Build the frontend:

```bash
npm run build
```

## Data and research limitations

- The bundled dataset is synthetic.
- Model scores are not calibrated real-world fraud probabilities.
- Alerts are indicators requiring human investigation.
- Quantum V4 is an experimental simulated quantum-hybrid model.
- Operational alerts are generated by the LightGBM models.
- Fresh V4 inference requires compatible prepared tensors and preprocessing.
- Historical risk-score trends require valid time-window inference inputs.
- No automatic punitive account actions are performed.
- The local demonstration does not implement production-grade authentication, authorization, or secure multi-user deployment.

## Repository organization

```text
Qguard-Operations/
├── src/                       # Frontend source
├── public/                    # Public static assets
├── backend/
│   ├── app/                   # FastAPI modules
│   ├── examples/              # Test scripts
│   ├── storage/               # Local files, ignored
│   └── requirements.txt
├── qguard_dashboard_bundle/   # Local models/data, ignored
├── package.json
├── package-lock.json
├── vite.config.ts
├── .gitignore
└── README.md
```

## Attribution and License

The frontend was adapted from the open-source shadcn-admin template by Sat Naing, using shadcn/ui components.

Preserve the applicable upstream copyright and license notices in the repository's LICENSE file.

This repository is a research demonstration and is not an official OLG product.
