"""
FastAPI Backend for Gulf Coast Operations

This backend provides REST API endpoints and serves the React frontend.
Following the pattern from logistics-control-center.
"""

import asyncio
import json
import logging
import math
import os
import re
import warnings
from pathlib import Path
from typing import Any

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

logger = logging.getLogger("gulf-coast-operations")

# Create separate FastAPI apps for API and UI
api_app = FastAPI(title="Gulf Coast Operations API")
app = FastAPI(title="Gulf Coast Operations App")

SERVERLESS_WAREHOUSE_NAME = os.getenv("DATABRICKS_SQL_WAREHOUSE_NAME", "Serverless SQL Warehouse")
workspace_client: WorkspaceClient | None = None

# CORS configuration for local development and Databricks Apps
api_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@api_app.get("/health")
async def health():
    """Health check endpoint for the API"""
    return {
        "status": "ok",
        "service": "Gulf Coast Operations Backend",
    }


class SqlQueryRequest(BaseModel):
    query: str


class SqlQueryResponse(BaseModel):
    warehouse_id: str
    status: str
    row_count: int
    rows: list[dict[str, Any]]


class HomeCustomerResponse(BaseModel):
    id: str
    name: str
    contact: str
    tier: str
    industry: str | None = None


class HomeLaneResponse(BaseModel):
    id: str
    origin: str
    dest: str
    mode: str
    originName: str | None = None
    destName: str | None = None
    originLat: float | None = None
    originLng: float | None = None
    destLat: float | None = None
    destLng: float | None = None
    product: str | None = None
    contractId: str | None = None
    sourceAssetId: str | None = None
    avgDailyVolume: float
    onTimePct: float
    delayMinutes: float
    slaRiskPct: float
    daysToZero: float
    ldExposureUsd: float
    profitabilityPct: float
    utilizationPct: float
    availableCapacity: float
    technicalStatus: str
    technicalScore: float
    activeDisruptionDays: float
    vibrationAlerts: float
    maxDisruptionStage: int
    upstreamDisruptionPct: float
    totalLandedCostPerTon: float = 0.0
    forecastDiscrepancyPct: float = 0.0
    supplyTpd: float = 0.0
    demandTpd: float = 0.0
    productionCostPerTon: float = 0.0
    distributionCostPerTon: float = 0.0


class HomeKpiResponse(BaseModel):
    criticalLanes: int
    avgDaysToZero: float
    totalLandedCost: float
    avgForecastDiscrepancyPct: float
    avgProfitabilityPct: float


class HomeStatusThresholdsResponse(BaseModel):
    risk: dict[str, float]
    forecastDiscrepancy: dict[str, float]
    totalLandedCost: dict[str, float]
    profitability: dict[str, float]


TECHNICAL_STATUS_THRESHOLDS = {
    "criticalMinScore": 88.0,
    "watchMinScore": 48.0,
    "criticalStageMin": 3,
    "watchStageMin": 3,
    "criticalActiveDisruptionDaysMin": 8.0,
    "watchActiveDisruptionDaysMin": 8.0,
}


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def technical_status_and_score(
    *,
    active_disruption_days: float,
    vibration_alerts: float,
    max_disruption_stage: int,
    upstream_disruption_pct: float,
    lane_priority: str | None,
) -> tuple[str, float]:
    # Guardrail-first calibration:
    # lane_priority establishes baseline (mostly stable, some watch, very few critical),
    # while technical signals can escalate lanes when indicators are jointly severe.
    baseline = 26.0
    if lane_priority == "critical":
        baseline = 72.0
    elif lane_priority == "watch":
        baseline = 50.0

    disruption_component = _clamp((active_disruption_days - 7.0) * 5.0, 0.0, 12.0)
    vibration_component = _clamp((vibration_alerts - 3600.0) / 80.0, 0.0, 8.0)
    stage_component = {0: 0.0, 1: 6.0, 2: 12.0}.get(max_disruption_stage, 20.0)
    upstream_component = _clamp(upstream_disruption_pct * 35.0, 0.0, 10.0)
    score = _clamp(
        baseline + disruption_component + vibration_component + stage_component + upstream_component,
        0.0,
        100.0,
    )

    if lane_priority == "critical":
        return "critical", score
    if (
        score >= TECHNICAL_STATUS_THRESHOLDS["criticalMinScore"]
        and max_disruption_stage >= TECHNICAL_STATUS_THRESHOLDS["criticalStageMin"]
        and upstream_disruption_pct >= 0.11
    ):
        return "critical", score
    if lane_priority == "watch":
        return "watch", score
    if (
        score >= 60.0
        and max_disruption_stage >= TECHNICAL_STATUS_THRESHOLDS["watchStageMin"]
        and upstream_disruption_pct >= 0.12
        and active_disruption_days >= TECHNICAL_STATUS_THRESHOLDS["watchActiveDisruptionDaysMin"]
    ):
        return "watch", score
    return "stable", score


def _clean_optional_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() == "none":
        return None
    return text


def lane_status_band(
    *,
    kpi_mode: str,
    days_to_zero: float,
    ld_exposure_usd: float,
    profitability_pct: float,
    delay_minutes: float,
    sla_risk_pct: float,
    technical_status: str = "stable",
    forecast_discrepancy_pct: float = 0.0,
    total_landed_cost_per_ton: float = 0.0,
    avg_daily_volume: float = 0.0,
) -> str:
    if kpi_mode == "forecastDiscrepancy":
        # Positive = excess supply, negative = shortage
        if forecast_discrepancy_pct < -10.0:
            return "high"
        if forecast_discrepancy_pct < -3.0:
            return "medium"
        if forecast_discrepancy_pct > 8.0:
            return "excess"
        return "low"
    if kpi_mode == "totalLandedCost":
        monthly_total_landed_cost = total_landed_cost_per_ton * max(0.0, avg_daily_volume) * 30.0
        if monthly_total_landed_cost >= 500000.0:
            return "high"
        if monthly_total_landed_cost >= 225000.0:
            return "medium"
        return "low"
    if kpi_mode == "profitability":
        if profitability_pct < 5.0:
            return "high"
        if profitability_pct < 15.0:
            return "medium"
        return "low"
    # default "risk" follows technical incident status contract.
    if technical_status == "critical":
        return "high"
    if technical_status == "watch":
        return "medium"
    if days_to_zero <= 2.0 or ld_exposure_usd >= 80000.0 or profitability_pct < 5.0:
        return "high"
    if days_to_zero <= 4.0 or delay_minutes >= 60.0 or sla_risk_pct >= 0.15 or profitability_pct < 15.0:
        return "medium"
    return "low"


LLM_ENDPOINT_NAME = os.getenv("DATABRICKS_LLM_ENDPOINT_NAME", "databricks-gpt-oss-120b")
DEFAULT_GENIE_SPACE_ID = ""
GENIE_METRIC_VIEWS = [
    "demos.industrials_optimization.production_metrics",
    "demos.industrials_optimization.consumption_metrics",
    "demos.industrials_optimization.contract_metrics",
    "demos.industrials_optimization.financial_metrics",
    "demos.industrials_optimization.forecast_metrics",
    "demos.industrials_optimization.profitability_metrics",
]


def get_databricks_client() -> WorkspaceClient:
    """Initialize WorkspaceClient from existing local/app auth."""
    global workspace_client
    if workspace_client is None:
        workspace_client = WorkspaceClient()
    return workspace_client


_openai_client = None


def get_openai_client():
    """Derive an OpenAI-compatible client from the Databricks WorkspaceClient."""
    global _openai_client
    if _openai_client is None:
        w = get_databricks_client()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            _openai_client = w.serving_endpoints.get_open_ai_client()
    return _openai_client


def _extract_content(message) -> str:
    """Defensively extract text from an OpenAI-compatible message."""
    content = message.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return "\n".join(parts)
    return str(content)


def resolve_sql_warehouse_id(client: WorkspaceClient) -> str:
    """Resolve SQL warehouse ID from env var, else by warehouse name."""
    warehouse_id = os.getenv("DATABRICKS_SQL_WAREHOUSE_ID", "").strip()
    if warehouse_id:
        return warehouse_id

    for warehouse in client.warehouses.list():
        if warehouse.name == SERVERLESS_WAREHOUSE_NAME and warehouse.id:
            return warehouse.id

    raise HTTPException(
        status_code=500,
        detail=(
            "Could not resolve SQL warehouse. Set DATABRICKS_SQL_WAREHOUSE_ID "
            f"or create warehouse named '{SERVERLESS_WAREHOUSE_NAME}'."
        ),
    )


def parse_sql_results(execution: Any) -> list[dict[str, Any]]:
    """Convert statement execution result into JSON-friendly rows."""
    result = execution.result
    manifest = getattr(execution, "manifest", None)
    if not result or not manifest or not manifest.schema:
        return []
    data_array = getattr(result, "data_array", None)
    if not data_array:
        return []

    columns = manifest.schema.columns
    col_names = [col.name for col in columns]
    col_types = [str(getattr(col, "type_name", "STRING") or "STRING").upper() for col in columns]
    rows: list[dict[str, Any]] = []

    for row in data_array:
        parsed: dict[str, Any] = {}
        for idx, col_name in enumerate(col_names):
            value = row[idx] if idx < len(row) else None
            if value is None:
                parsed[col_name] = None
                continue
            t = col_types[idx]
            if t in {"INT", "INTEGER", "BIGINT", "SMALLINT", "TINYINT", "LONG"}:
                try:
                    parsed[col_name] = int(value)
                except (TypeError, ValueError):
                    parsed[col_name] = value
            elif t in {"DOUBLE", "FLOAT", "DECIMAL"}:
                try:
                    parsed[col_name] = float(value)
                except (TypeError, ValueError):
                    parsed[col_name] = value
            elif t == "BOOLEAN":
                parsed[col_name] = str(value).lower() in {"true", "1", "yes"}
            else:
                parsed[col_name] = value
        rows.append(parsed)
    return rows


