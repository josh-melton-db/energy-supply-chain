from __future__ import annotations


def metric_view_statements(schema: str) -> list[str]:
    return [
        f"""
CREATE OR REPLACE VIEW {schema}.production_metrics
WITH METRICS
LANGUAGE YAML
AS $$
  version: 1.1
  comment: "Terminal throughput and efficiency metrics for Operations Agent and Terminal Manager."
  source: {schema}.fact_iot_asset_daily
  dimensions:
    - name: Asset ID
      expr: asset_id
      comment: "Terminal, fractionator, or pipeline hub identifier."
    - name: Region
      expr: region
      comment: "Geographic region."
    - name: Date
      expr: date
      comment: "Daily telemetry rollup date."
    - name: Operational Status
      expr: CASE WHEN gas_tons >= min_run_rate_tpd THEN 'Up' ELSE 'Down' END
      comment: "Binary indicator: operating at or above minimum run rate for the day."
    - name: Disruption Stage
      expr: CASE
              WHEN disruption_stage_max >= 3 THEN 'Step 3'
              WHEN disruption_stage_max = 2 THEN 'Step 2'
              WHEN disruption_stage_max = 1 THEN 'Step 1'
              ELSE 'None'
            END
      comment: "Highest disruption stage observed on the asset-day."
  measures:
    - name: Total Power kWh
      expr: SUM(power_kwh)
      comment: "Total electricity consumed."
    - name: Total Gas Tons
      expr: SUM(gas_tons)
      comment: "Total hydrocarbon throughput."
    - name: Weighted Carbon kg
      expr: SUM(weighted_carbon_kg)
      comment: "Throughput-weighted carbon numerator."
    - name: Grid Price Spread
      expr: SUM(max_grid_price_mwh - min_grid_price_mwh)
      comment: "Aggregate intraday grid price spread."
    - name: Grid Price Baseline
      expr: SUM(avg_grid_price_mwh)
      comment: "Aggregate average grid price baseline."
    - name: Vibration Alerts
      expr: SUM(vibration_alert_count)
      comment: "Count of vibration alerts."
    - name: Disruption Points
      expr: SUM(disruption_points)
      comment: "Count of telemetry points marked as active disruption."
    - name: Active Disruption Days
      expr: SUM(CASE WHEN disruption_points > 0 THEN 1 ELSE 0 END)
      comment: "Number of asset-days with any disruption signal."
    - name: Specific Energy
      expr: MEASURE(`Total Power kWh`) / NULLIF(MEASURE(`Total Gas Tons`), 0)
      comment: "kWh per ton: electricity required to move or process one unit of supply."
    - name: Grid Volatility Index
      expr: LEAST(100, MEASURE(`Grid Price Spread`) / NULLIF(MEASURE(`Grid Price Baseline`), 0) * 50)
      comment: "0-100 score of electricity price fluctuations."
    - name: Carbon Intensity
      expr: MEASURE(`Weighted Carbon kg`) / NULLIF(MEASURE(`Total Gas Tons`), 0)
      comment: "kg CO2e per ton: CO2 footprint of operations."
$$
""".strip(),
        f"""
CREATE OR REPLACE VIEW {schema}.consumption_metrics
WITH METRICS
LANGUAGE YAML
AS $$
  version: 1.1
  comment: "Commercial and demand metrics for Commercial Agent and Logistics."
  source: {schema}.fact_consumption_daily_enriched
  dimensions:
    - name: Lane ID
      expr: lane_id
      comment: "Lane key combining source asset, customer site, and product."
    - name: Contract ID
      expr: contract_id
      comment: "Contract identifier."
    - name: Customer ID
      expr: customer_id
      comment: "Customer identifier."
    - name: Customer Name
      expr: customer_name
      comment: "Customer site name."
    - name: Contact Email
      expr: contact_email
      comment: "Customer operations contact email."
    - name: Tier
      expr: tier
      comment: "Commercial customer tier."
    - name: Industry
      expr: industry
      comment: "Customer industry."
    - name: Asset ID
      expr: asset_id
      comment: "Supply source asset."
    - name: Asset Name
      expr: asset_name
      comment: "Supply source asset display name."
    - name: Product
      expr: product
      comment: "Contracted product."
    - name: Mode
      expr: mode
      comment: "Primary delivery mode."
    - name: Origin Lat
      expr: origin_lat
      comment: "Latitude of supplying asset."
    - name: Origin Lng
      expr: origin_lng
      comment: "Longitude of supplying asset."
    - name: Dest Lat
      expr: dest_lat
      comment: "Latitude of customer site."
    - name: Dest Lng
      expr: dest_lng
      comment: "Longitude of customer site."
    - name: Date
      expr: date
      comment: "Consumption date."
    - name: Story Chain ID
      expr: story_chain_id
      comment: "Deterministic storyline chain identifier."
  measures:
    - name: Total Usage Tons
      expr: SUM(daily_usage_tons)
      comment: "Total tons consumed over selected period."
    - name: Avg Tank Level Pct
      expr: AVG(tank_level_pct)
      comment: "Average tank fill level percentage."
    - name: Avg Tank Capacity Tons
      expr: AVG(estimated_tank_capacity_tons)
      comment: "Average estimated tank capacity in tons."
    - name: Forecasted Demand
      expr: AVG(daily_usage_tons)
      comment: "Expected consumption proxy based on observed usage (tons/day)."
    - name: Avg Daily Volume
      expr: AVG(daily_usage_tons)
      comment: "Average daily delivered volume (tons/day)."
    - name: Actual Consumption
      expr: MEASURE(`Total Usage Tons`)
      comment: "Actual tons consumed."
    - name: Avg Delay Minutes
      expr: AVG(avg_delay_minutes)
      comment: "Average delivery delay in minutes."
    - name: On-Time Pct
      expr: AVG(on_time_pct)
      comment: "Delivery on-time percentage."
    - name: Avg SLA Risk Pct
      expr: AVG(avg_sla_risk_pct)
      comment: "Average SLA risk probability."
    - name: Avg Asset Capacity TPD
      expr: AVG(max_capacity_tpd)
      comment: "Average max daily capacity for supplying assets."
    - name: Utilization Pct
      expr: MEASURE(`Avg Daily Volume`) / NULLIF(MEASURE(`Avg Asset Capacity TPD`), 0)
      comment: "Daily utilization proxy (volume / max capacity)."
    - name: Available Capacity
      expr: GREATEST(0, MEASURE(`Avg Asset Capacity TPD`) - MEASURE(`Avg Daily Volume`))
      comment: "Remaining daily capacity estimate."
    - name: Days to Zero
      expr: (MEASURE(`Avg Tank Level Pct`) / 100.0 * MEASURE(`Avg Tank Capacity Tons`)) / NULLIF(MEASURE(`Total Usage Tons`), 0)
      comment: "Predicted days until customer tank is empty."
    - name: Days to Zero Operational
      expr: (MEASURE(`Avg Tank Level Pct`) / 100.0 * MEASURE(`Avg Tank Capacity Tons`)) / NULLIF(MEASURE(`Forecasted Demand`), 0)
      comment: "Operational days-to-zero based on average daily demand."
    - name: Upstream Disruption Pct
      expr: AVG(upstream_disruption_pct)
      comment: "Share of records affected by upstream disruptions."
    - name: Propagation Stage Max
      expr: MAX(propagation_stage_max)
      comment: "Maximum propagated stage observed for selected grain."
    - name: Storyline Pressure Score
      expr: (MEASURE(`Upstream Disruption Pct`) * 100.0) + (MEASURE(`Propagation Stage Max`) * 12.0) + (MEASURE(`Avg SLA Risk Pct`) * 100.0)
      comment: "Composite pressure score for storyline progression."
    - name: Production Cost Per Ton
      expr: AVG(production_cost_per_ton)
      comment: "Production cost per ton (USD/ton) from asset financials. Use for landed cost, not contract/selling price."
    - name: Distribution Cost Per Ton
      expr: AVG(distribution_cost_per_ton)
      comment: "Distribution cost per ton (USD/ton) from haversine distance; pipeline = 0."
    - name: Total Landed Cost Per Ton
      expr: MEASURE(`Production Cost Per Ton`) + MEASURE(`Distribution Cost Per Ton`)
      comment: "Total landed cost (supply + distribution) per ton. Synonyms: landed cost, cost to serve, delivered cost."
$$
""".strip(),
        f"""
CREATE OR REPLACE VIEW {schema}.contract_metrics
WITH METRICS
LANGUAGE YAML
AS $$
  version: 1.1
  comment: "Contract and SLA metrics for CFO and Commercial Agent."
  source: {schema}.fact_consumption_contract_monthly
  joins:
    - name: contracts
      source: {schema}.dim_contracts
      'on': source.contract_id = contracts.contract_id
      joins:
        - name: customers
          source: {schema}.dim_customers
          'on': contracts.customer_id = customers.customer_id
        - name: assets
          source: {schema}.dim_assets
          'on': contracts.asset_id = assets.asset_id
  dimensions:
    - name: Lane ID
      expr: CONCAT(contracts.asset_id, '-', contracts.customer_id, '-', contracts.product)
      comment: "Lane key combining source asset, customer site, and product."
    - name: Contract ID
      expr: source.contract_id
      comment: "Contract identifier."
    - name: Customer ID
      expr: contracts.customer_id
      comment: "Customer identifier."
    - name: Customer Name
      expr: contracts.customers.customer_name
      comment: "Customer site name."
    - name: Asset ID
      expr: contracts.asset_id
      comment: "Supply source asset."
    - name: Product
      expr: contracts.product
      comment: "Contracted product."
    - name: Mode
      expr: contracts.mode
      comment: "Primary delivery mode."
    - name: Story Chain ID
      expr: contracts.story_chain_id
      comment: "Deterministic storyline chain identifier."
    - name: Lane Priority
      expr: contracts.lane_priority
      comment: "Business criticality assigned to lane."
    - name: Month
      expr: source.month
      comment: "Contract month."
  measures:
    - name: Committed Volume
      expr: SUM(committed_volume_tons)
      comment: "Contracted monthly volume."
    - name: Actual Volume
      expr: SUM(actual_volume_tons)
      comment: "Observed consumed volume."
    - name: Contract Price USD
      expr: AVG(price_per_ton_usd)
      comment: "Average contracted price in USD per ton."
    - name: Volume Gap Tons
      expr: MEASURE(`Committed Volume`) - MEASURE(`Actual Volume`)
      comment: "Committed minus consumed volume."
    - name: Take-or-Pay Gap
      expr: SUM((committed_volume_tons - actual_volume_tons) * price_per_ton_usd)
      comment: "USD value of committed supply not consumed."
    - name: Price per Volume (Contract)
      expr: MEASURE(`Contract Price USD`)
      comment: "Contract selling price, USD per ton."
    - name: LD Exposure
      expr: SUM(GREATEST(0, committed_volume_tons - actual_volume_tons) * ld_penalty_rate_usd / 30.0)
      comment: "Daily penalty cost for failing Guarantee of Supply (USD/day)."
    - name: Critical Contract Count
      expr: SUM(CASE WHEN contracts.lane_priority = 'critical' THEN 1 ELSE 0 END)
      comment: "Count of critical-priority contracts in selected grain."
$$
""".strip(),
        f"""
CREATE OR REPLACE VIEW {schema}.financial_metrics
WITH METRICS
LANGUAGE YAML
AS $$
  version: 1.1
  comment: "P&L metrics for CFO and P&L Agent."
  source: {schema}.fact_financials
  dimensions:
    - name: Asset ID
      expr: asset_id
      comment: "Asset identifier."
    - name: Date
      expr: date
      comment: "Financial posting date."
    - name: Month
      expr: DATE_TRUNC('MONTH', date)
      comment: "Financial month."
  measures:
    - name: Total Revenue
      expr: SUM(daily_revenue_usd)
      comment: "Total daily revenue."
    - name: Total Energy Cost
      expr: SUM(daily_energy_cost_usd)
      comment: "Total energy cost."
    - name: Total Ops Cost
      expr: SUM(daily_ops_cost_usd)
      comment: "Total operations cost."
    - name: Total Cost
      expr: MEASURE(`Total Energy Cost`) + MEASURE(`Total Ops Cost`)
      comment: "Total operational cost (energy + operations)."
    - name: Total Gas Produced
      expr: SUM(gas_produced_tons)
      comment: "Total processed throughput in tons."
    - name: Cost per Volume
      expr: MEASURE(`Total Cost`) / NULLIF(MEASURE(`Total Gas Produced`), 0)
      comment: "Total operating cost per ton (USD/ton)."
    - name: Price per Volume (Realized)
      expr: MEASURE(`Total Revenue`) / NULLIF(MEASURE(`Total Gas Produced`), 0)
      comment: "Realized selling price per ton (USD/ton)."
    - name: Operating Margin
      expr: (MEASURE(`Total Revenue`) - MEASURE(`Total Cost`)) / NULLIF(MEASURE(`Total Revenue`), 0) * 100
      comment: "Profitability %: revenue remaining after operational expenses."
$$
""".strip(),
        f"""
CREATE OR REPLACE VIEW {schema}.forecast_metrics
WITH METRICS
LANGUAGE YAML
AS $$
  version: 1.1
  comment: "Forecast planning metrics for balancing expected demand and planned supply."
  source: {schema}.fact_forecast_balance_daily
  joins:
    - name: contracts
      source: {schema}.dim_contracts
      'on': source.contract_id = contracts.contract_id
      joins:
        - name: customers
          source: {schema}.dim_customers
          'on': contracts.customer_id = customers.customer_id
        - name: assets
          source: {schema}.dim_assets
          'on': contracts.asset_id = assets.asset_id
  dimensions:
    - name: Lane ID
      expr: CONCAT(contracts.asset_id, '-', contracts.customer_id, '-', contracts.product)
      comment: "Lane key combining source asset, customer site, and product."
    - name: Contract ID
      expr: source.contract_id
      comment: "Contract identifier."
    - name: Customer ID
      expr: contracts.customer_id
      comment: "Customer identifier."
    - name: Customer Name
      expr: contracts.customers.customer_name
      comment: "Customer site name."
    - name: Asset ID
      expr: contracts.asset_id
      comment: "Supply source asset."
    - name: Product
      expr: contracts.product
      comment: "Contracted product."
    - name: Mode
      expr: contracts.mode
      comment: "Primary delivery mode."
    - name: Story Chain ID
      expr: contracts.story_chain_id
      comment: "Deterministic storyline chain identifier."
    - name: Lane Priority
      expr: contracts.lane_priority
      comment: "Business criticality assigned to lane."
    - name: Forecast Date
      expr: source.forecast_date
      comment: "Forecast target date."
  measures:
    - name: Forecasted Demand
      expr: AVG(forecasted_demand_tpd)
      comment: "Expected customer consumption (tons/day), averaged over forecast period."
    - name: Forecasted Supply
      expr: AVG(forecasted_supply_tpd)
      comment: "Planned terminal or pipeline supply output (tons/day), averaged over forecast period."
    - name: Supply/Demand Discrepancy
      expr: MEASURE(`Forecasted Supply`) - MEASURE(`Forecasted Demand`)
      comment: "Delta between planned supply and forecasted demand (tons/day)."
    - name: Forecast Discrepancy Pct
      expr: (MEASURE(`Forecasted Supply`) - MEASURE(`Forecasted Demand`)) / NULLIF(MEASURE(`Forecasted Demand`), 0) * 100
      comment: "Percentage discrepancy between forecasted supply and demand."
    - name: Forecast Risk Score
      expr: ABS(MEASURE(`Supply/Demand Discrepancy`)) + (CASE WHEN MEASURE(`Supply/Demand Discrepancy`) < 0 THEN 10 ELSE 0 END)
      comment: "Risk score emphasizing under-supply."
$$
""".strip(),
        f"""
CREATE OR REPLACE VIEW {schema}.profitability_metrics
WITH METRICS
LANGUAGE YAML
AS $$
  version: 1.1
  comment: "Lane-level profitability for P&L and Sales."
  source: {schema}.fact_financials_lane_monthly
  joins:
    - name: contracts
      source: {schema}.dim_contracts
      'on': source.lane_id = contracts.lane_id
      joins:
        - name: customers
          source: {schema}.dim_customers
          'on': contracts.customer_id = customers.customer_id
        - name: assets
          source: {schema}.dim_assets
          'on': contracts.asset_id = assets.asset_id
  dimensions:
    - name: Lane ID
      expr: source.lane_id
      comment: "First-class lane grain."
    - name: Contract ID
      expr: contracts.contract_id
      comment: "Contract identifier."
    - name: Customer ID
      expr: contracts.customer_id
      comment: "Customer identifier."
    - name: Asset ID
      expr: contracts.asset_id
      comment: "Supply source asset."
    - name: Product
      expr: contracts.product
      comment: "Contracted product."
    - name: Month
      expr: source.month
      comment: "Financial month."
  measures:
    - name: Lane Revenue
      expr: SUM(lane_revenue_usd)
      comment: "Lane revenue from actual volume and contract price."
    - name: Lane Cost
      expr: SUM(lane_cost_usd)
      comment: "Volume-share allocated cost from asset financials."
    - name: Lane Margin USD
      expr: SUM(lane_margin_usd)
      comment: "Lane profit in USD."
    - name: Lane Margin Pct
      expr: AVG(lane_margin_pct)
      comment: "Lane profitability as percentage of revenue."
$$
""".strip(),
        f"""
CREATE OR REPLACE VIEW {schema}.incident_metrics
WITH METRICS
LANGUAGE YAML
AS $$
  version: 1.1
  comment: "Incident detection from terminal, pipeline, and consumption signals."
  source: {schema}.fact_incident_daily_enriched
  dimensions:
    - name: Lane ID
      expr: lane_id
      comment: "Lane key."
    - name: Asset ID
      expr: asset_id
      comment: "Supply asset."
    - name: Customer Name
      expr: customer_name
      comment: "Customer site."
    - name: Date
      expr: date
      comment: "Incident date."
    - name: Incident Type
      expr: CASE
              WHEN vibration_alert_count > 80 THEN 'vibration_anomaly'
              WHEN iot_disruption_stage_max >= 2 THEN 'supply_shortfall'
              WHEN avg_sla_risk_pct > 0.25 AND mode = 'truck' THEN 'weather_disruption'
              WHEN (tank_level_pct / 100.0 * estimated_tank_capacity_tons) / NULLIF(daily_usage_tons, 0) < 4 THEN 'inventory_critical'
              WHEN propagation_stage_max >= 2 THEN 'pipeline_constraint'
              ELSE 'none'
            END
      comment: "Derived incident type from signal thresholds."
    - name: Region
      expr: region
      comment: "Geographic region of supply asset."
  measures:
    - name: Incident Count
      expr: SUM(CASE WHEN vibration_alert_count > 50 OR disruption_points > 0 OR avg_sla_risk_pct > 0.15 OR propagation_stage_max >= 2 THEN 1 ELSE 0 END)
      comment: "Count of days with incident-level signals."
    - name: Avg Severity Score
      expr: AVG(COALESCE(vibration_alert_count, 0) / 100.0 + avg_sla_risk_pct)
      comment: "Average signal severity (0-2 scale)."
    - name: Impact Minutes
      expr: SUM(COALESCE(disruption_points, 0) * 15)
      comment: "Estimated total downtime in minutes."
    - name: Affected Volume Tons
      expr: SUM(CASE WHEN disruption_points > 0 OR avg_sla_risk_pct > 0.15 THEN daily_usage_tons ELSE 0 END)
      comment: "Volume affected by incident signals."
$$
""".strip(),
        f"""
CREATE OR REPLACE VIEW {schema}.maintenance_metrics
WITH METRICS
LANGUAGE YAML
AS $$
  version: 1.1
  comment: "Maintenance and work order metrics for operations teams."
  source: {schema}.fact_work_orders_enriched
  joins:
    - name: parts
      source: {schema}.dim_parts_inventory
      'on': source.asset_id = parts.asset_id
    - name: techs
      source: {schema}.dim_technicians
      'on': source.asset_id = techs.asset_id
  dimensions:
    - name: Asset ID
      expr: source.asset_id
      comment: "Supply asset identifier."
    - name: Asset Name
      expr: source.asset_name
      comment: "Supply asset display name."
    - name: Region
      expr: source.region
      comment: "Geographic region."
    - name: Technician Name
      expr: source.technician_name
      comment: "Assigned technician."
    - name: Technician Role
      expr: source.technician_role
      comment: "Technician specialization."
    - name: Severity
      expr: source.severity
      comment: "Work order severity."
    - name: Date Opened
      expr: source.date_opened
      comment: "Work order open date."
  measures:
    - name: Work Order Count
      expr: COUNT(DISTINCT source.work_order_id)
      comment: "Total work orders."
    - name: Avg Resolution Days
      expr: AVG(source.resolution_days)
      comment: "Average days to close a work order."
    - name: Parts Used Count
      expr: SUM(source.parts_used)
      comment: "Total parts consumed."
    - name: Available Technicians
      expr: COUNT(DISTINCT CASE WHEN techs.available THEN techs.tech_id END)
      comment: "Technicians currently available."
    - name: Parts In Stock
      expr: SUM(DISTINCT parts.qty_on_hand)
      comment: "Total spare parts on hand."
$$
""".strip(),
        f"""
CREATE OR REPLACE VIEW {schema}.vendor_metrics
WITH METRICS
LANGUAGE YAML
AS $$
  version: 1.1
  comment: "External supply vendor metrics for procurement."
  source: {schema}.dim_vendors
  dimensions:
    - name: Vendor ID
      expr: vendor_id
      comment: "Vendor identifier."
    - name: Vendor Name
      expr: name
      comment: "Vendor company name."
    - name: Products
      expr: products
      comment: "Available products (comma-separated)."
  measures:
    - name: Available Capacity TPD
      expr: SUM(capacity_tpd)
      comment: "Total available vendor capacity (tons/day)."
    - name: Avg Price Premium Pct
      expr: AVG(price_premium_pct)
      comment: "Average price premium over contract rates."
    - name: Avg ETA Hours
      expr: AVG(eta_hours)
      comment: "Average estimated delivery time."
    - name: Vendor Count
      expr: COUNT(DISTINCT vendor_id)
      comment: "Number of available vendors."
$$
""".strip(),
    ]

