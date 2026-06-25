from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GeneratorConfig:
    catalog_schema: str = "demos.industrials_optimization"
    profile: str = "DEFAULT"
    seed: int = 42

    num_assets: int = 14
    num_customers: int = 28
    num_contracts: int = 70

    telemetry_start_ts: str = "2026-01-01 00:00:00"
    telemetry_end_ts: str = "2026-03-31 23:59:59"
    telemetry_target_rows: int = 1_000_000

    consumption_start_ts: str = "2026-01-01 00:00:00"
    consumption_end_ts: str = "2026-03-31 23:59:59"
    consumption_frequency: str = "1 hour"

    financial_start_date: str = "2026-01-01"
    financial_end_date: str = "2026-03-31"

    forecast_start_date: str = "2026-01-01"
    forecast_end_date: str = "2026-03-31"

    num_vendors: int = 8
    num_technicians_per_asset: int = 3
    work_orders_per_asset_range: tuple[int, int] = (3, 8)