def execute_sql_rows(client: WorkspaceClient, query: str) -> list[dict[str, Any]]:
    """Execute SQL and return rows, or raise HTTPException on failure."""
    warehouse_id = resolve_sql_warehouse_id(client)
    execution = client.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=query,
        wait_timeout="30s",
    )
    state = execution.status.state if execution.status and execution.status.state else None
    if state != StatementState.SUCCEEDED:
        error_text = None
        if execution.status and execution.status.error:
            error_text = str(execution.status.error)
        raise HTTPException(
            status_code=400,
            detail={
                "status": str(state),
                "error": error_text or "SQL statement did not succeed.",
                "query": query,
            },
        )
    return parse_sql_results(execution)


@api_app.post("/sql/query", response_model=SqlQueryResponse)
async def run_sql_query(payload: SqlQueryRequest):
    """Execute a SQL query against the Serverless SQL Warehouse - S."""
    query = payload.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query must not be empty.")

    client = get_databricks_client()
    warehouse_id = resolve_sql_warehouse_id(client)

    execution = client.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=query,
        wait_timeout="30s",
    )

    state = execution.status.state if execution.status and execution.status.state else None
    if state != StatementState.SUCCEEDED:
        error_text = None
        if execution.status and execution.status.error:
            error_text = str(execution.status.error)
        raise HTTPException(
            status_code=400,
            detail={
                "status": str(state),
                "error": error_text or "SQL statement did not succeed.",
            },
        )

    rows = parse_sql_results(execution)
    return SqlQueryResponse(
        warehouse_id=warehouse_id,
        status="SUCCEEDED",
        row_count=len(rows),
        rows=rows,
    )


@api_app.get("/home/customers", response_model=list[HomeCustomerResponse])
async def get_home_customers():
    """Customer filter options sourced from metric views only."""
    client = get_databricks_client()
    rows = execute_sql_rows(
        client,
        """
        SELECT DISTINCT
          `Customer ID` AS id,
          `Customer Name` AS name,
          `Contact Email` AS contact,
          `Tier` AS tier,
          `Industry` AS industry
        FROM demos.industrials_optimization.consumption_metrics
        ORDER BY name
        """.strip(),
    )
    output: list[HomeCustomerResponse] = []
    for row in rows:
        customer_id = _clean_optional_string(row.get("id"))
        customer_name = _clean_optional_string(row.get("name"))
        if not customer_id or not customer_name:
            continue
        tier = _clean_optional_string(row.get("tier")) or "Enterprise"
        if "{values" in tier:
            tier = "Enterprise"
        output.append(
            HomeCustomerResponse(
                id=customer_id,
                name=customer_name,
                contact=_clean_optional_string(row.get("contact")) or f"{customer_id.lower()}@example.com",
                tier=tier,
                industry=_clean_optional_string(row.get("industry")),
            )
        )
    return output


@api_app.get("/home/status-thresholds", response_model=HomeStatusThresholdsResponse)
async def get_home_status_thresholds():
    """Legend-aligned threshold metadata for KPI-aware status filtering."""
    return HomeStatusThresholdsResponse(
        risk={k: float(v) for k, v in TECHNICAL_STATUS_THRESHOLDS.items()},
        forecastDiscrepancy={"excessMin": 8.0, "lowMax": -3.0, "mediumMax": -10.0},
        totalLandedCost={"lowMax": 150.0, "mediumMax": 250.0},
        profitability={"highMax": 5.0, "mediumMax": 15.0, "lowMin": 15.0},
    )


@api_app.get("/home/lanes", response_model=list[HomeLaneResponse])
async def get_home_lanes(kpi_mode: str = "risk", status: str | None = None):
    """Lane rows for map + side panel sourced from metric views only."""
    client = get_databricks_client()
    rows = execute_sql_rows(
        client,
        """
        WITH consumption AS (
          SELECT
            `Lane ID` AS lane_id,
            `Asset ID` AS origin,
            `Customer ID` AS dest,
            `Mode` AS mode,
            `Asset Name` AS origin_name,
            `Customer Name` AS dest_name,
            `Origin Lat` AS origin_lat,
            `Origin Lng` AS origin_lng,
            `Dest Lat` AS dest_lat,
            `Dest Lng` AS dest_lng,
            `Product` AS product,
            `Contract ID` AS contract_id,
            MEASURE(`Avg Daily Volume`) AS avg_daily_volume,
            MEASURE(`On-Time Pct`) AS on_time_pct,
            MEASURE(`Avg Delay Minutes`) AS delay_minutes,
            MEASURE(`Avg SLA Risk Pct`) AS sla_risk_pct,
            MEASURE(`Days to Zero Operational`) AS days_to_zero,
            MEASURE(`Utilization Pct`) AS utilization_pct,
            MEASURE(`Available Capacity`) AS available_capacity,
            MEASURE(`Production Cost Per Ton`) AS production_cost_per_ton,
            MEASURE(`Distribution Cost Per Ton`) AS distribution_cost_per_ton,
            MEASURE(`Total Landed Cost Per Ton`) AS total_landed_cost_per_ton
          FROM demos.industrials_optimization.consumption_metrics
          GROUP BY
            `Lane ID`,
            `Asset ID`,
            `Customer ID`,
            `Mode`,
            `Asset Name`,
            `Customer Name`,
            `Origin Lat`,
            `Origin Lng`,
            `Dest Lat`,
            `Dest Lng`,
            `Product`,
            `Contract ID`
        ),
        contract AS (
          SELECT
            `Lane ID` AS lane_id,
            MEASURE(`LD Exposure`) AS ld_exposure_usd
          FROM demos.industrials_optimization.contract_metrics
          GROUP BY `Lane ID`
        ),
        profitability AS (
          SELECT
            `Lane ID` AS lane_id,
            MEASURE(`Lane Margin Pct`) AS profitability_pct
          FROM demos.industrials_optimization.profitability_metrics
          GROUP BY `Lane ID`
        ),
        technical_asset AS (
          SELECT
            `Asset ID` AS asset_id,
            MEASURE(`Active Disruption Days`) AS active_disruption_days,
            MEASURE(`Vibration Alerts`) AS vibration_alerts
          FROM demos.industrials_optimization.production_metrics
          GROUP BY `Asset ID`
        ),
        technical_lane AS (
          SELECT
            `Lane ID` AS lane_id,
            MEASURE(`Upstream Disruption Pct`) AS upstream_disruption_pct,
            MEASURE(`Propagation Stage Max`) AS max_disruption_stage
          FROM demos.industrials_optimization.consumption_metrics
          GROUP BY `Lane ID`
        ),
        contract_priority AS (
          SELECT
            `Lane ID` AS lane_id,
            MAX(`Lane Priority`) AS lane_priority
          FROM demos.industrials_optimization.contract_metrics
          GROUP BY `Lane ID`
        ),
        forecast AS (
          SELECT
            `Lane ID` AS lane_id,
            MEASURE(`Forecasted Supply`) AS supply_tpd,
            MEASURE(`Forecasted Demand`) AS demand_tpd,
            MEASURE(`Supply/Demand Discrepancy`) AS discrepancy_tpd,
            MEASURE(`Forecast Discrepancy Pct`) AS forecast_discrepancy_pct
          FROM demos.industrials_optimization.forecast_metrics
          GROUP BY `Lane ID`
        )
        SELECT
          c.lane_id,
          c.origin,
          c.dest,
          c.mode,
          c.origin_name,
          c.dest_name,
          c.origin_lat,
          c.origin_lng,
          c.dest_lat,
          c.dest_lng,
          c.product,
          c.contract_id,
          c.avg_daily_volume,
          c.on_time_pct,
          c.delay_minutes,
          c.sla_risk_pct,
          c.days_to_zero,
          COALESCE(k.ld_exposure_usd, 0.0) AS ld_exposure_usd,
          COALESCE(p.profitability_pct, 0.0) AS profitability_pct,
          c.utilization_pct,
          c.available_capacity,
          COALESCE(ta.active_disruption_days, 0.0) AS active_disruption_days,
          COALESCE(ta.vibration_alerts, 0.0) AS vibration_alerts,
          CAST(COALESCE(tl.max_disruption_stage, 0) AS INT) AS max_disruption_stage,
          COALESCE(tl.upstream_disruption_pct, 0.0) AS upstream_disruption_pct,
          COALESCE(cp.lane_priority, 'stable') AS lane_priority,
          COALESCE(f.supply_tpd, 0.0) AS supply_tpd,
          COALESCE(f.demand_tpd, 0.0) AS demand_tpd,
          COALESCE(f.discrepancy_tpd, 0.0) AS discrepancy_tpd,
          COALESCE(f.forecast_discrepancy_pct, 0.0) AS forecast_discrepancy_pct,
          COALESCE(c.production_cost_per_ton, 0.0) AS production_cost_per_ton,
          COALESCE(c.distribution_cost_per_ton, 0.0) AS distribution_cost_per_ton,
          COALESCE(c.total_landed_cost_per_ton, 0.0) AS total_landed_cost_per_ton
        FROM consumption c
        LEFT JOIN contract k ON c.lane_id = k.lane_id
        LEFT JOIN profitability p ON c.lane_id = p.lane_id
        LEFT JOIN technical_lane tl ON c.lane_id = tl.lane_id
        LEFT JOIN technical_asset ta ON c.origin = ta.asset_id
        LEFT JOIN contract_priority cp ON c.lane_id = cp.lane_id
        LEFT JOIN forecast f ON c.lane_id = f.lane_id
        ORDER BY c.lane_id
        """.strip(),
    )
    output: list[HomeLaneResponse] = []
    for row in rows:
        lane_id = _clean_optional_string(row.get("lane_id"))
        origin = _clean_optional_string(row.get("origin"))
        dest = _clean_optional_string(row.get("dest"))
        if not lane_id or not origin or not dest:
            continue
        mode = (_clean_optional_string(row.get("mode")) or "truck").lower()
        if mode not in {"pipeline", "truck"}:
            mode = "truck"
        days_to_zero = float(row.get("days_to_zero") or 0.0)
        ld_exposure_usd = float(row.get("ld_exposure_usd") or 0.0)
        profitability_pct = float(row.get("profitability_pct") or 0.0)
        delay_minutes = float(row.get("delay_minutes") or 0.0)
        sla_risk_pct = float(row.get("sla_risk_pct") or 0.0)
        active_disruption_days = float(row.get("active_disruption_days") or 0.0)
        vibration_alerts = float(row.get("vibration_alerts") or 0.0)
        max_disruption_stage = int(row.get("max_disruption_stage") or 0)
        upstream_disruption_pct = float(row.get("upstream_disruption_pct") or 0.0)
        lane_priority = _clean_optional_string(row.get("lane_priority"))
        supply_tpd = float(row.get("supply_tpd") or 0.0)
        demand_tpd = float(row.get("demand_tpd") or 0.0)
        discrepancy_tpd = float(row.get("discrepancy_tpd") or 0.0)
        production_cost_per_ton = float(row.get("production_cost_per_ton") or 0.0)
        distribution_cost_per_ton = float(row.get("distribution_cost_per_ton") or 0.0)
        total_landed_cost_per_ton = float(row.get("total_landed_cost_per_ton") or 0.0)
        # Forecast discrepancy: from metric view (avg % over rows where demand > 0)
        forecast_discrepancy_pct = float(row.get("forecast_discrepancy_pct") or 0.0)
        origin_lat = float(row.get("origin_lat")) if row.get("origin_lat") is not None else None
        origin_lng = float(row.get("origin_lng")) if row.get("origin_lng") is not None else None
        dest_lat = float(row.get("dest_lat")) if row.get("dest_lat") is not None else None
        dest_lng = float(row.get("dest_lng")) if row.get("dest_lng") is not None else None
        technical_status, technical_score = technical_status_and_score(
            active_disruption_days=active_disruption_days,
            vibration_alerts=vibration_alerts,
            max_disruption_stage=max_disruption_stage,
            upstream_disruption_pct=upstream_disruption_pct,
            lane_priority=lane_priority,
        )
        band = lane_status_band(
            kpi_mode=kpi_mode,
            days_to_zero=days_to_zero,
            ld_exposure_usd=ld_exposure_usd,
            profitability_pct=profitability_pct,
            delay_minutes=delay_minutes,
            sla_risk_pct=sla_risk_pct,
            technical_status=technical_status,
            forecast_discrepancy_pct=forecast_discrepancy_pct,
            total_landed_cost_per_ton=total_landed_cost_per_ton,
            avg_daily_volume=float(row.get("avg_daily_volume") or 0.0),
        )
        if status in {"low", "medium", "high", "excess"} and band != status:
            continue
        output.append(
            HomeLaneResponse(
                id=lane_id,
                origin=origin,
                dest=dest,
                mode=mode,
                originName=_clean_optional_string(row.get("origin_name")),
                destName=_clean_optional_string(row.get("dest_name")),
                originLat=origin_lat,
                originLng=origin_lng,
                destLat=dest_lat,
                destLng=dest_lng,
                product=_clean_optional_string(row.get("product")),
                contractId=_clean_optional_string(row.get("contract_id")),
                sourceAssetId=origin,
                avgDailyVolume=float(row.get("avg_daily_volume") or 0.0),
                onTimePct=float(row.get("on_time_pct") or 0.0),
                delayMinutes=delay_minutes,
                slaRiskPct=sla_risk_pct,
                daysToZero=days_to_zero,
                ldExposureUsd=ld_exposure_usd,
                profitabilityPct=profitability_pct,
                utilizationPct=float(row.get("utilization_pct") or 0.0),
                availableCapacity=float(row.get("available_capacity") or 0.0),
                technicalStatus=technical_status,
                technicalScore=technical_score,
                activeDisruptionDays=active_disruption_days,
                vibrationAlerts=vibration_alerts,
                maxDisruptionStage=max_disruption_stage,
                upstreamDisruptionPct=upstream_disruption_pct,
                totalLandedCostPerTon=total_landed_cost_per_ton,
                forecastDiscrepancyPct=forecast_discrepancy_pct,
                supplyTpd=supply_tpd,
                demandTpd=demand_tpd,
                productionCostPerTon=production_cost_per_ton,
                distributionCostPerTon=distribution_cost_per_ton,
            )
        )
    return output


