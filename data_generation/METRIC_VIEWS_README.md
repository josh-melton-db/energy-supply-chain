# Gulf Coast Operations Metric Views

Unity Catalog metric views in `demos.industrials_optimization` for querying US Gulf Coast oil and gas operations KPIs. These views are part of the **reference solution** in this repo, suitable to share with customers as documented patterns they can adapt to their catalog and metrics.

## Metric Views

| View | Metrics | Primary Audience |
|------|---------|------------------|
| **production_metrics** | Specific Energy, Operational Status, Grid Volatility Index, Carbon Intensity | Operations Agent, Terminal Manager, COO |
| **consumption_metrics** | Forecasted Demand, Days to Zero, Actual Consumption, Total Landed Cost Per Ton, Supply Cost Per Ton, Distribution Cost Per Ton | Commercial Agent, Logistics |
| **contract_metrics** | Take-or-Pay Gap, Price per Barrel, LD Exposure | CFO, Commercial Agent |
| **financial_metrics** | Cost per Barrel, Operating Margin, Price per Barrel | P&L Agent, CFO |
| **forecast_metrics** | Forecasted Supply/Demand, Discrepancy, Balance Ratio | Logistics, Terminal Manager |
| **profitability_metrics** | Lane Revenue, Lane Cost, Lane Margin | CFO, P&L Agent |
| **incident_metrics** | Incident Count, Avg Severity, Impact Minutes, Affected Volume | Operations, Reliability |
| **maintenance_metrics** | Work Order Count, Avg Resolution Days, Parts In Stock, Available Technicians | Maintenance, Reliability |
| **vendor_metrics** | Available Capacity, Price Premium, ETA Hours, Vendor Count | Procurement, Logistics |

## Example Queries

### Operations Metrics (Specific Energy by Region)
```sql
SELECT
  `Region`,
  `Date`,
  MEASURE(`Specific Energy`) AS specific_energy_kwh_per_ton,
  MEASURE(`Total Gas Tons`) AS throughput_tons
FROM demos.industrials_optimization.production_metrics
GROUP BY `Region`, `Date`
ORDER BY `Date`, `Region`
LIMIT 20
```

### Financial Metrics (Profitability by Month)
```sql
SELECT
  `Month`,
  MEASURE(`Operating Margin`) AS operating_margin_pct,
  MEASURE(`Cost per Volume`) AS cost_per_ton,
  MEASURE(`Total Revenue`) AS revenue
FROM demos.industrials_optimization.financial_metrics
GROUP BY `Month`
ORDER BY `Month`
```

### Contract Metrics (Take-or-Pay Gap)
```sql
SELECT
  `Contract ID`,
  `Month`,
  MEASURE(`Take-or-Pay Gap`) AS gap_usd,
  MEASURE(`LD Exposure`) AS ld_exposure_usd_day
FROM demos.industrials_optimization.contract_metrics
GROUP BY `Contract ID`, `Month`
HAVING MEASURE(`Take-or-Pay Gap`) > 0
ORDER BY MEASURE(`Take-or-Pay Gap`) DESC
LIMIT 10
```

### Consumption Metrics (Days to Zero)
```sql
SELECT
  `Contract ID`,
  `Date`,
  MEASURE(`Days to Zero`) AS days_to_zero,
  MEASURE(`Actual Consumption`) AS tons_consumed
FROM demos.industrials_optimization.consumption_metrics
GROUP BY `Contract ID`, `Date`
ORDER BY MEASURE(`Days to Zero`) ASC
LIMIT 20
```

### Consumption Metrics (Landed Cost by Lane)
Use `Total Landed Cost Per Ton` from consumption_metrics for lane cost-to-serve. Do not use Contract Price USD (selling price) from contract_metrics.
```sql
SELECT
  `Lane ID`,
  `Asset Name`,
  `Customer Name`,
  MEASURE(`Total Landed Cost Per Ton`) AS total_landed_cost_per_ton,
  MEASURE(`Production Cost Per Ton`) AS supply_cost_per_ton,
  MEASURE(`Distribution Cost Per Ton`) AS distribution_cost_per_ton
FROM demos.industrials_optimization.consumption_metrics
GROUP BY `Lane ID`, `Asset Name`, `Customer Name`
ORDER BY MEASURE(`Total Landed Cost Per Ton`) DESC
LIMIT 20
```

