# Gulf Coast oil and gas operations - reference solution

This repository is a **Databricks reference solution**: an end-to-end sample for US Gulf Coast oil and gas operations visibility, optimization, and agent-assisted response. It is intended to be **shared directly with customers** as a starting point for workshops, proofs of concept, and production roadmaps, not as internal-only or one-off walkthrough material.

## What’s included

- **React front end** — control center UI (map, KPIs, simulator, terminal incident response patterns).
- **FastAPI backend** — APIs backed by Unity Catalog metric views and SQL warehouse queries.
- **Synthetic data & metric views** — scripts under `data_generation/` populate `demos.industrials_optimization` with illustrative Delta tables and metric views (see `data_generation/METRIC_VIEWS_README.md`).
- **Genie space assets** — templates and curation notes for natural-language SQL (`data_generation/GENIE_CURATION.md`).
- **Databricks App** — `app.yaml` describes deployment as a Databricks App.

## Quick start (local development)

Install dependencies, run the API and Vite dev server (see `package.json` scripts). Point `VITE_BACKEND_URL` at your local API when developing the UI against a running backend.

For warehouse-backed features, configure Databricks authentication and the same catalog/schema used by the data generation pipeline.

## Catalog note

Sample objects use the `demos.industrials_optimization` schema name. In your own workspace you may clone this solution under a catalog and schema that match your governance model; update `generator_config.py`, backend configuration, and Genie assets accordingly.