@api_app.get("/home/kpis", response_model=HomeKpiResponse)
async def get_home_kpis():
    """Top-level KPI aggregates sourced from metric views only."""
    lanes = await get_home_lanes(kpi_mode="risk")
    if not lanes:
        return HomeKpiResponse(criticalLanes=0, avgDaysToZero=0.0, totalLandedCost=0.0, avgForecastDiscrepancyPct=0.0, avgProfitabilityPct=0.0)
    return HomeKpiResponse(
        criticalLanes=sum(1 for lane in lanes if lane.technicalStatus == "critical"),
        avgDaysToZero=sum(lane.daysToZero for lane in lanes) / len(lanes),
        totalLandedCost=sum(lane.totalLandedCostPerTon * lane.avgDailyVolume * 30 for lane in lanes),
        avgForecastDiscrepancyPct=sum(lane.forecastDiscrepancyPct for lane in lanes) / len(lanes),
        avgProfitabilityPct=sum(lane.profitabilityPct for lane in lanes) / len(lanes),
    )


# ---------------------------------------------------------------------------
# Tier 1: Data-backed endpoints (replacing frontend mock generators)
# ---------------------------------------------------------------------------


@api_app.get("/home/lanes/{lane_id}/forecast")
async def get_lane_forecast(lane_id: str):
    """14-day forecast for a specific lane from forecast_metrics."""
    client = get_databricks_client()
    rows = execute_sql_rows(
        client,
        f"""
        SELECT
          `Forecast Date` AS date,
          MEASURE(`Forecasted Demand`) AS demand_tpd,
          MEASURE(`Forecasted Supply`) AS supply_tpd
        FROM demos.industrials_optimization.forecast_metrics
        WHERE `Lane ID` = '{lane_id}'
        GROUP BY `Forecast Date`, `Lane ID`
        ORDER BY `Forecast Date`
        LIMIT 30
        """.strip(),
    )
    return [
        {
            "date": str(r.get("date", "")),
            "demandTpd": float(r.get("demand_tpd") or 0.0),
            "supplyTpd": float(r.get("supply_tpd") or 0.0),
        }
        for r in rows
    ]


@api_app.get("/home/anomalies")
async def get_anomalies():
    """Customer consumption anomalies: actual vs forecast deviation per lane."""
    client = get_databricks_client()
    rows = execute_sql_rows(
        client,
        """
        WITH actual AS (
          SELECT
            `Lane ID` AS lane_id,
            `Customer Name` AS customer_name,
            `Product` AS product,
            MEASURE(`Avg Daily Volume`) AS actual_tpd
          FROM demos.industrials_optimization.consumption_metrics
          GROUP BY `Lane ID`, `Customer Name`, `Product`
        ),
        forecast AS (
          SELECT
            `Lane ID` AS lane_id,
            MEASURE(`Forecasted Demand`) AS forecasted_tpd
          FROM demos.industrials_optimization.forecast_metrics
          GROUP BY `Lane ID`
        )
        SELECT
          a.lane_id,
          a.customer_name,
          a.product,
          COALESCE(f.forecasted_tpd, 0.0) AS forecasted_tpd,
          a.actual_tpd,
          CASE
            WHEN COALESCE(f.forecasted_tpd, 0.0) > 0
            THEN ((a.actual_tpd - f.forecasted_tpd) / f.forecasted_tpd) * 100.0
            ELSE 0.0
          END AS deviation_pct
        FROM actual a
        LEFT JOIN forecast f ON a.lane_id = f.lane_id
        ORDER BY ABS(CASE
          WHEN COALESCE(f.forecasted_tpd, 0.0) > 0
          THEN ((a.actual_tpd - f.forecasted_tpd) / f.forecasted_tpd) * 100.0
          ELSE 0.0
        END) DESC
        """.strip(),
    )
    return [
        {
            "laneId": r.get("lane_id"),
            "customerName": r.get("customer_name"),
            "product": r.get("product"),
            "forecastedTpd": float(r.get("forecasted_tpd") or 0.0),
            "actualTpd": float(r.get("actual_tpd") or 0.0),
            "deviationPct": round(float(r.get("deviation_pct") or 0.0), 1),
        }
        for r in rows
    ]


