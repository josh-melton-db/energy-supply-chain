from __future__ import annotations

import hashlib
from datetime import datetime

import numpy as np
import pandas as pd
from pyspark.sql import functions as F
from pyspark.sql import types as T


def _telemetry_interval_minutes(cfg) -> int:
    start = datetime.fromisoformat(cfg.telemetry_start_ts)
    end = datetime.fromisoformat(cfg.telemetry_end_ts)
    total_minutes = int((end - start).total_seconds() // 60) + 1
    per_asset_target = max(1, cfg.telemetry_target_rows // cfg.num_assets)
    interval = max(1, total_minutes // per_asset_target)
    return interval


def _iot_schema() -> T.StructType:
    return T.StructType(
        [
            T.StructField("timestamp", T.TimestampType(), False),
            T.StructField("asset_id", T.StringType(), False),
            T.StructField("power_consumed_kwh", T.DoubleType(), False),
            T.StructField("gas_produced_tons", T.DoubleType(), False),
            T.StructField("grid_price_mwh", T.DoubleType(), False),
            T.StructField("carbon_intensity_kg_co2e_per_ton", T.DoubleType(), False),
            T.StructField("vibration_alert", T.BooleanType(), False),
            T.StructField("disruption_stage", T.IntegerType(), False),
            T.StructField("disruption_active", T.BooleanType(), False),
        ]
    )


def _consumption_schema() -> T.StructType:
    return T.StructType(
        [
            T.StructField("timestamp", T.TimestampType(), False),
            T.StructField("contract_id", T.StringType(), False),
            T.StructField("actual_tons_consumed", T.DoubleType(), False),
            T.StructField("tank_level_pct", T.DoubleType(), False),
            T.StructField("delivery_delay_minutes", T.DoubleType(), False),
            T.StructField("on_time_flag", T.BooleanType(), False),
            T.StructField("sla_risk_pct", T.DoubleType(), False),
            T.StructField("estimated_tank_capacity_tons", T.DoubleType(), False),
            T.StructField("propagation_stage", T.IntegerType(), False),
            T.StructField("upstream_disruption", T.BooleanType(), False),
            T.StructField("story_chain_id", T.StringType(), False),
        ]
    )


def generate_fact_iot_telemetry_df(spark, cfg, dim_assets_df):
    interval_minutes = _telemetry_interval_minutes(cfg)
    timestamps_df = spark.sql(
        f"""
        SELECT explode(
          sequence(
            to_timestamp('{cfg.telemetry_start_ts}'),
            to_timestamp('{cfg.telemetry_end_ts}'),
            interval {interval_minutes} minutes
          )
        ) AS timestamp
        """
    )
    base = dim_assets_df.select("asset_id", "max_capacity_tpd", "base_specific_energy_kwh").crossJoin(timestamps_df)

    def add_iot_features(pdf: pd.DataFrame) -> pd.DataFrame:
        pdf = pdf.sort_values("timestamp").reset_index(drop=True)
        asset_id = str(pdf["asset_id"].iloc[0])
        digest = hashlib.sha256(asset_id.encode("utf-8")).hexdigest()
        rng = np.random.default_rng((int(digest[:8], 16) + 101) % (2**31 - 1))
        n = len(pdf)
        t = np.arange(n)

        daily_cycle = np.sin(2 * np.pi * (t % max(1, 24 * 60 // interval_minutes)) / max(1, 24 * 60 // interval_minutes))
        base_capacity = float(pdf["max_capacity_tpd"].iloc[0])
        base_energy = float(pdf["base_specific_energy_kwh"].iloc[0])
        stage = int(int(digest[-2:], 16) % 3) + 1
        event_window = max(20, n // 12)
        event_start = int((int(digest[:6], 16) % max(1, (n - event_window))))
        event_end = min(n, event_start + event_window)
        disruption_active = np.zeros(n, dtype=bool)
        disruption_active[event_start:event_end] = True

        # gas_produced_tons = instantaneous rate in tpd; cap at 95% of capacity
        gas_tons = np.clip(
            base_capacity * (0.45 + 0.18 * daily_cycle + rng.normal(0.0, 0.04, n)),
            max(15.0, base_capacity * 0.15),
            base_capacity * 0.95,
        )
        specific_energy = np.clip(base_energy * (0.95 + rng.normal(0.0, 0.03, n)), 180.0, 340.0)
        power_kwh = np.clip(gas_tons * specific_energy + rng.normal(0.0, 200.0, n), 5000.0, 20000.0)
        grid = np.clip(120.0 + 65.0 * daily_cycle + rng.normal(0.0, 18.0, n), 20.0, 400.0)
        carbon = np.clip(95.0 + 12.0 * rng.normal(0.0, 1.0, n), 50.0, 200.0)
        gas_tons = np.where(disruption_active, gas_tons * (0.62 if stage == 1 else 0.76), gas_tons)
        power_kwh = np.where(disruption_active, power_kwh * (1.16 if stage == 1 else 1.08), power_kwh)
        grid = np.where(disruption_active, np.clip(grid * 1.12, 20.0, 400.0), grid)
        vib = np.where(disruption_active, rng.random(n) < 0.24, rng.random(n) < 0.01)
        stage_arr = np.where(disruption_active, stage, 0)

        out = pd.DataFrame(
            {
                "timestamp": pdf["timestamp"].values,
                "asset_id": pdf["asset_id"].values,
                "power_consumed_kwh": power_kwh.astype(float),
                "gas_produced_tons": gas_tons.astype(float),
                "grid_price_mwh": grid.astype(float),
                "carbon_intensity_kg_co2e_per_ton": carbon.astype(float),
                "vibration_alert": vib.astype(bool),
                "disruption_stage": stage_arr.astype(int),
                "disruption_active": disruption_active.astype(bool),
            }
        )
        return out

    return base.groupBy("asset_id").applyInPandas(add_iot_features, schema=_iot_schema())


def generate_fact_consumption_df(spark, cfg, dim_contracts_df):
    timestamps_df = spark.sql(
        f"""
        SELECT explode(
          sequence(
            to_timestamp('{cfg.consumption_start_ts}'),
            to_timestamp('{cfg.consumption_end_ts}'),
            interval {cfg.consumption_frequency}
          )
        ) AS timestamp
        """
    )
    base = (
        dim_contracts_df.select(
            "contract_id",
            "take_or_pay_min_tpd",
            "mode",
            "product",
            "asset_id",
            "contract_type",
            "overage_price_multiplier",
            "energy_pass_through_pct",
            "story_chain_id",
            "lane_priority",
        )
        .crossJoin(timestamps_df)
    )

    def add_consumption_features(pdf: pd.DataFrame) -> pd.DataFrame:
        pdf = pdf.sort_values("timestamp").reset_index(drop=True)
        contract_id = str(pdf["contract_id"].iloc[0])
        digest = hashlib.sha256(contract_id.encode("utf-8")).hexdigest()
        rng = np.random.default_rng((int(digest[:8], 16) + 211) % (2**31 - 1))
        n = len(pdf)
        t = np.arange(n)

        top = float(pdf["take_or_pay_min_tpd"].iloc[0])
        mode = str(pdf["mode"].iloc[0])
        contract_type = str(pdf["contract_type"].iloc[0])
        overage_price_multiplier = float(pdf["overage_price_multiplier"].iloc[0])
        energy_pass_through_pct = float(pdf["energy_pass_through_pct"].iloc[0])
        story_chain_id = str(pdf["story_chain_id"].iloc[0])
        lane_priority = str(pdf["lane_priority"].iloc[0])
        asset_id = str(pdf["asset_id"].iloc[0])
        priority_disruption_intensity = {"critical": 1.0, "watch": 0.72, "stable": 0.42}.get(lane_priority, 0.58)
        priority_flow_factor = {"critical": 1.28, "watch": 1.1, "stable": 0.85}.get(lane_priority, 1.0)
        dtz_capacity_factor = {"critical": 0.58, "watch": 0.9, "stable": 1.35}.get(lane_priority, 1.0)
        dtz_level_bias = {"critical": -20.0, "watch": -6.0, "stable": 10.0}.get(lane_priority, 0.0)
        if contract_type == "anchor_pipeline":
            demand_center = 1.03 + rng.normal(0.0, 0.025)
            volatility = 0.045
            min_hourly_floor = max(0.55, top / 24.0 * 0.88)
            max_hourly_cap = max(9.0, top / 24.0 * 1.35)
        else:
            demand_center = 0.86 + rng.normal(0.0, 0.08)
            volatility = 0.11
            min_hourly_floor = max(0.4, top / 24.0 * 0.45)
            max_hourly_cap = max(10.5, top / 24.0 * 1.85)
        base_daily = max(1.0, top * np.clip(demand_center, 0.55, 1.35))
        hourly = np.clip(
            base_daily / 24.0
            + 0.12 * np.sin(2 * np.pi * (t % 24) / 24.0)
            + rng.normal(0.0, volatility, n),
            min_hourly_floor,
            max_hourly_cap,
        )

        tank_capacity = np.clip(top * (9.5 + rng.normal(0, 0.6)) * dtz_capacity_factor, 120.0, 1500.0)
        rolling = pd.Series(hourly).rolling(window=24, min_periods=1).sum().to_numpy()
        nominal_level = np.clip(80.0 - (rolling / np.maximum(1e-6, tank_capacity)) * 100.0, 10.0, 95.0)
        tank_level = np.clip(nominal_level + dtz_level_bias + rng.normal(0.0, 2.5, n), 6.0, 97.0)

        mode_delay_base = 85.0 if mode == "truck" else 40.0
        delay = np.clip(mode_delay_base + 20.0 * np.sin(2 * np.pi * (t % 24) / 24.0) + rng.normal(0.0, 12.0, n), 5.0, 180.0)
        on_time_prob = np.clip(1.0 - (delay / 240.0), 0.55, 0.97)
        on_time = rng.random(n) < on_time_prob
        sla_risk = np.clip(0.35 - on_time_prob + rng.normal(0.0, 0.015, n), 0.01, 0.35)
        asset_digest = hashlib.sha256(asset_id.encode("utf-8")).hexdigest()
        stage = int(int(asset_digest[-2:], 16) % 3) + 1
        event_window = max(8, int((n // 14) * (0.85 + priority_disruption_intensity)))
        event_start = int((int(asset_digest[:6], 16) % max(1, (n - event_window))))
        event_end = min(n, event_start + event_window)
        upstream_disruption = np.zeros(n, dtype=bool)
        active_window = max(4, int((event_end - event_start) * priority_disruption_intensity))
        upstream_disruption[event_start:min(n, event_start + active_window)] = True
        # Natural flow model: source hub -> pipeline trunk -> truck terminal -> customer site.
        # Use networkx when available; fall back to deterministic path pressure when remote worker
        # does not have networkx installed.
        try:
            import networkx as _nx

            flow = _nx.DiGraph()
            flow.add_edge("source_hub", "pipeline_trunk", weight=1.15 if stage == 1 else 1.05)
            flow.add_edge("pipeline_trunk", "truck_terminal", weight=1.22 if mode == "truck" else 1.08)
            flow.add_edge(
                "truck_terminal",
                "customer_site",
                weight=(1.18 if lane_priority == "critical" else (1.12 if lane_priority == "watch" else 1.03)),
            )
            path_pressure = float(_nx.shortest_path_length(flow, "source_hub", "customer_site", weight="weight"))
        except Exception:
            path_pressure = (1.15 if stage == 1 else 1.05) + (1.22 if mode == "truck" else 1.08) + (
                1.18 if lane_priority == "critical" else (1.12 if lane_priority == "watch" else 1.03)
            )
        path_pressure *= priority_flow_factor

        propagation_stage = np.where(upstream_disruption, min(3, stage + (1 if mode == "truck" else 0)), 0)
        delay_bump = 12.0 * path_pressure
        sla_bump = 0.028 * path_pressure
        # Merchant lanes react more to disruptions and overage opportunities.
        merchant_sensitivity = 1.22 if contract_type == "merchant_bulk" else 0.92
        demand_bump = 1.0 + (0.055 * path_pressure * merchant_sensitivity)
        tank_drawdown = 1.9 * path_pressure

        delay = np.where(upstream_disruption, np.clip(delay + delay_bump, 5.0, 180.0), delay)
        sla_risk = np.where(upstream_disruption, np.clip(sla_risk + sla_bump, 0.01, 0.35), sla_risk)
        hourly = np.where(upstream_disruption, np.clip(hourly * demand_bump, 0.5, max_hourly_cap), hourly)
        tank_level = np.where(upstream_disruption, np.clip(tank_level - tank_drawdown, 10.0, 95.0), tank_level)
        on_time_prob = np.where(upstream_disruption, np.clip(on_time_prob - 0.12, 0.30, 0.97), on_time_prob)
        # Encourage anchor stability around minimum and merchant spike behavior.
        if contract_type == "anchor_pipeline":
            hourly = np.maximum(hourly, top / 24.0 * 0.82)
        else:
            overage_uplift = 1.0 + (overage_price_multiplier - 1.0) * 0.28 + energy_pass_through_pct * 0.08
            hourly = np.where(
                (t % 24 >= 8) & (t % 24 <= 18),
                np.clip(hourly * overage_uplift, 0.4, max_hourly_cap * 1.08),
                hourly,
            )
        on_time = rng.random(n) < on_time_prob

        return pd.DataFrame(
            {
                "timestamp": pdf["timestamp"].values,
                "contract_id": pdf["contract_id"].values,
                "actual_tons_consumed": hourly.astype(float),
                "tank_level_pct": tank_level.astype(float),
                "delivery_delay_minutes": delay.astype(float),
                "on_time_flag": on_time.astype(bool),
                "sla_risk_pct": sla_risk.astype(float),
                "estimated_tank_capacity_tons": np.full(n, float(tank_capacity)),
                "propagation_stage": propagation_stage.astype(int),
                "upstream_disruption": upstream_disruption.astype(bool),
                "story_chain_id": np.full(n, story_chain_id),
            }
        )

    return base.groupBy("contract_id").applyInPandas(add_consumption_features, schema=_consumption_schema())


def generate_fact_financials_df(spark, cfg, fact_iot_df, dim_assets_df, dim_contracts_df):
    # gas_produced_tons is instantaneous rate (tpd); AVG = daily production
    iot_daily = fact_iot_df.groupBy(
        "asset_id", F.date_trunc("DAY", F.col("timestamp")).alias("date")
    ).agg(
        F.avg("gas_produced_tons").alias("gas_produced_tons"),
        F.avg("grid_price_mwh").alias("avg_grid_price_mwh"),
    )
    contract_mix = (
        dim_contracts_df.groupBy("asset_id")
        .agg(
            F.avg(F.when(F.col("contract_type") == F.lit("anchor_pipeline"), F.lit(1.0)).otherwise(F.lit(0.0))).alias("anchor_share"),
            F.avg("energy_pass_through_pct").alias("avg_energy_pass_through_pct"),
            F.avg("overage_price_multiplier").alias("avg_overage_multiplier"),
        )
    )
    asset_attrs = dim_assets_df.select(
        "asset_id",
        "asset_commission_year",
        "depreciation_years",
        "capex_usd",
        "overbuild_ratio",
        "max_capacity_tpd",
    )
    with_attrs = (
        iot_daily
        .join(asset_attrs, on="asset_id", how="left")
        .join(contract_mix, on="asset_id", how="left")
        .fillna({"anchor_share": 0.5, "avg_energy_pass_through_pct": 0.6, "avg_overage_multiplier": 1.08})
        .withColumn("asset_age_years", F.greatest(F.lit(0.0), F.lit(2026.0) - F.col("asset_commission_year").cast("double")))
        .withColumn("is_fully_depreciated", F.col("asset_age_years") >= F.col("depreciation_years").cast("double"))
        .withColumn(
            "daily_depreciation_usd",
            F.when(
                F.col("is_fully_depreciated"),
                F.col("capex_usd") * F.lit(0.000008),
            ).otherwise(
                F.col("capex_usd") / F.greatest(F.col("depreciation_years").cast("double") * F.lit(365.0), F.lit(1.0)) * F.lit(0.38)
            ),
        )
        .withColumn(
            "merchant_share",
            F.greatest(F.lit(0.0), F.lit(1.0) - F.col("anchor_share")),
        )
    )
    return (
        with_attrs
        .withColumn("effective_daily_gas_tons", F.col("gas_produced_tons"))
        .withColumn(
            "daily_energy_cost_usd",
            F.round(
                F.col("avg_grid_price_mwh") * (F.lit(72.0) + F.col("merchant_share") * F.lit(42.0))
                + F.rand(cfg.seed + 5) * 2400.0,
                2,
            ),
        )
        .withColumn(
            "daily_ops_cost_usd",
            F.round(
                (F.col("max_capacity_tpd") * F.lit(0.95))
                + (F.col("effective_daily_gas_tons") * F.greatest(F.lit(7.8), F.lit(11.8) - F.col("asset_age_years") * F.lit(0.08)))
                + F.col("daily_depreciation_usd")
                + F.rand(cfg.seed + 6) * 2400.0,
                2,
            ),
        )
        .withColumn(
            "core_price_per_ton_usd",
            F.greatest(
                F.lit(78.0),
                F.lit(102.0)
                + (F.col("merchant_share") * F.lit(58.0))
                + F.when(F.col("is_fully_depreciated"), F.lit(12.0)).otherwise(F.lit(-8.0))
                + (F.col("overbuild_ratio") - F.lit(1.0)) * F.lit(18.0)
                + F.rand(cfg.seed + 7) * 14.0,
            ),
        )
        .withColumn("core_revenue_usd", F.col("effective_daily_gas_tons") * F.col("core_price_per_ton_usd"))
        # Pass-through increases top line and compresses margin %, especially for anchor lanes.
        .withColumn(
            "pass_through_revenue_usd",
            F.col("daily_energy_cost_usd") * (F.col("avg_energy_pass_through_pct") + F.lit(0.005)),
        )
        .withColumn(
            "daily_revenue_usd",
            F.round(F.col("core_revenue_usd") + F.col("pass_through_revenue_usd"), 2),
        )
        .select(
            "date",
            "asset_id",
            F.col("effective_daily_gas_tons").alias("gas_produced_tons"),
            "daily_energy_cost_usd",
            "daily_ops_cost_usd",
            "daily_revenue_usd",
        )
    )


def generate_forecast_dfs(spark, cfg, fact_consumption_df, fact_iot_df, dim_contracts_df):
    # Build contract weights once and use the same split logic for demand and supply so
    # lane-level discrepancies stay bounded and realistic.
    contract_weights = (
        dim_contracts_df
        .select(
            "contract_id",
            "asset_id",
            F.when(F.col("lane_priority") == F.lit("critical"), F.lit(1.2))
            .when(F.col("lane_priority") == F.lit("watch"), F.lit(1.05))
            .otherwise(F.lit(1.0))
            .alias("lane_weight"),
        )
    )
    asset_weight_totals = contract_weights.groupBy("asset_id").agg(F.sum("lane_weight").alias("total_lane_weight"))

    # Asset-day demand baseline from consumption history.
    asset_daily_demand = (
        fact_consumption_df
        .join(contract_weights.select("contract_id", "asset_id"), on="contract_id", how="inner")
        .groupBy("asset_id", F.to_date("timestamp").alias("forecast_date"))
        .agg(F.sum("actual_tons_consumed").alias("asset_daily_demand_tons"))
    )

    demand_daily = (
        asset_daily_demand
        .join(contract_weights, on="asset_id", how="inner")
        .join(asset_weight_totals, on="asset_id", how="inner")
        .withColumn(
            "demand_surge",
            F.when(
                ((F.abs(F.hash("contract_id")) % F.lit(11)) == 0)
                & (F.dayofmonth("forecast_date").between(13, 22)),
                F.lit(1.015),
            )
            .when(
                ((F.abs(F.hash("contract_id")) % F.lit(13)) == 0)
                & (F.dayofmonth("forecast_date").between(7, 10)),
                F.lit(1.008),
            )
            .otherwise(F.lit(1.0)),
        )
        .withColumn("forecast_horizon_days", (F.abs(F.hash("contract_id", "forecast_date")) % F.lit(30)) + F.lit(1))
        .withColumn(
            "forecasted_tons_per_day",
            F.round(
                (F.col("asset_daily_demand_tons") * F.col("lane_weight") / F.col("total_lane_weight"))
                * (F.lit(0.997) + F.rand(cfg.seed + 31) * F.lit(0.006))
                * F.col("demand_surge"),
                3,
            ),
        )
        .select("forecast_date", "contract_id", "forecasted_tons_per_day", "forecast_horizon_days")
    )

    # Use telemetry as a weak signal but anchor supply tightly to asset-day demand
    # so downstream lane discrepancy remains in a controlled band.
    telemetry_supply = (
        fact_iot_df
        .groupBy("asset_id", F.to_date("timestamp").alias("forecast_date"))
        .agg(F.avg("gas_produced_tons").alias("telemetry_supply_tpd"))
    )

    supply = (
        asset_daily_demand
        .join(telemetry_supply, on=["asset_id", "forecast_date"], how="left")
        .withColumn(
            "asset_supply_factor",
            F.when(
                ((F.abs(F.hash("asset_id")) % F.lit(9)) == 0)
                & (F.dayofmonth("forecast_date").between(12, 20)),
                F.lit(0.97),
            )
            .when(
                ((F.abs(F.hash("asset_id")) % F.lit(11)) == 0)
                & (F.dayofmonth("forecast_date").between(5, 8)),
                F.lit(1.02),
            )
            .otherwise(F.lit(1.0)),
        )
        .withColumn(
            "target_supply_tpd",
            F.col("asset_daily_demand_tons")
            * (F.lit(0.995) + F.rand(cfg.seed + 32) * F.lit(0.010))
            * F.col("asset_supply_factor"),
        )
        .withColumn(
            "blended_supply_tpd",
            F.coalesce(F.col("telemetry_supply_tpd"), F.col("target_supply_tpd")) * F.lit(0.15)
            + F.col("target_supply_tpd") * F.lit(0.85),
        )
        .withColumn(
            "forecasted_tons_per_day",
            F.round(
                F.least(
                    F.col("asset_daily_demand_tons") * F.lit(1.18),
                    F.greatest(F.col("asset_daily_demand_tons") * F.lit(0.82), F.col("blended_supply_tpd")),
                ),
                3,
            ),
        )
        .withColumn("forecast_horizon_days", (F.abs(F.hash("asset_id", "forecast_date")) % F.lit(30)) + F.lit(1))
        .select("forecast_date", "asset_id", "forecasted_tons_per_day", "forecast_horizon_days")
    )

    return demand_daily, supply


WORK_ORDER_SUMMARIES = [
    ("Transfer pump bearing replacement due to elevated vibration", "Worn main bearing", "Replaced bearing assembly and realigned coupling"),
    ("Instrument calibration drift on pipeline pressure transmitter", "Sensor fouling from hydrocarbon service", "Cleaned and recalibrated transmitter"),
    ("VFD fault on main transfer pump motor", "Capacitor bank failure", "Replaced VFD capacitor module and tested ramp profiles"),
    ("Pipeline block valve sticking during nomination change", "Wax buildup on valve seat", "Cleaned valve, replaced gasket, verified actuator travel"),
    ("Emergency shutdown from high vibration alarm", "Impeller imbalance after debris ingestion", "Cleaned impeller, balanced rotor, replaced inlet screen"),
    ("Routine thermocouple replacement per PM schedule", "End-of-life per calibration schedule", "Installed new thermocouple assembly"),
    ("Electrical contactor welding on terminal starter panel", "Arc flash from loose terminal", "Replaced contactor and torqued all terminals"),
    ("Pipeline pressure relief valve popping prematurely", "Spring fatigue from thermal cycling", "Replaced relief valve spring and reset pop pressure"),
    ("Cooling water pump seal leak", "Mechanical seal wear", "Replaced pump seal kit and flushed cooling lines"),
    ("Control system PLC communication fault", "Ethernet switch port failure", "Replaced switch module and updated network config"),
]


def generate_fact_work_orders_rows(cfg, asset_rows: list, technician_rows: list) -> list:
    """Generate 3-8 work orders per asset over Q1 2026, linked to technicians."""
    import random as _random
    from datetime import date, timedelta

    rng = _random.Random(cfg.seed + 91)
    start = date.fromisoformat(cfg.financial_start_date)
    end = date.fromisoformat(cfg.financial_end_date)
    day_range = (end - start).days

    techs_by_asset: dict[str, list] = {}
    for t in technician_rows:
        techs_by_asset.setdefault(t["asset_id"], []).append(t)

    rows: list[dict] = []
    wo_idx = 1
    lo, hi = cfg.work_orders_per_asset_range
    for asset in asset_rows:
        num_wos = rng.randint(lo, hi)
        asset_techs = techs_by_asset.get(asset["asset_id"], [])
        for _ in range(num_wos):
            summary, root_cause, resolution = rng.choice(WORK_ORDER_SUMMARIES)
            open_offset = rng.randint(0, max(0, day_range - 14))
            date_opened = start + timedelta(days=open_offset)
            resolution_days = rng.randint(1, 7)
            date_closed = min(date_opened + timedelta(days=resolution_days), end)
            severity = rng.choice(["low", "low", "medium", "medium", "high"])
            tech = rng.choice(asset_techs) if asset_techs else None
            parts_used = rng.randint(0, 3)
            rows.append({
                "work_order_id": f"WO-{wo_idx:05d}",
                "asset_id": asset["asset_id"],
                "technician_id": tech["tech_id"] if tech else None,
                "date_opened": str(date_opened),
                "date_closed": str(date_closed),
                "summary": summary,
                "root_cause": root_cause,
                "resolution": resolution,
                "parts_used": parts_used,
                "resolution_days": resolution_days,
                "severity": severity,
            })
            wo_idx += 1
    return rows

