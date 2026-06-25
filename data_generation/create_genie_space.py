#!/usr/bin/env python3
"""
Create or update the Gulf Coast Operations Genie Space from a JSON template.

Uses the Databricks SDK to create a Genie Space that exposes the metric views
(production_metrics, consumption_metrics, contract_metrics, financial_metrics,
forecast_metrics, profitability_metrics) for natural language exploration.

Prerequisites:
  - Metric views must exist (run pipeline first: python run_datagen_connect.py)
  - databricks-sdk installed and configured (profile or env vars)

Usage:
  python create_genie_space.py                    # create/update with default catalog_schema
  python create_genie_space.py --schema my_cat.my_schema
  python create_genie_space.py --export-only      # export current space to template JSON

Post-create curation:
  See GENIE_CURATION.md for instructions to add text instructions and example
  SQL queries in the Databricks UI so "cost" questions map to Total Landed Cost Per Ton.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from pathlib import Path

try:
    from databricks.sdk import WorkspaceClient
except ImportError:
    print("databricks-sdk required. Install: pip install databricks-sdk", file=sys.stderr)
    sys.exit(1)

DEFAULT_CATALOG_SCHEMA = "demos.industrials_optimization"
DEFAULT_DISPLAY_NAME = "Gulf Coast Operations Metrics"
DEFAULT_WAREHOUSE_ID = os.getenv("DATABRICKS_SQL_WAREHOUSE_ID") or None
DEFAULT_DESCRIPTION = (
    "Explore US Gulf Coast oil and gas operations KPIs: terminal throughput, feedstock demand, "
    "contracts, financials, forecasts, and margin exposure. Uses Unity Catalog metric views."
)
TEMPLATE_PATH = Path(__file__).parent / "genie_space_template.json"


def _resolve_warehouse(client: WorkspaceClient) -> str:
    """Get best available SQL warehouse ID."""
    whs = list(client.warehouses.list())
    if not whs:
        raise RuntimeError("No SQL warehouses found. Create one in SQL Warehouses.")
    # Prefer running, then smaller sizes
    running = [w for w in whs if getattr(w, "state", None) == "RUNNING"]
    candidates = running if running else whs
    return candidates[0].id


def _validate_or_resolve_warehouse(client: WorkspaceClient, warehouse_id: str | None) -> str:
    """Validate explicit warehouse_id or resolve the best available warehouse."""
    if not warehouse_id:
        return _resolve_warehouse(client)
    warehouse = client.warehouses.get(warehouse_id)
    if not warehouse or not getattr(warehouse, "id", None):
        raise RuntimeError(f"Warehouse not found or inaccessible: {warehouse_id}")
    return warehouse.id


def _build_serialized_space(template: dict, catalog_schema: str) -> str:
    """Build serialized_space JSON, substituting catalog_schema in identifiers."""
    out = json.loads(json.dumps(template))  # deep copy
    base_schema = "demos.industrials_optimization"
    mvs = out.get("data_sources", {}).get("metric_views", [])
    for mv in mvs:
        ident = mv.get("identifier", "")
        if ident.startswith(f"{base_schema}."):
            mv["identifier"] = ident.replace(f"{base_schema}.", f"{catalog_schema}.", 1)
    # API requires metric_views sorted by identifier
    mvs.sort(key=lambda x: x.get("identifier", ""))
    # API requires sample_question.id as 32-char hex UUID
    for q in out.get("config", {}).get("sample_questions", []):
        if not q.get("id"):
            q["id"] = uuid.uuid4().hex
    # Substitute catalog_schema in benchmark answer SQL (top-level benchmarks.questions)
    for q in out.get("benchmarks", {}).get("questions", []):
        for ans in q.get("answer", []):
            if ans.get("format") == "SQL":
                content = ans.get("content", [])
                for i, s in enumerate(content):
                    if isinstance(s, str) and base_schema in s:
                        content[i] = s.replace(base_schema, catalog_schema)
    # Sort benchmarks.questions by id (required by API)
    bm_questions = out.get("benchmarks", {}).get("questions", [])
    if bm_questions:
        bm_questions.sort(key=lambda x: x.get("id", ""))
    # Substitute catalog_schema in example SQL and add ids to instructions
    instructions = out.get("instructions", {})
    for eq in instructions.get("example_question_sqls", []):
        if not eq.get("id"):
            eq["id"] = uuid.uuid4().hex
        sql_list = eq.get("sql", [])
        for i, s in enumerate(sql_list):
            if isinstance(s, str) and base_schema in s:
                sql_list[i] = s.replace(base_schema, catalog_schema)
    for ti in instructions.get("text_instructions", []):
        if not ti.get("id"):
            ti["id"] = uuid.uuid4().hex
    # API requires example_question_sqls and text_instructions sorted by id
    if "example_question_sqls" in instructions:
        instructions["example_question_sqls"].sort(key=lambda x: x.get("id", ""))
    if "text_instructions" in instructions:
        instructions["text_instructions"].sort(key=lambda x: x.get("id", ""))
    return json.dumps(out)


def create_or_update_space(
    catalog_schema: str = DEFAULT_CATALOG_SCHEMA,
    display_name: str = DEFAULT_DISPLAY_NAME,
    description: str = DEFAULT_DESCRIPTION,
    warehouse_id: str | None = DEFAULT_WAREHOUSE_ID,
    profile: str = "DEFAULT",
    template_path: Path | None = None,
) -> dict:
    """Create or update the Genie Space from template."""
    client = WorkspaceClient(profile=profile)
    wh_id = _validate_or_resolve_warehouse(client, warehouse_id)

    path = template_path or TEMPLATE_PATH
    if not path.exists():
        raise FileNotFoundError(f"Template not found: {path}")

    with open(path) as f:
        template = json.load(f)

    serialized = _build_serialized_space(template, catalog_schema)

    # Check for existing space by name
    resp = client.genie.list_spaces()
    spaces = resp.spaces or []
    existing = next((s for s in spaces if getattr(s, "title", "") == display_name), None)

    if existing:
        space = client.genie.update_space(
            space_id=existing.space_id,
            description=description,
            serialized_space=serialized,
            title=display_name,
            warehouse_id=wh_id,
        )
        return {"space_id": space.space_id, "operation": "updated", "display_name": display_name}
    else:
        space = client.genie.create_space(
            warehouse_id=wh_id,
            serialized_space=serialized,
            description=description,
            title=display_name,
        )
        return {"space_id": space.space_id, "operation": "created", "display_name": display_name}


def export_space(space_id: str, output_path: Path, profile: str = "DEFAULT") -> None:
    """Export a Genie Space to JSON template (for reuse)."""
    client = WorkspaceClient(profile=profile)
    space = client.genie.get_space(space_id=space_id, include_serialized_space=True)
    if not space.serialized_space:
        raise ValueError(f"Space {space_id} has no serialized_space (need CAN EDIT permission)")
    parsed = json.loads(space.serialized_space)
    # Strip IDs from sample_questions for cleaner template
    for q in parsed.get("config", {}).get("sample_questions", []):
        q.pop("id", None)
    with open(output_path, "w") as f:
        json.dump(parsed, f, indent=2)
    print(f"Exported to {output_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Create/update Gulf Coast Operations Genie Space")
    parser.add_argument(
        "--schema",
        default=DEFAULT_CATALOG_SCHEMA,
        help=f"Catalog.schema for metric views (default: {DEFAULT_CATALOG_SCHEMA})",
    )
    parser.add_argument("--profile", default="DEFAULT", help="Databricks config profile")
    parser.add_argument(
        "--warehouse",
        default=DEFAULT_WAREHOUSE_ID,
        help="SQL warehouse ID (default: auto-detect, or set DATABRICKS_SQL_WAREHOUSE_ID)",
    )
    parser.add_argument(
        "--export-only",
        metavar="SPACE_ID",
        help="Export existing space to template JSON instead of creating",
    )
    parser.add_argument(
        "--output",
        default=str(TEMPLATE_PATH),
        help="Output path for --export-only (default: genie_space_template.json)",
    )
    parser.add_argument(
        "--template",
        help="Path to JSON template (default: genie_space_template.json)",
    )
    args = parser.parse_args()

    try:
        if args.export_only:
            export_space(args.export_only, Path(args.output), args.profile)
        else:
            result = create_or_update_space(
                catalog_schema=args.schema,
                warehouse_id=args.warehouse or None,
                profile=args.profile,
                template_path=Path(args.template) if args.template else None,
            )
            print(json.dumps(result, indent=2))
            print(f"\nGenie Space {result['operation']}: {result['space_id']}")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