@api_app.get("/home/margin")
async def get_margin(lane_id: str | None = None):
    """Margin breakdown: waterfall + Sankey data from profitability & financial metrics."""
    client = get_databricks_client()
    if lane_id:
        lane_filter = f"WHERE `Lane ID` = '{lane_id}'"
        asset_filter = f"""
        WHERE `Asset ID` IN (
          SELECT `Asset ID` FROM demos.industrials_optimization.profitability_metrics
          WHERE `Lane ID` = '{lane_id}'
          GROUP BY `Asset ID`
        )"""
    else:
        lane_filter = ""
        asset_filter = ""
    # Revenue/cost/margin from profitability_metrics
    prof_rows = execute_sql_rows(
        client,
        f"""
        SELECT
          MEASURE(`Lane Revenue`) AS revenue,
          MEASURE(`Lane Cost`) AS cost,
          MEASURE(`Lane Margin USD`) AS margin
        FROM demos.industrials_optimization.profitability_metrics
        {lane_filter}
        """.strip(),
    )
    # Energy/ops cost split from financial_metrics
    fin_rows = execute_sql_rows(
        client,
        f"""
        SELECT
          MEASURE(`Total Energy Cost`) AS energy_cost,
          MEASURE(`Total Ops Cost`) AS ops_cost
        FROM demos.industrials_optimization.financial_metrics
        {asset_filter}
        """.strip(),
    )
    revenue = float(prof_rows[0].get("revenue") or 0.0) if prof_rows else 0.0
    cost = float(prof_rows[0].get("cost") or 0.0) if prof_rows else 0.0
    margin = float(prof_rows[0].get("margin") or 0.0) if prof_rows else 0.0
    energy_cost = float(fin_rows[0].get("energy_cost") or 0.0) if fin_rows else 0.0
    ops_cost = float(fin_rows[0].get("ops_cost") or 0.0) if fin_rows else 0.0
    total_cost = energy_cost + ops_cost
    # Normalize cost splits if they don't match profitability cost
    if total_cost > 0 and cost > 0:
        energy_share = energy_cost / total_cost * cost
        ops_share = ops_cost / total_cost * cost
    else:
        energy_share = cost * 0.6
        ops_share = cost * 0.4
    waterfall = [
        {"label": "Revenue", "value": round(revenue, 2), "type": "start"},
        {"label": "Energy Cost", "value": round(-energy_share, 2), "type": "delta"},
        {"label": "Ops Cost", "value": round(-ops_share, 2), "type": "delta"},
        {"label": "Margin", "value": round(margin, 2), "type": "end"},
    ]
    sankey_nodes = [
        {"id": "revenue", "label": "Revenue"},
        {"id": "energy", "label": "Energy Cost"},
        {"id": "ops", "label": "Operations"},
        {"id": "margin", "label": "Margin"},
    ]
    sankey_links = [
        {"source": "revenue", "target": "energy", "value": round(energy_share, 2), "label": "Energy"},
        {"source": "revenue", "target": "ops", "value": round(ops_share, 2), "label": "Operations"},
        {"source": "revenue", "target": "margin", "value": round(max(0, margin), 2), "label": "Profit"},
    ]
    return {"waterfall": waterfall, "sankeyNodes": sankey_nodes, "sankeyLinks": sankey_links}


@api_app.get("/home/lanes/{lane_id}/demand-opportunities")
async def get_demand_opportunities(lane_id: str):
    """Find nearby shortage lanes that could be served from this lane's excess capacity."""
    client = get_databricks_client()
    # Get source lane info
    source_rows = execute_sql_rows(
        client,
        f"""
        SELECT
          `Lane ID` AS lane_id,
          `Asset ID` AS asset_id,
          `Origin Lat` AS origin_lat,
          `Origin Lng` AS origin_lng,
          `Product` AS product,
          MEASURE(`Available Capacity`) AS available_capacity
        FROM demos.industrials_optimization.consumption_metrics
        WHERE `Lane ID` = '{lane_id}'
        GROUP BY `Lane ID`, `Asset ID`, `Origin Lat`, `Origin Lng`, `Product`
        """.strip(),
    )
    if not source_rows:
        return []
    src = source_rows[0]
    src_lat = float(src.get("origin_lat") or 0)
    src_lng = float(src.get("origin_lng") or 0)
    src_product = src.get("product", "")
    # Find shortage lanes (demand > supply)
    shortage_rows = execute_sql_rows(
        client,
        f"""
        WITH shortage AS (
          SELECT
            `Lane ID` AS lane_id,
            `Customer Name` AS customer_name,
            `Customer ID` AS customer_id,
            `Asset ID` AS asset_id,
            `Product` AS product,
            `Dest Lat` AS dest_lat,
            `Dest Lng` AS dest_lng,
            MEASURE(`Avg Daily Volume`) AS avg_daily_volume
          FROM demos.industrials_optimization.consumption_metrics
          WHERE `Product` = '{src_product}' AND `Lane ID` != '{lane_id}'
          GROUP BY `Lane ID`, `Customer Name`, `Customer ID`, `Asset ID`, `Product`, `Dest Lat`, `Dest Lng`
        ),
        forecast AS (
          SELECT
            `Lane ID` AS lane_id,
            MEASURE(`Forecasted Demand`) AS demand_tpd,
            MEASURE(`Forecasted Supply`) AS supply_tpd
          FROM demos.industrials_optimization.forecast_metrics
          GROUP BY `Lane ID`
        )
        SELECT
          s.lane_id, s.customer_name, s.customer_id, s.asset_id,
          s.product, s.dest_lat, s.dest_lng, s.avg_daily_volume,
          COALESCE(f.demand_tpd, 0) AS demand_tpd,
          COALESCE(f.supply_tpd, 0) AS supply_tpd,
          COALESCE(f.demand_tpd, 0) - COALESCE(f.supply_tpd, 0) AS unmet_demand_tpd
        FROM shortage s
        LEFT JOIN forecast f ON s.lane_id = f.lane_id
        WHERE COALESCE(f.demand_tpd, 0) > COALESCE(f.supply_tpd, 0)
        ORDER BY (COALESCE(f.demand_tpd, 0) - COALESCE(f.supply_tpd, 0)) DESC
        LIMIT 10
        """.strip(),
    )
    opportunities = []
    for r in shortage_rows:
        d_lat = float(r.get("dest_lat") or 0)
        d_lng = float(r.get("dest_lng") or 0)
        if d_lat and d_lng and src_lat and src_lng:
            dlat = math.radians(d_lat - src_lat)
            dlng = math.radians(d_lng - src_lng)
            a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(src_lat)) * math.cos(math.radians(d_lat)) * math.sin(dlng / 2) ** 2
            dist_km = 6371.0 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        else:
            dist_km = 0.0
        est_tlc = dist_km * 0.12
        opportunities.append({
            "targetCustomerId": r.get("customer_id"),
            "targetCustomerName": r.get("customer_name"),
            "sourceLaneId": lane_id,
            "sourceAssetId": src.get("asset_id"),
            "unmetDemandTpd": round(float(r.get("unmet_demand_tpd") or 0), 1),
            "distanceKm": round(dist_km, 0),
            "estimatedTlcPerTon": round(est_tlc, 2),
            "currentTlcPerTon": round(float(r.get("avg_daily_volume") or 0) * 0.08, 2),
            "savingsPerTon": round(max(0, float(r.get("avg_daily_volume") or 0) * 0.08 - est_tlc), 2),
            "product": r.get("product"),
        })
    return opportunities


