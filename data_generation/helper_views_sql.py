from __future__ import annotations


def helper_view_statements(schema: str) -> list[str]:
    return [
        f"""
CREATE OR REPLACE VIEW {schema}.fact_iot_asset_daily AS
SELECT
  iot.asset_id,
  a.region,
  DATE_TRUNC('DAY', iot.timestamp) AS date,
  MAX(a.min_run_rate_tpd) AS min_run_rate_tpd,
  SUM(iot.power_consumed_kwh) AS power_kwh,
  AVG(iot.gas_produced_tons) AS gas_tons,
  MIN(iot.grid_price_mwh) AS min_grid_price_mwh,
  MAX(iot.grid_price_mwh) AS max_grid_price_mwh,
  AVG(iot.grid_price_mwh) AS avg_grid_price_mwh,
  AVG(iot.gas_produced_tons) * AVG(iot.carbon_intensity_kg_co2e_per_ton) AS weighted_carbon_kg,
  SUM(CASE WHEN iot.vibration_alert THEN 1 ELSE 0 END) AS vibration_alert_count,
  SUM(CASE WHEN iot.disruption_active THEN 1 ELSE 0 END) AS disruption_points,
  MAX(iot.disruption_stage) AS disruption_stage_max
FROM {schema}.fact_iot_telemetry iot
JOIN {schema}.dim_assets a ON iot.asset_id = a.asset_id
GROUP BY iot.asset_id, a.region, DATE_TRUNC('DAY', iot.timestamp)
""".strip(),
        f"""
CREATE OR REPLACE VIEW {schema}.fact_consumption_daily AS
SELECT
  contract_id,
  DATE_TRUNC('DAY', timestamp) AS date,
  MAX(story_chain_id) AS story_chain_id,
  MAX(tank_level_pct) AS tank_level_pct,
  MAX(estimated_tank_capacity_tons) AS estimated_tank_capacity_tons,
  SUM(actual_tons_consumed) AS daily_usage_tons,
  AVG(delivery_delay_minutes) AS avg_delay_minutes,
  AVG(CASE WHEN on_time_flag THEN 1.0 ELSE 0.0 END) AS on_time_pct,
  AVG(sla_risk_pct) AS avg_sla_risk_pct,
  AVG(CASE WHEN upstream_disruption THEN 1.0 ELSE 0.0 END) AS upstream_disruption_pct,
  MAX(propagation_stage) AS propagation_stage_max
FROM {schema}.fact_consumption
GROUP BY contract_id, DATE_TRUNC('DAY', timestamp)
""".strip(),
        f"""
CREATE OR REPLACE VIEW {schema}.fact_asset_cost_per_ton AS
SELECT
  asset_id,
  SUM(daily_energy_cost_usd + daily_ops_cost_usd) / NULLIF(SUM(gas_produced_tons), 0) AS production_cost_per_ton
FROM {schema}.fact_financials
GROUP BY asset_id
""".strip(),
        f"""
CREATE OR REPLACE VIEW {schema}.fact_consumption_daily_enriched AS
SELECT
  cd.contract_id,
  cd.date,
  cd.story_chain_id,
  cd.tank_level_pct,
  cd.estimated_tank_capacity_tons,
  cd.daily_usage_tons,
  cd.avg_delay_minutes,
  cd.on_time_pct,
  cd.avg_sla_risk_pct,
  cd.upstream_disruption_pct,
  cd.propagation_stage_max,
  c.asset_id,
  c.customer_id,
  c.product,
  c.mode,
  c.lane_id,
  cust.customer_name,
  cust.contact_email,
  cust.tier,
  cust.industry,
  a.asset_name,
  a.lat AS origin_lat,
  a.lng AS origin_lng,
  a.max_capacity_tpd,
  cust.lat AS dest_lat,
  cust.lng AS dest_lng,
  COALESCE(ac.production_cost_per_ton, 0.0) AS production_cost_per_ton,
  CASE
    WHEN LOWER(c.mode) = 'truck' AND a.lat IS NOT NULL AND cust.lat IS NOT NULL THEN
      6371.0 * 2 * ATAN2(
        SQRT(SIN(RADIANS(cust.lat - a.lat) / 2) * SIN(RADIANS(cust.lat - a.lat) / 2)
          + COS(RADIANS(a.lat)) * COS(RADIANS(cust.lat))
          * SIN(RADIANS(cust.lng - a.lng) / 2) * SIN(RADIANS(cust.lng - a.lng) / 2)),
        SQRT(1 - (SIN(RADIANS(cust.lat - a.lat) / 2) * SIN(RADIANS(cust.lat - a.lat) / 2)
          + COS(RADIANS(a.lat)) * COS(RADIANS(cust.lat))
          * SIN(RADIANS(cust.lng - a.lng) / 2) * SIN(RADIANS(cust.lng - a.lng) / 2)))
      ) * 0.12
    ELSE 0.0
  END AS distribution_cost_per_ton,
  COALESCE(ac.production_cost_per_ton, 0.0) + CASE
    WHEN LOWER(c.mode) = 'truck' AND a.lat IS NOT NULL AND cust.lat IS NOT NULL THEN
      6371.0 * 2 * ATAN2(
        SQRT(SIN(RADIANS(cust.lat - a.lat) / 2) * SIN(RADIANS(cust.lat - a.lat) / 2)
          + COS(RADIANS(a.lat)) * COS(RADIANS(cust.lat))
          * SIN(RADIANS(cust.lng - a.lng) / 2) * SIN(RADIANS(cust.lng - a.lng) / 2)),
        SQRT(1 - (SIN(RADIANS(cust.lat - a.lat) / 2) * SIN(RADIANS(cust.lat - a.lat) / 2)
          + COS(RADIANS(a.lat)) * COS(RADIANS(cust.lat))
          * SIN(RADIANS(cust.lng - a.lng) / 2) * SIN(RADIANS(cust.lng - a.lng) / 2)))
      ) * 0.12
    ELSE 0.0
  END AS total_landed_cost_per_ton
FROM {schema}.fact_consumption_daily cd
JOIN {schema}.dim_contracts c ON cd.contract_id = c.contract_id
JOIN {schema}.dim_customers cust ON c.customer_id = cust.customer_id
JOIN {schema}.dim_assets a ON c.asset_id = a.asset_id
LEFT JOIN {schema}.fact_asset_cost_per_ton ac ON c.asset_id = ac.asset_id
""".strip(),
        f"""
CREATE OR REPLACE VIEW {schema}.fact_incident_daily_enriched AS
SELECT
  cd.contract_id,
  cd.date,
  c.lane_id,
  c.asset_id,
  c.customer_id,
  c.product,
  c.mode,
  cust.customer_name,
  a.region,
  cd.tank_level_pct,
  cd.estimated_tank_capacity_tons,
  cd.daily_usage_tons,
  cd.avg_sla_risk_pct,
  cd.propagation_stage_max,
  COALESCE(iot.vibration_alert_count, 0) AS vibration_alert_count,
  COALESCE(iot.disruption_points, 0) AS disruption_points,
  COALESCE(iot.disruption_stage_max, 0) AS iot_disruption_stage_max
FROM {schema}.fact_consumption_daily cd
JOIN {schema}.dim_contracts c ON cd.contract_id = c.contract_id
JOIN {schema}.dim_customers cust ON c.customer_id = cust.customer_id
JOIN {schema}.dim_assets a ON c.asset_id = a.asset_id
LEFT JOIN {schema}.fact_iot_asset_daily iot
  ON c.asset_id = iot.asset_id
 AND cd.date = iot.date
""".strip(),
        f"""
CREATE OR REPLACE VIEW {schema}.fact_consumption_contract_monthly AS
SELECT
  fc.contract_id,
  MAX(c.lane_id) AS lane_id,
  MAX(c.customer_id) AS customer_id,
  MAX(c.asset_id) AS asset_id,
  MAX(c.contract_type) AS contract_type,
  DATE_TRUNC('MONTH', fc.timestamp) AS month,
  MAX(c.take_or_pay_min_tpd) * 30 AS committed_volume_tons,
  SUM(fc.actual_tons_consumed) AS actual_volume_tons,
  MAX(c.price_per_ton_usd) AS price_per_ton_usd,
  MAX(c.energy_pass_through_pct) AS energy_pass_through_pct,
  MAX(c.overage_price_multiplier) AS overage_price_multiplier,
  MAX(c.ld_penalty_rate_usd) AS ld_penalty_rate_usd
FROM {schema}.fact_consumption fc
JOIN {schema}.dim_contracts c ON fc.contract_id = c.contract_id
GROUP BY fc.contract_id, DATE_TRUNC('MONTH', fc.timestamp)
""".strip(),
        f"""
CREATE OR REPLACE VIEW {schema}.fact_forecast_balance_daily AS
WITH demand AS (
  SELECT
    contract_id,
    forecast_date,
    SUM(forecasted_tons_per_day) AS forecasted_demand_tpd
  FROM {schema}.fact_demand_forecast
  GROUP BY contract_id, forecast_date
),
contract_weights AS (
  SELECT
    contract_id,
    asset_id,
    CASE WHEN lane_priority = 'critical' THEN 1.3 ELSE 1.0 END AS lane_weight
  FROM {schema}.dim_contracts
),
asset_weight_totals AS (
  SELECT
    asset_id,
    SUM(lane_weight) AS total_lane_weight
  FROM contract_weights
  GROUP BY asset_id
),
supply_by_contract AS (
  SELECT
    c.contract_id,
    s.forecast_date,
    SUM(
      s.forecasted_tons_per_day
      * c.lane_weight
      / NULLIF(t.total_lane_weight, 0)
    ) AS forecasted_supply_tpd
  FROM {schema}.fact_supply_forecast s
  JOIN contract_weights c
    ON s.asset_id = c.asset_id
  JOIN asset_weight_totals t
    ON c.asset_id = t.asset_id
  GROUP BY c.contract_id, s.forecast_date
)
SELECT
  COALESCE(demand.contract_id, supply_by_contract.contract_id) AS contract_id,
  COALESCE(demand.forecast_date, supply_by_contract.forecast_date) AS forecast_date,
  COALESCE(demand.forecasted_demand_tpd, 0.0) AS forecasted_demand_tpd,
  COALESCE(supply_by_contract.forecasted_supply_tpd, 0.0) AS forecasted_supply_tpd
FROM demand
FULL OUTER JOIN supply_by_contract
  ON demand.contract_id = supply_by_contract.contract_id
 AND demand.forecast_date = supply_by_contract.forecast_date
""".strip(),
        f"""
CREATE OR REPLACE VIEW {schema}.fact_financials_lane_monthly AS
WITH contract_revenue_volume AS (
  SELECT
    fccm.contract_id,
    fccm.lane_id,
    fccm.asset_id,
    fccm.contract_type,
    fccm.month,
    fccm.actual_volume_tons AS lane_volume_tons,
    fccm.committed_volume_tons,
    GREATEST(fccm.actual_volume_tons, fccm.committed_volume_tons) AS billable_base_tons,
    GREATEST(0.0, fccm.actual_volume_tons - fccm.committed_volume_tons) AS overage_tons,
    fccm.price_per_ton_usd,
    fccm.overage_price_multiplier,
    fccm.energy_pass_through_pct
  FROM {schema}.fact_consumption_contract_monthly fccm
),
asset_costs_monthly AS (
  SELECT
    asset_id,
    DATE_TRUNC('MONTH', date) AS month,
    SUM(daily_energy_cost_usd) AS asset_energy_cost_usd,
    SUM(daily_ops_cost_usd) AS asset_ops_cost_usd,
    SUM(gas_produced_tons) AS asset_volume_tons
  FROM {schema}.fact_financials
  GROUP BY asset_id, DATE_TRUNC('MONTH', date)
),
asset_contract_totals AS (
  SELECT
    asset_id,
    month,
    SUM(lane_volume_tons) AS asset_lane_volume_tons
  FROM contract_revenue_volume
  GROUP BY asset_id, month
),
contract_allocated AS (
  SELECT
    crv.contract_id,
    crv.lane_id,
    crv.month,
    crv.contract_type,
    crv.lane_volume_tons,
    (crv.billable_base_tons * crv.price_per_ton_usd)
      + (crv.overage_tons * crv.price_per_ton_usd * (crv.overage_price_multiplier - 1.0)) AS contracted_revenue_usd,
    crv.energy_pass_through_pct,
    crv.lane_volume_tons / NULLIF(act.asset_lane_volume_tons, 0) * ac.asset_energy_cost_usd AS lane_energy_cost_usd,
    crv.lane_volume_tons / NULLIF(act.asset_lane_volume_tons, 0) * ac.asset_ops_cost_usd AS lane_ops_cost_usd,
    -- Capacity reservation/availability cost to represent anchor utility obligations.
    crv.committed_volume_tons
      * CASE WHEN crv.contract_type = 'anchor_pipeline' THEN 16.5 ELSE 6.0 END AS standby_capacity_cost_usd
  FROM contract_revenue_volume crv
  JOIN asset_contract_totals act ON crv.asset_id = act.asset_id AND crv.month = act.month
  JOIN asset_costs_monthly ac ON crv.asset_id = ac.asset_id AND crv.month = ac.month
),
lane_aggregated AS (
  SELECT
    lane_id,
    month,
    SUM(lane_volume_tons) AS lane_volume_tons,
    SUM(contracted_revenue_usd) AS contracted_revenue_usd,
    SUM(lane_energy_cost_usd) AS lane_energy_cost_usd,
    SUM(lane_ops_cost_usd) AS lane_ops_cost_usd,
    SUM(standby_capacity_cost_usd) AS standby_capacity_cost_usd,
    SUM(CASE WHEN contract_type = 'anchor_pipeline' THEN 1 ELSE 0 END) AS anchor_contract_count,
    SUM(CASE WHEN contract_type = 'merchant_bulk' THEN 1 ELSE 0 END) AS merchant_contract_count,
    SUM(lane_energy_cost_usd * energy_pass_through_pct) AS pass_through_revenue_usd
  FROM contract_allocated
  GROUP BY lane_id, month
),
lane_margin_raw AS (
  SELECT
    lane_id,
    month,
    contracted_revenue_usd + pass_through_revenue_usd AS lane_revenue_usd,
    lane_volume_tons,
    lane_energy_cost_usd + lane_ops_cost_usd + standby_capacity_cost_usd AS lane_cost_usd_raw,
    (contracted_revenue_usd + pass_through_revenue_usd) - (lane_energy_cost_usd + lane_ops_cost_usd + standby_capacity_cost_usd) AS lane_margin_usd_raw,
    ((contracted_revenue_usd + pass_through_revenue_usd) - (lane_energy_cost_usd + lane_ops_cost_usd + standby_capacity_cost_usd))
      / NULLIF(contracted_revenue_usd + pass_through_revenue_usd, 0) * 100 AS lane_margin_pct_raw,
    anchor_contract_count,
    merchant_contract_count
  FROM lane_aggregated
)
SELECT
  lane_id,
  month,
  lane_revenue_usd,
  lane_volume_tons,
  lane_revenue_usd - (lane_revenue_usd * adjusted_margin_pct / 100.0) AS lane_cost_usd,
  lane_revenue_usd * adjusted_margin_pct / 100.0 AS lane_margin_usd,
  adjusted_margin_pct AS lane_margin_pct
FROM (
  SELECT
    lane_id,
    month,
    lane_revenue_usd,
    lane_volume_tons,
    CASE
      -- Pipeline/anchor lanes: centered higher, best around ~50%.
      WHEN anchor_contract_count >= merchant_contract_count THEN
        LEAST(50.0, GREATEST(10.0, lane_margin_pct_raw * 0.82 - 3.0))
      -- Merchant bulk lanes: lower on average, still bounded near 10-40.
      ELSE
        LEAST(34.0, GREATEST(10.0, lane_margin_pct_raw * 0.48 - 3.0))
    END AS adjusted_margin_pct
  FROM lane_margin_raw
) calibrated
""".strip(),
        f"""
CREATE OR REPLACE VIEW {schema}.fact_work_orders_enriched AS
SELECT
  wo.work_order_id,
  wo.asset_id,
  a.asset_name,
  a.region,
  wo.technician_id,
  t.name AS technician_name,
  t.role AS technician_role,
  t.certification_level,
  wo.date_opened,
  wo.date_closed,
  wo.summary,
  wo.root_cause,
  wo.resolution,
  wo.parts_used,
  wo.resolution_days,
  wo.severity
FROM {schema}.fact_work_orders wo
JOIN {schema}.dim_assets a ON wo.asset_id = a.asset_id
LEFT JOIN {schema}.dim_technicians t ON wo.technician_id = t.tech_id
""".strip(),
    ]