### Incident Metrics (Vibration Incidents by Region)
```sql
SELECT
  `Region`,
  `Incident Type`,
  MEASURE(`Incident Count`) AS incidents,
  MEASURE(`Avg Severity Score`) AS avg_severity
FROM demos.industrials_optimization.incident_metrics
WHERE `Incident Type` = 'vibration_anomaly'
GROUP BY `Region`, `Incident Type`
ORDER BY MEASURE(`Incident Count`) DESC
```

### Maintenance Metrics (Resolution Time by Asset)
```sql
SELECT
  `Asset Name`,
  MEASURE(`Work Order Count`) AS work_orders,
  MEASURE(`Avg Resolution Days`) AS avg_resolution_days,
  MEASURE(`Available Technicians`) AS available_techs
FROM demos.industrials_optimization.maintenance_metrics
GROUP BY `Asset Name`
ORDER BY MEASURE(`Avg Resolution Days`) DESC
```

### Vendor Metrics (Vendor Options by Product)
```sql
SELECT
  `Vendor Name`,
  `Products`,
  MEASURE(`Available Capacity TPD`) AS capacity_tpd,
  MEASURE(`Avg Price Premium Pct`) AS price_premium,
  MEASURE(`Avg ETA Hours`) AS eta_hours
FROM demos.industrials_optimization.vendor_metrics
GROUP BY `Vendor Name`, `Products`
ORDER BY MEASURE(`Avg ETA Hours`) ASC
```

## Forecast Tables

| Table | Description |
|-------|-------------|
| **fact_demand_forecast** | Expected customer consumption (tons/day) by contract and date |
| **fact_supply_forecast** | Planned production output (tons/day) by asset and date |

## Run Data Generation

```bash
cd /path/to/gulf-coast-operations
source .venv/bin/activate
python data_generation/run_datagen_connect.py
```

Requires Databricks Connect with serverless (see `databricks-connect-serverless` skill).

## Script Entry Points

- `data_generation/run_datagen_connect.py`: thin production runner (serverless + full pipeline).
- `data_generation/datagen.py`: notebook-friendly wrapper delegating to the same pipeline.
- `data_generation/serverless_example.py`: minimal connection and metadata query example.
- `data_generation/create_genie_space.py`: create/update Genie Space from `genie_space_template.json` (uses metric views as sources). Requires `databricks-sdk` and metric views to exist.

## Validation Checks

### 1) Schema and Contract Validation

```sql
SELECT table_name, table_type
FROM demos.industrials_optimization.information_schema.tables
WHERE table_name IN (
  'dim_assets', 'dim_customers', 'dim_contracts',
  'dim_technicians', 'dim_parts_inventory', 'dim_vendors',
  'fact_iot_telemetry', 'fact_consumption', 'fact_financials',
  'fact_demand_forecast', 'fact_supply_forecast', 'fact_work_orders',
  'fact_iot_asset_daily', 'fact_consumption_daily',
  'fact_consumption_contract_monthly', 'fact_forecast_balance_daily',
  'fact_work_orders_enriched',
  'production_metrics', 'consumption_metrics', 'contract_metrics',
  'financial_metrics', 'forecast_metrics', 'profitability_metrics',
  'incident_metrics', 'maintenance_metrics', 'vendor_metrics'
)
ORDER BY table_name;
```

### 2) Realism Sanity Checks

```sql
-- Lane geography and volume sanity
SELECT
  `Lane ID`,
  `Asset Name`,
  `Customer Name`,
  MEASURE(`Avg Daily Volume`) AS avg_daily_volume,
  MEASURE(`Days to Zero`) AS days_to_zero
FROM demos.industrials_optimization.consumption_metrics
GROUP BY
  `Lane ID`, `Asset Name`, `Customer Name`
ORDER BY MEASURE(`Days to Zero`) ASC
LIMIT 20;
```

```sql
-- Fleet-level KPI distribution sanity
SELECT
  MEASURE(`On-Time Pct`) AS on_time_pct,
  MEASURE(`Avg SLA Risk Pct`) AS sla_risk_pct,
  MEASURE(`Utilization Pct`) AS utilization_pct
FROM demos.industrials_optimization.consumption_metrics;
```

### 3) Reproducibility Checks

Run `python data_generation/run_datagen_connect.py` twice with the same seed (`GeneratorConfig.seed`), then compare:

```sql
SELECT
  COUNT(*) AS n_rows,
  ROUND(AVG(actual_tons_consumed), 4) AS avg_consumption,
  ROUND(AVG(tank_level_pct), 4) AS avg_tank_level
FROM demos.industrials_optimization.fact_consumption;
```

Expected: identical row counts and stable summary statistics across reruns with the same seed.