@api_app.get("/home/upsell-opportunities")
async def get_upsell_opportunities():
    """Lanes where supply exceeds demand by >5%: upsell potential."""
    client = get_databricks_client()
    rows = execute_sql_rows(
        client,
        """
        WITH forecast AS (
          SELECT
            `Lane ID` AS lane_id,
            `Customer Name` AS customer_name,
            `Product` AS product,
            MEASURE(`Forecasted Supply`) AS supply_tpd,
            MEASURE(`Forecasted Demand`) AS demand_tpd,
            MEASURE(`Supply/Demand Discrepancy`) AS excess_tpd
          FROM demos.industrials_optimization.forecast_metrics
          GROUP BY `Lane ID`, `Customer Name`, `Product`
        ),
        contract AS (
          SELECT
            `Lane ID` AS lane_id,
            MEASURE(`Contract Price USD`) AS price_per_ton
          FROM demos.industrials_optimization.contract_metrics
          GROUP BY `Lane ID`
        )
        SELECT
          f.lane_id, f.customer_name, f.product,
          f.supply_tpd, f.demand_tpd, f.excess_tpd,
          (f.excess_tpd / NULLIF(f.demand_tpd, 0)) * 100.0 AS excess_pct,
          COALESCE(c.price_per_ton, 200.0) AS price_per_ton
        FROM forecast f
        LEFT JOIN contract c ON f.lane_id = c.lane_id
        WHERE f.excess_tpd > 0
          AND (f.excess_tpd / NULLIF(f.demand_tpd, 0)) > 0.05
        ORDER BY f.excess_tpd DESC
        LIMIT 20
        """.strip(),
    )
    return [
        {
            "laneId": r.get("lane_id"),
            "customerName": r.get("customer_name"),
            "product": r.get("product"),
            "excessSupplyTpd": round(float(r.get("excess_tpd") or 0), 1),
            "excessPct": round(float(r.get("excess_pct") or 0), 1),
            "suggestedUpsellTpd": round(float(r.get("excess_tpd") or 0) * 0.7, 1),
            "pricePerTonUsd": round(float(r.get("price_per_ton") or 200), 2),
            "contractTerm": "12 months",
            "startDate": "2026-04-01",
            "estimatedRevenueUsd": round(float(r.get("excess_tpd") or 0) * 0.7 * float(r.get("price_per_ton") or 200) * 30, 0),
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Tier 2: Incident & Contract Endpoints (derived from metric signals)
# ---------------------------------------------------------------------------


@api_app.get("/home/incidents")
async def get_incidents(lane_id: str | None = None):
    """Derive incidents from production + consumption metric signals."""
    client = get_databricks_client()
    lane_filter = f"WHERE lane_id = '{lane_id}'" if lane_id else ""
    rows = execute_sql_rows(
        client,
        f"""
        WITH production_signals AS (
          SELECT
            `Asset ID` AS asset_id,
            `Date` AS date,
            MEASURE(`Vibration Alerts`) AS vibration_alerts,
            MEASURE(`Disruption Points`) AS disruption_points,
            MAX(`Disruption Stage`) AS disruption_stage
          FROM demos.industrials_optimization.production_metrics
          GROUP BY `Asset ID`, `Date`, `Disruption Stage`
          HAVING MEASURE(`Vibration Alerts`) > 50
             OR MEASURE(`Disruption Points`) > 0
        ),
        consumption_signals AS (
          SELECT
            `Lane ID` AS lane_id,
            `Asset ID` AS asset_id,
            `Customer Name` AS customer_name,
            `Date` AS date,
            `Mode` AS mode,
            MEASURE(`Avg SLA Risk Pct`) AS sla_risk,
            MEASURE(`Days to Zero Operational`) AS days_to_zero,
            MEASURE(`Upstream Disruption Pct`) AS upstream_disruption_pct,
            MEASURE(`Propagation Stage Max`) AS propagation_stage
          FROM demos.industrials_optimization.consumption_metrics
          GROUP BY `Lane ID`, `Asset ID`, `Customer Name`, `Date`, `Mode`
          HAVING MEASURE(`Avg SLA Risk Pct`) > 0.15
             OR MEASURE(`Days to Zero Operational`) < 4
             OR MEASURE(`Propagation Stage Max`) >= 2
        )
        SELECT * FROM (
          SELECT
            cs.lane_id,
            cs.date AS timestamp,
            CASE
              WHEN ps.vibration_alerts > 80 THEN 'vibration_anomaly'
              WHEN ps.disruption_stage IN ('Step 2', 'Step 3') THEN 'supply_shortfall'
              WHEN cs.sla_risk > 0.25 AND cs.mode = 'truck' THEN 'weather_disruption'
              WHEN cs.days_to_zero < 4 THEN 'inventory_critical'
              WHEN cs.propagation_stage >= 2 THEN 'pipeline_constraint'
              ELSE 'facility_outage'
            END AS type,
            CONCAT(cs.lane_id, '-', CAST(cs.date AS STRING)) AS ref,
            CASE
              WHEN ps.vibration_alerts > 80 THEN 'Elevated vibration detected on compressor'
              WHEN ps.disruption_stage IN ('Step 2', 'Step 3') THEN 'Production disruption at supply asset'
              WHEN cs.sla_risk > 0.25 AND cs.mode = 'truck' THEN 'Delivery risk from weather/routing'
              WHEN cs.days_to_zero < 4 THEN 'Customer tank critically low'
              WHEN cs.propagation_stage >= 2 THEN 'Upstream disruption propagating to lane'
              ELSE 'General facility event'
            END AS cause,
            CASE
              WHEN ps.vibration_alerts > 100 OR ps.disruption_stage = 'Step 3' THEN 'high'
              WHEN ps.vibration_alerts > 60 OR cs.days_to_zero < 2 THEN 'medium'
              ELSE 'low'
            END AS severity,
            COALESCE(ps.vibration_alerts / 100.0, cs.sla_risk, 0.5) AS confidence,
            CAST(COALESCE(ps.disruption_points, 0) * 15 AS INT) AS impact_minutes
          FROM consumption_signals cs
          LEFT JOIN production_signals ps ON cs.asset_id = ps.asset_id AND cs.date = ps.date
        ) incidents
        {lane_filter}
        ORDER BY timestamp DESC
        LIMIT 50
        """.strip(),
    )
    return [
        {
            "laneId": r.get("lane_id"),
            "timestamp": str(r.get("timestamp", "")),
            "type": r.get("type"),
            "ref": r.get("ref"),
            "cause": r.get("cause"),
            "severity": r.get("severity"),
            "confidence": round(float(r.get("confidence") or 0.5), 2),
            "impactMinutes": int(r.get("impact_minutes") or 0),
        }
        for r in rows
    ]


@api_app.get("/home/supply-tickets")
async def get_supply_tickets(lane_id: str | None = None):
    """Active supply tickets derived from consumption delays and SLA risk."""
    client = get_databricks_client()
    lane_filter = f"AND `Lane ID` = '{lane_id}'" if lane_id else ""
    rows = execute_sql_rows(
        client,
        f"""
        SELECT
          `Lane ID` AS lane_id,
          `Contract ID` AS contract_id,
          `Customer ID` AS customer_id,
          `Customer Name` AS customer_name,
          `Product` AS product,
          MEASURE(`Avg Delay Minutes`) AS delay_minutes,
          MEASURE(`Avg SLA Risk Pct`) AS sla_risk,
          MEASURE(`Avg Daily Volume`) AS daily_volume
        FROM demos.industrials_optimization.consumption_metrics
        WHERE 1=1 {lane_filter}
        GROUP BY `Lane ID`, `Contract ID`, `Customer ID`, `Customer Name`, `Product`
        HAVING MEASURE(`Avg Delay Minutes`) > 30 OR MEASURE(`Avg SLA Risk Pct`) > 0.10
        ORDER BY MEASURE(`Avg Delay Minutes`) DESC
        LIMIT 20
        """.strip(),
    )
    tickets = []
    for i, r in enumerate(rows):
        delay = float(r.get("delay_minutes") or 0)
        priority = "HIGH" if delay > 90 or float(r.get("sla_risk") or 0) > 0.25 else ("MED" if delay > 45 else "LOW")
        tickets.append({
            "trackingId": f"TKT-{2026001 + i}",
            "customerId": r.get("customer_id"),
            "contractId": r.get("contract_id"),
            "priority": priority,
            "laneId": r.get("lane_id"),
            "promisedETA": "2026-03-06T08:00:00Z",
            "currentETA": f"2026-03-06T{8 + int(delay / 60):02d}:{int(delay % 60):02d}:00Z",
            "product": r.get("product"),
            "requestedVolumeTons": round(float(r.get("daily_volume") or 0), 1),
            "siteName": r.get("customer_name"),
        })
    return tickets


@api_app.get("/home/lanes/{lane_id}/contract")
async def get_lane_contract(lane_id: str):
    """Contract context for a lane from contract_metrics."""
    client = get_databricks_client()
    rows = execute_sql_rows(
        client,
        f"""
        SELECT
          `Contract ID` AS contract_id,
          `Customer Name` AS customer_name,
          `Product` AS product,
          MEASURE(`Committed Volume`) AS committed_volume,
          MEASURE(`Actual Volume`) AS actual_volume,
          MEASURE(`Contract Price USD`) AS price_per_ton,
          MEASURE(`LD Exposure`) AS ld_exposure,
          MEASURE(`Volume Gap Tons`) AS volume_gap
        FROM demos.industrials_optimization.contract_metrics
        WHERE `Lane ID` = '{lane_id}'
        GROUP BY `Contract ID`, `Customer Name`, `Product`
        """.strip(),
    )
    if not rows:
        return {"contract": None, "gasOrderOptions": []}
    r = rows[0]
    committed = float(r.get("committed_volume") or 0)
    actual = float(r.get("actual_volume") or 0)
    price = float(r.get("price_per_ton") or 0)
    contract = {
        "contractId": r.get("contract_id"),
        "customerName": r.get("customer_name"),
        "product": r.get("product"),
        "committedVolumeTpd": round(committed / 30, 1) if committed else 0,
        "actualVolumeTpd": round(actual / 30, 1) if actual else 0,
        "pricePerTonUsd": round(price, 2),
        "ldPenaltyRateUsd": round(price * 0.15, 2),
        "supplyDemandGapTpd": round((committed - actual) / 30, 1) if committed else 0,
        "guaranteeOfSupply": committed > actual,
    }
    return {"contract": contract, "gasOrderOptions": []}


# ---------------------------------------------------------------------------
# Tier 3: Maintenance & Vendor Endpoints (from new tables)
# ---------------------------------------------------------------------------


@api_app.get("/home/lanes/{lane_id}/maintenance")
async def get_lane_maintenance(lane_id: str):
    """Maintenance context: technicians, parts, work orders for lane's supply asset."""
    client = get_databricks_client()
    # Extract asset_id from lane_id (format: HUB-XXX-CUST-YYYY-PRODUCT)
    parts = lane_id.split("-")
    asset_id = f"{parts[0]}-{parts[1]}" if len(parts) >= 2 else lane_id
    # Staff
    try:
        staff_rows = execute_sql_rows(
            client,
            f"""
            SELECT tech_id, name, role, available, certification_level
            FROM demos.industrials_optimization.dim_technicians
            WHERE asset_id = '{asset_id}'
            ORDER BY available DESC, name
            """.strip(),
        )
    except Exception:
        staff_rows = []
    staff = [
        {
            "id": r.get("tech_id"),
            "name": r.get("name"),
            "role": r.get("role"),
            "available": bool(r.get("available")),
        }
        for r in staff_rows
    ]
    # Parts
    try:
        parts_rows = execute_sql_rows(
            client,
            f"""
            SELECT sku, name, qty_on_hand, qty_needed, lead_time_days
            FROM demos.industrials_optimization.dim_parts_inventory
            WHERE asset_id = '{asset_id}'
            ORDER BY qty_on_hand ASC
            """.strip(),
        )
    except Exception:
        parts_rows = []
    parts_list = [
        {
            "sku": r.get("sku"),
            "name": r.get("name"),
            "qtyOnHand": int(r.get("qty_on_hand") or 0),
            "qtyNeeded": int(r.get("qty_needed") or 1),
            "leadTimeDays": int(r.get("lead_time_days") or 0),
        }
        for r in parts_rows
    ]
    # Work orders
    try:
        wo_rows = execute_sql_rows(
            client,
            f"""
            SELECT work_order_id, date_opened, asset_id, summary, resolution_days
            FROM demos.industrials_optimization.fact_work_orders
            WHERE asset_id = '{asset_id}'
            ORDER BY date_opened DESC
            LIMIT 10
            """.strip(),
        )
    except Exception:
        wo_rows = []
    historical_fixes = [
        {
            "workOrderId": r.get("work_order_id"),
            "date": str(r.get("date_opened", "")),
            "assetId": r.get("asset_id"),
            "summary": r.get("summary"),
            "resolutionDays": int(r.get("resolution_days") or 0),
        }
        for r in wo_rows
    ]
    return {
        "staff": staff,
        "parts": parts_list,
        "historicalFixes": historical_fixes,
        "techDocLinks": [
            {"title": f"Terminal Maintenance Manual - {asset_id}", "url": f"#docs/{asset_id}/manual"},
            {"title": "Transfer Pump Troubleshooting Guide", "url": "#docs/transfer-pump-troubleshooting"},
        ],
    }


@api_app.get("/home/lanes/{lane_id}/vendors")
async def get_lane_vendors(lane_id: str):
    """Available external supply vendors for procurement."""
    client = get_databricks_client()
    # Extract product from lane_id
    product = lane_id.split("-")[-1] if "-" in lane_id else "CRD"
    try:
        rows = execute_sql_rows(
            client,
            f"""
            SELECT vendor_id, name, lat, lng, products, capacity_tpd, price_premium_pct, eta_hours
            FROM demos.industrials_optimization.dim_vendors
            WHERE products LIKE '%{product}%'
            ORDER BY eta_hours ASC
            """.strip(),
        )
    except Exception:
        rows = []
    return [
        {
            "vendorName": r.get("name"),
            "laneId": lane_id,
            "product": product,
            "availableCapacityTpd": float(r.get("capacity_tpd") or 0),
            "pricePerTonUsd": round(200.0 * (1 + float(r.get("price_premium_pct") or 10) / 100), 2),
            "etaHours": float(r.get("eta_hours") or 0),
            "notes": f"Premium: {r.get('price_premium_pct')}%",
            "vendorLat": float(r.get("lat") or 0),
            "vendorLng": float(r.get("lng") or 0),
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# RCA Summary Endpoint
# ---------------------------------------------------------------------------


class RcaSummaryRequest(BaseModel):
    laneId: str = Field(..., min_length=1)
    incidents: list[dict[str, Any]] = Field(default_factory=list)


class RcaSummaryResponse(BaseModel):
    summary: str


def _fallback_rca_summary(
    lane_id: str,
    incidents: list[dict[str, Any]],
    maintenance: dict[str, Any],
) -> str:
    high_count = sum(1 for i in incidents if str(i.get("severity", "")).lower() == "high")
    primary = incidents[0].get("cause") if incidents else "No primary cause identified yet."
    staff = maintenance.get("staff", []) if isinstance(maintenance, dict) else []
    available_staff = [s for s in staff if isinstance(s, dict) and s.get("available")]
    lead_text = "Dispatch an available technician immediately." if available_staff else "Escalate staffing coverage and assign on-call technician."
    return (
        f"Root cause summary for lane {lane_id}:\n"
        f"- High severity incidents: {high_count}\n"
        f"- Primary driver: {primary}\n"
        f"- Immediate action: {lead_text}\n"
        "- Follow-up: Secure critical parts and validate throughput recovery in the next operating window."
    )


@api_app.post("/home/rca-summary", response_model=RcaSummaryResponse)
async def get_rca_summary(payload: RcaSummaryRequest):
    lane_id = payload.laneId.strip()
    incidents = payload.incidents
    if not incidents:
        try:
            derived_incidents = await get_incidents(lane_id=lane_id)
            incidents = derived_incidents if isinstance(derived_incidents, list) else []
        except Exception:
            incidents = []

    try:
        maintenance = await get_lane_maintenance(lane_id)
    except Exception:
        maintenance = {}

    context = {
        "laneId": lane_id,
        "incidents": incidents[:5],
        "maintenance": {
            "availableStaff": [
                {"id": s.get("id"), "name": s.get("name"), "role": s.get("role")}
                for s in (maintenance.get("staff", []) if isinstance(maintenance, dict) else [])
                if isinstance(s, dict) and s.get("available")
            ][:3],
            "partsAtRisk": [
                {"sku": p.get("sku"), "name": p.get("name"), "qtyOnHand": p.get("qtyOnHand"), "qtyNeeded": p.get("qtyNeeded")}
                for p in (maintenance.get("parts", []) if isinstance(maintenance, dict) else [])
                if isinstance(p, dict) and int(p.get("qtyOnHand") or 0) < int(p.get("qtyNeeded") or 0)
            ][:3],
            "recentFixes": [
                {"workOrderId": w.get("workOrderId"), "summary": w.get("summary")}
                for w in (maintenance.get("historicalFixes", []) if isinstance(maintenance, dict) else [])
                if isinstance(w, dict)
            ][:2],
        },
    }
    messages = [
        {
            "role": "system",
            "content": (
                "You are an operations reliability assistant. Produce a short root-cause summary in plain text. "
                "Include: primary cause, impact severity, immediate action, and one follow-up action. "
                "Keep it under 90 words."
            ),
        },
        {
            "role": "user",
            "content": f"Generate a root-cause summary using this context:\n{json.dumps(context, default=str)}",
        },
    ]

    try:
        summary = await asyncio.to_thread(_text_response_sync, messages)
        if summary and summary.strip():
            return RcaSummaryResponse(summary=summary.strip())
    except Exception as e:
        logger.warning("RCA summary generation failed for %s: %s", lane_id, e)

    return RcaSummaryResponse(summary=_fallback_rca_summary(lane_id, incidents, maintenance))


# ---------------------------------------------------------------------------
# Agent Chat Endpoints — structured action routing + unstructured text
# ---------------------------------------------------------------------------


class AgentOrchestrateRequest(BaseModel):
    message: str
    available_actions: list[str] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)
    history: list[dict[str, str]] = Field(default_factory=list)
    genie_conversation_id: str | None = None
    reference_memory: dict[str, Any] = Field(default_factory=dict)


class AgentActionDecision(BaseModel):
    action: str
    reason: str


class AgentOrchestrateResponse(BaseModel):
    action: str
    reason: str
    text: str | None = None
    action_args: dict[str, Any] = Field(default_factory=dict)
    suggested_followups: list[str] = Field(default_factory=list)
    genie_conversation_id: str | None = None
    source: str = "databricks"


class GenieChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    conversationId: str | None = None
    spaceId: str | None = None
    includeRows: bool = True


class GenieQueryResult(BaseModel):
    attachmentId: str
    description: str | None = None
    query: str | None = None
    statementId: str | None = None
    rowCount: int | None = None
    rows: list[dict[str, Any]] = Field(default_factory=list)


class GenieChatResponse(BaseModel):
    spaceId: str
    conversationId: str
    messageId: str
    status: str
    text: str | None = None
    suggestedQuestions: list[str] = Field(default_factory=list)
    queryResults: list[GenieQueryResult] = Field(default_factory=list)
    error: str | None = None


def resolve_genie_space_id(space_id: str | None) -> str:
    """Resolve Genie space ID from request or env fallback."""
    resolved = (space_id or os.getenv("DATABRICKS_GENIE_SPACE_ID", DEFAULT_GENIE_SPACE_ID)).strip()
    if not resolved:
        raise HTTPException(
            status_code=500,
            detail=(
                "Could not resolve Genie space. Set DATABRICKS_GENIE_SPACE_ID "
                "or provide spaceId in the request."
            ),
        )
    return resolved


def _enum_name(value: Any) -> str:
    if value is None:
        return "UNKNOWN"
    return str(getattr(value, "name", value))


def _send_genie_message_sync(
    client: WorkspaceClient,
    *,
    space_id: str,
    content: str,
    conversation_id: str | None,
):
    if conversation_id:
        return client.genie.create_message_and_wait(
            space_id=space_id,
            conversation_id=conversation_id,
            content=content,
        )
    return client.genie.start_conversation_and_wait(space_id=space_id, content=content)


def _build_genie_chat_response_sync(
    client: WorkspaceClient,
    *,
    space_id: str,
    genie_message: Any,
    include_rows: bool,
) -> GenieChatResponse:
    attachments = getattr(genie_message, "attachments", None) or []
    text_parts: list[str] = []
    suggested_questions: list[str] = []
    query_results: list[GenieQueryResult] = []

    conversation_id = str(getattr(genie_message, "conversation_id", "") or "")
    message_id = str(getattr(genie_message, "id", "") or getattr(genie_message, "message_id", "") or "")

    for attachment in attachments:
        text_obj = getattr(attachment, "text", None)
        if text_obj and getattr(text_obj, "content", None):
            text_parts.append(str(text_obj.content))

        suggested_obj = getattr(attachment, "suggested_questions", None)
        if suggested_obj and getattr(suggested_obj, "questions", None):
            for q in suggested_obj.questions:
                q_text = str(q).strip()
                if q_text:
                    suggested_questions.append(q_text)

        query_obj = getattr(attachment, "query", None)
        attachment_id = getattr(attachment, "attachment_id", None)
        if query_obj and attachment_id:
            qr = GenieQueryResult(
                attachmentId=str(attachment_id),
                description=getattr(query_obj, "description", None),
                query=getattr(query_obj, "query", None),
                statementId=getattr(query_obj, "statement_id", None),
                rowCount=getattr(getattr(query_obj, "query_result_metadata", None), "row_count", None),
                rows=[],
            )
            if include_rows and conversation_id and message_id:
                try:
                    result = client.genie.get_message_attachment_query_result(
                        space_id=space_id,
                        conversation_id=conversation_id,
                        message_id=message_id,
                        attachment_id=str(attachment_id),
                    )
                    statement_response = getattr(result, "statement_response", None)
                    state = getattr(getattr(statement_response, "status", None), "state", None)
                    if state == StatementState.SUCCEEDED:
                        rows = parse_sql_results(statement_response)
                        qr.rows = rows
                        if qr.rowCount is None:
                            qr.rowCount = len(rows)
                except Exception as fetch_err:
                    logger.warning("Failed to fetch Genie attachment rows: %s", fetch_err)
            query_results.append(qr)

    combined_text = "\n\n".join(dict.fromkeys(part.strip() for part in text_parts if part and part.strip())) or None
    combined_suggestions = list(dict.fromkeys(suggested_questions))
    error_obj = getattr(genie_message, "error", None)
    error_text = str(error_obj) if error_obj else None

    return GenieChatResponse(
        spaceId=space_id,
        conversationId=conversation_id,
        messageId=message_id,
        status=_enum_name(getattr(genie_message, "status", None)),
        text=combined_text,
        suggestedQuestions=combined_suggestions,
        queryResults=query_results,
        error=error_text,
    )


@api_app.post("/genie/chat", response_model=GenieChatResponse)
async def genie_chat(payload: GenieChatRequest):
    """Send a question to Genie and optionally return query result rows."""
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message must not be empty.")

    client = get_databricks_client()
    space_id = resolve_genie_space_id(payload.spaceId)

    try:
        genie_message = await asyncio.to_thread(
            _send_genie_message_sync,
            client,
            space_id=space_id,
            content=message,
            conversation_id=payload.conversationId,
        )
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error": f"Failed to send Genie message: {type(e).__name__}",
                "message": str(e),
                "spaceId": space_id,
                "conversationId": payload.conversationId,
            },
        ) from e

    try:
        return await asyncio.to_thread(
            _build_genie_chat_response_sync,
            client,
            space_id=space_id,
            genie_message=genie_message,
            include_rows=payload.includeRows,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "error": f"Failed to build Genie response: {type(e).__name__}",
                "message": str(e),
            },
        ) from e


def _build_action_decision_messages(
    user_message: str,
    available_actions: list[str],
    context: dict[str, Any],
    history: list[dict[str, str]],
    reference_memory: dict[str, Any],
) -> list[dict[str, str]]:
    action_list = ", ".join(f'"{a}"' for a in available_actions)
    context_summary = json.dumps(context, default=str) if context else "{}"
    reference_summary = json.dumps(reference_memory, default=str) if reference_memory else "{}"
    metric_views = ", ".join(GENIE_METRIC_VIEWS)

    system_prompt = (
        "You are an action-routing assistant for a US Gulf Coast oil and gas operations dashboard. "
        "Your ONLY job is to decide whether the user is requesting one of the available actions, "
        "or whether they are asking a general question.\n\n"
        "IMPORTANT RULES:\n"
        "- If \"ask_genie\" is available and the user asks a data/metrics question, choose \"ask_genie\".\n"
        "- Use \"ask_genie\" for analytical questions about lanes, risk, days to zero, LD exposure, margin, contracts, forecasts, carbon, utilization, and KPI trends.\n"
        "- IMPORTANT: \"select_lane\" and \"select_kpi\" are UI navigation actions, NOT SQL actions.\n"
        "- Use \"select_lane\" when the user asks to select/focus/highlight a lane in the dashboard UI. Put lane id in action_args.lane_id.\n"
        "- Use \"select_kpi\" when the user asks to switch/select a KPI tab in the dashboard UI. Put KPI mode in action_args.kpi.\n"
        "- Do NOT choose \"ask_genie\" for commands like \"select it\", \"focus this lane\", \"switch KPI\", or \"go to LD exposure\".\n"
        "- SQL words like SELECT in generated queries are irrelevant to routing; treat user \"select\" language as UI intent when referring to lane/KPI selection.\n"
        "- Use \"order_x_tpd\" when activeKpi is totalLandedCost and user asks to order barrels or supply with a quantity. Put amount in action_args.tpd.\n"
        "- If the user says \"select it/that one\", use reference_memory.lastLaneIds to resolve lane_id.\n"
        "- If the user mentions an unplanned terminal, fractionator, pipeline hub, or facility outage and asks to schedule or assign a work order, choose \"assign_work_order\" when available.\n"
        "- Treat \"schedule work order\", \"assign work order\", and \"create mitigation lane\" as equivalent intents for \"assign_work_order\".\n"
        "- Choose \"no_action\" for purely conversational requests that do not need data retrieval.\n"
        "- If the user says \"purchase barrels\", \"buy supply\", \"purchase spot barrels\", or similar and \"partner_purchase\" is available (lane selected on forecast discrepancy), choose it.\n"
        "- Never invent actions that are not in the available list.\n\n"
        f"Genie can query these metric views: [{metric_views}]\n\n"
        "Valid KPI enum values for action_args.kpi: risk, forecastDiscrepancy, totalLandedCost, profitability.\n\n"
        f"Available actions: [{action_list}]\n\n"
        f"Current dashboard context:\n{context_summary}\n\n"
        f"Reference memory:\n{reference_summary}"
    )

    msgs: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    for h in history[-6:]:
        role = h.get("role", "user")
        if role not in {"user", "assistant"}:
            role = "user"
        msgs.append({"role": role, "content": h.get("content", "")})
    msgs.append({"role": "user", "content": user_message})
    return msgs


def _build_action_response_format(available_actions: list[str]) -> dict:
    enum_values = ["no_action"] + [a for a in available_actions if a != "no_action"]
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "action_decision",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": enum_values,
                    },
                    "reason": {
                        "type": "string",
                    },
                    "action_args": {
                        "type": "object",
                        "properties": {
                            "lane_id": {"type": "string"},
                            "kpi": {
                                "type": "string",
                                "enum": ["risk", "forecastDiscrepancy", "totalLandedCost", "profitability"],
                            },
                            "tpd": {"type": "number"},
                        },
                        "additionalProperties": False,
                    },
                },
                "required": ["action", "reason"],
                "additionalProperties": False,
            },
        },
    }


def _structured_decision_sync(
    messages: list[dict[str, str]],
    response_format: dict,
) -> dict:
    def _candidate_json_strings(raw: str) -> list[str]:
        txt = (raw or "").strip()
        if not txt:
            return []
        candidates = [txt]
        # Strip fenced code blocks when present.
        if txt.startswith("```"):
            fenced = txt.strip("`")
            lines = fenced.splitlines()
            if len(lines) >= 2:
                candidates.append("\n".join(lines[1:]).strip())
        # Extract the outermost JSON object substring if there is extra text.
        start = txt.find("{")
        end = txt.rfind("}")
        if start != -1 and end != -1 and end > start:
            candidates.append(txt[start:end + 1].strip())
        # Deduplicate while preserving order.
        out: list[str] = []
        for c in candidates:
            if c and c not in out:
                out.append(c)
        return out

    def _extract_action_from_text(raw: str) -> dict:
        txt = (raw or "").lower()
        # Last-resort heuristic to avoid surfacing parse errors.
        if "order_x_tpd" in txt or ("order" in txt and "tpd" in txt):
            tpd_match = re.search(r"(\d+(?:\.\d+)?)\s*tpd", txt)
            if tpd_match:
                try:
                    tpd = float(tpd_match.group(1))
                    return {"action": "order_x_tpd", "reason": "Heuristic parse fallback", "action_args": {"tpd": tpd}}
                except ValueError:
                    pass
        if "select_kpi" in txt or "kpi" in txt:
            for kpi in ["forecastdiscrepancy", "totallandedcost", "profitability", "risk"]:
                if kpi in txt:
                    value = {
                        "forecastdiscrepancy": "forecastDiscrepancy",
                        "totallandedcost": "totalLandedCost",
                        "profitability": "profitability",
                        "risk": "risk",
                    }[kpi]
                    return {"action": "select_kpi", "reason": "Heuristic parse fallback", "action_args": {"kpi": value}}
        if "select_lane" in txt or "select" in txt or "focus" in txt:
            m = re.search(r"HUB-\d{3}-CUST-\d{4}-(?:CRD|NGL|LNG)", raw or "", flags=re.IGNORECASE)
            if m:
                return {"action": "select_lane", "reason": "Heuristic parse fallback", "action_args": {"lane_id": m.group(0).upper()}}
        if "ask_genie" in txt:
            return {"action": "ask_genie", "reason": "Heuristic parse fallback", "action_args": {}}
        return {"action": "no_action", "reason": "Could not parse structured decision response", "action_args": {}}

    client = get_openai_client()
    response = client.chat.completions.create(
        model=LLM_ENDPOINT_NAME,
        messages=messages,
        temperature=0.0,
        max_tokens=300,
        response_format=response_format,
    )
    raw = _extract_content(response.choices[0].message)

    for candidate in _candidate_json_strings(raw):
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue

    logger.warning("Failed to parse structured decision JSON, applying fallback. raw=%r", raw)
    return _extract_action_from_text(raw)


def _build_text_response_messages(
    user_message: str,
    context: dict[str, Any],
    history: list[dict[str, str]],
) -> list[dict[str, str]]:
    context_summary = json.dumps(context, default=str) if context else "{}"

    system_prompt = (
        "You are an AI assistant for a US Gulf Coast oil and gas operations dashboard. "
        "You help operators understand lane metrics, LD exposure, forecast discrepancies, "
        "margin analysis, terminal operations, pipeline constraints, and supply chain operations.\n\n"
        "Be concise, factual, and professional. Use the provided dashboard context to give "
        "specific, data-driven answers. If the context includes lane details, reference them.\n\n"
        f"Current dashboard context:\n{context_summary}"
    )

    msgs: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    for h in history[-6:]:
        msgs.append({"role": h.get("role", "user"), "content": h.get("content", "")})
    msgs.append({"role": "user", "content": user_message})
    return msgs


def _text_response_sync(messages: list[dict[str, str]]) -> str:
    client = get_openai_client()
    response = client.chat.completions.create(
        model=LLM_ENDPOINT_NAME,
        messages=messages,
        temperature=0.4,
        max_tokens=1000,
    )
    return _extract_content(response.choices[0].message)


def _render_genie_response_text(resp: GenieChatResponse) -> str:
    sections: list[str] = []
    if resp.text:
        sections.append(resp.text.strip())
    if resp.queryResults:
        first = resp.queryResults[0]
        if first.rowCount is not None:
            sections.append(f"Rows: {first.rowCount}")
    if resp.suggestedQuestions:
        suggestions = "\n".join(f"- {q}" for q in resp.suggestedQuestions[:3])
        sections.append(f"Suggested follow-ups:\n{suggestions}")
    return "\n\n".join(s for s in sections if s).strip() or "Genie returned no content."


@api_app.post("/agent/orchestrate", response_model=AgentOrchestrateResponse)
async def agent_orchestrate(req: AgentOrchestrateRequest):
    """Two-stage agent orchestration: structured action decision, then optional text fallback."""
    action = "no_action"
    reason = ""
    text = None
    action_args: dict[str, Any] = {}
    suggested_followups: list[str] = []
    genie_conversation_id: str | None = req.genie_conversation_id

    try:
        if req.available_actions:
            decision_messages = _build_action_decision_messages(
                req.message, req.available_actions, req.context, req.history, req.reference_memory,
            )
            response_format = _build_action_response_format(req.available_actions)
            decision = await asyncio.to_thread(
                _structured_decision_sync, decision_messages, response_format,
            )
            action = decision.get("action", "no_action")
            reason = decision.get("reason", "")
            raw_action_args = decision.get("action_args", {})
            action_args = raw_action_args if isinstance(raw_action_args, dict) else {}

            if action != "no_action" and action not in req.available_actions:
                logger.warning("Model returned unavailable action %s, falling back", action)
                action = "no_action"
                reason = "Action not currently available"
                action_args = {}

            if action == "select_lane":
                lane_id = action_args.get("lane_id")
                memory_lane_ids = req.reference_memory.get("lastLaneIds", [])
                if not isinstance(memory_lane_ids, list):
                    memory_lane_ids = []
                memory_lane_ids = [str(x) for x in memory_lane_ids if isinstance(x, str) and x.strip()]
                user_text = req.message.lower()
                lane_pattern_present = "asu-" in user_text and "-cust-" in user_text
                pronoun_select = any(token in user_text for token in ["select it", "select that", "focus on it", "focus on that"])
                if pronoun_select and not lane_pattern_present and len(memory_lane_ids) > 1:
                    action = "no_action"
                    reason = "Multiple lanes were recently referenced; please specify which lane to select."
                    action_args = {}
                elif (not isinstance(lane_id, str) or not lane_id.strip()) and len(memory_lane_ids) == 1:
                    action_args = {"lane_id": memory_lane_ids[0]}
                elif not isinstance(lane_id, str) or not lane_id.strip():
                    action = "no_action"
                    reason = "Need a lane identifier to select a lane"
                    action_args = {}
                else:
                    action_args = {"lane_id": lane_id.strip()}

            if action == "select_kpi":
                kpi = action_args.get("kpi")
                valid_kpis = {"risk", "forecastDiscrepancy", "totalLandedCost", "profitability"}
                if not isinstance(kpi, str) or kpi not in valid_kpis:
                    action = "no_action"
                    reason = "Need a valid KPI (risk, forecastDiscrepancy, totalLandedCost, profitability)"
                    action_args = {}
                else:
                    action_args = {"kpi": kpi}

            if action == "order_x_tpd":
                tpd = action_args.get("tpd")
                if isinstance(tpd, str):
                    try:
                        tpd = float(tpd)
                    except ValueError:
                        tpd = None
                if not isinstance(tpd, (int, float)) or float(tpd) <= 0:
                    action = "no_action"
                    reason = "Need a positive TPD amount to place an order (for example: order 20 TPD)."
                    action_args = {}
                else:
                    active_kpi = str(req.context.get("activeKpi", ""))
                    selected_lane = req.context.get("selectedLane")
                    if active_kpi != "totalLandedCost" or not isinstance(selected_lane, dict) or not selected_lane.get("id"):
                        action = "no_action"
                        reason = "Order TPD actions require Total Landed Cost KPI with a selected lane."
                        action_args = {}
                    else:
                        action_args = {"tpd": float(tpd)}

        if action == "ask_genie":
            client = get_databricks_client()
            space_id = resolve_genie_space_id(None)
            genie_message = await asyncio.to_thread(
                _send_genie_message_sync,
                client,
                space_id=space_id,
                content=req.message,
                conversation_id=req.genie_conversation_id,
            )
            genie_resp = await asyncio.to_thread(
                _build_genie_chat_response_sync,
                client,
                space_id=space_id,
                genie_message=genie_message,
                include_rows=False,
            )
            text = _render_genie_response_text(genie_resp)
            reason = reason or "Routed to Genie for metric-view question"
            genie_conversation_id = genie_resp.conversationId or genie_conversation_id
            action_args = {}
            suggested_followups = genie_resp.suggestedQuestions[:4]

        if action == "no_action":
            text_messages = _build_text_response_messages(
                req.message, req.context, req.history,
            )
            text = await asyncio.to_thread(_text_response_sync, text_messages)

        logger.info(
            "agent turn | available=%s chosen=%s fallback=%s",
            req.available_actions, action, action == "no_action",
        )

        return AgentOrchestrateResponse(
            action=action,
            reason=reason,
            text=text,
            action_args=action_args,
            suggested_followups=suggested_followups,
            genie_conversation_id=genie_conversation_id,
            source="databricks",
        )

    except Exception as e:
        logger.error("Agent orchestration error: %s", e)
        return AgentOrchestrateResponse(
            action="no_action",
            reason="error",
            text=f"I'm having trouble processing your request right now. Please try again. ({type(e).__name__})",
            action_args={},
            suggested_followups=[],
            genie_conversation_id=genie_conversation_id,
            source="fallback",
        )


# Mount the API app at /api prefix
app.mount("/api", api_app)

# Mount static files for the React frontend
dist_path = Path(__file__).parent.parent / "dist"
if dist_path.exists():
    print(f"Serving static files from: {dist_path}")

    app.mount("/assets", StaticFiles(directory=str(dist_path / "assets")), name="assets")

    mock_path = dist_path / "mock"
    if mock_path.exists():
        app.mount("/mock", StaticFiles(directory=str(mock_path)), name="mock")

    @app.get("/vite.svg")
    @app.get("/tab_logo.png")
    async def serve_static_file(request: Request):
        filename = request.url.path.lstrip("/")
        file_path = dist_path / filename
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="File not found")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if "." in full_path.split("/")[-1]:
            file_path = dist_path / full_path
            if file_path.exists():
                return FileResponse(file_path)
        return FileResponse(dist_path / "index.html")
else:
    print(f"No dist directory found at {dist_path}")
    print("Run 'npm run build' to create production build")

    @app.get("/")
    async def dev_root():
        return {
            "message": "Development mode - frontend should be running on http://localhost:5173",
            "api_health": "http://localhost:8001/api/health",
            "api_docs": "http://localhost:8001/docs",
        }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port)
