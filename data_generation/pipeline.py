from __future__ import annotations

from pyspark.sql import DataFrame

try:
    from data_generation.dimension_generators import (
        generate_dim_assets_rows,
        generate_dim_contracts_rows,
        generate_dim_customers_rows,
        generate_dim_parts_inventory_rows,
        generate_dim_technicians_rows,
        generate_dim_vendors_rows,
    )
    from data_generation.fact_generators import (
        generate_fact_consumption_df,
        generate_fact_financials_df,
        generate_fact_iot_telemetry_df,
        generate_fact_work_orders_rows,
        generate_forecast_dfs,
    )
    from data_generation.helper_views_sql import helper_view_statements
    from data_generation.metric_views_sql import metric_view_statements
except ModuleNotFoundError:
    from dimension_generators import (
        generate_dim_assets_rows,
        generate_dim_contracts_rows,
        generate_dim_customers_rows,
        generate_dim_parts_inventory_rows,
        generate_dim_technicians_rows,
        generate_dim_vendors_rows,
    )
    from fact_generators import (
        generate_fact_consumption_df,
        generate_fact_financials_df,
        generate_fact_iot_telemetry_df,
        generate_fact_work_orders_rows,
        generate_forecast_dfs,
    )
    from helper_views_sql import helper_view_statements
    from metric_views_sql import metric_view_statements


def _write_table(df: DataFrame, table_name: str) -> None:
    df.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(table_name)


def run_pipeline(spark, cfg) -> None:
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {cfg.catalog_schema}")

    print("Generating dim_assets...")
    asset_rows = generate_dim_assets_rows(cfg)
    df_dim_assets = spark.createDataFrame(asset_rows)
    _write_table(df_dim_assets, f"{cfg.catalog_schema}.dim_assets")
    print(f"  -> Wrote {cfg.catalog_schema}.dim_assets")

    print("Generating dim_customers...")
    customer_rows = generate_dim_customers_rows(cfg)
    df_dim_customers = spark.createDataFrame(customer_rows)
    _write_table(df_dim_customers, f"{cfg.catalog_schema}.dim_customers")
    print(f"  -> Wrote {cfg.catalog_schema}.dim_customers")

    print("Generating dim_contracts...")
    contract_rows = generate_dim_contracts_rows(cfg, asset_rows, customer_rows)
    df_dim_contracts = spark.createDataFrame(contract_rows)
    _write_table(df_dim_contracts, f"{cfg.catalog_schema}.dim_contracts")
    print(f"  -> Wrote {cfg.catalog_schema}.dim_contracts")

    print("Generating dim_technicians...")
    technician_rows = generate_dim_technicians_rows(cfg, asset_rows)
    df_dim_technicians = spark.createDataFrame(technician_rows)
    _write_table(df_dim_technicians, f"{cfg.catalog_schema}.dim_technicians")
    print(f"  -> Wrote {cfg.catalog_schema}.dim_technicians")

    print("Generating dim_parts_inventory...")
    parts_rows = generate_dim_parts_inventory_rows(cfg, asset_rows)
    df_dim_parts = spark.createDataFrame(parts_rows)
    _write_table(df_dim_parts, f"{cfg.catalog_schema}.dim_parts_inventory")
    print(f"  -> Wrote {cfg.catalog_schema}.dim_parts_inventory")

    print("Generating dim_vendors...")
    vendor_rows = generate_dim_vendors_rows(cfg)
    df_dim_vendors = spark.createDataFrame(vendor_rows)
    _write_table(df_dim_vendors, f"{cfg.catalog_schema}.dim_vendors")
    print(f"  -> Wrote {cfg.catalog_schema}.dim_vendors")

    print("Generating fact_iot_telemetry...")
    df_fact_iot = generate_fact_iot_telemetry_df(spark, cfg, df_dim_assets)
    _write_table(df_fact_iot, f"{cfg.catalog_schema}.fact_iot_telemetry")
    print(f"  -> Wrote {cfg.catalog_schema}.fact_iot_telemetry")

    print("Generating fact_consumption...")
    df_fact_consumption = generate_fact_consumption_df(spark, cfg, df_dim_contracts)
    _write_table(df_fact_consumption, f"{cfg.catalog_schema}.fact_consumption")
    print(f"  -> Wrote {cfg.catalog_schema}.fact_consumption")

    print("Generating fact_financials...")
    df_fact_financials = generate_fact_financials_df(spark, cfg, df_fact_iot, df_dim_assets, df_dim_contracts)
    _write_table(df_fact_financials, f"{cfg.catalog_schema}.fact_financials")
    print(f"  -> Wrote {cfg.catalog_schema}.fact_financials")

    print("Generating fact_demand_forecast and fact_supply_forecast...")
    df_fact_demand_forecast, df_fact_supply_forecast = generate_forecast_dfs(
        spark, cfg, df_fact_consumption, df_fact_iot, df_dim_contracts
    )
    _write_table(df_fact_demand_forecast, f"{cfg.catalog_schema}.fact_demand_forecast")
    _write_table(df_fact_supply_forecast, f"{cfg.catalog_schema}.fact_supply_forecast")
    print(f"  -> Wrote {cfg.catalog_schema}.fact_demand_forecast")
    print(f"  -> Wrote {cfg.catalog_schema}.fact_supply_forecast")

    print("Generating fact_work_orders...")
    work_order_rows = generate_fact_work_orders_rows(cfg, asset_rows, technician_rows)
    df_work_orders = spark.createDataFrame(work_order_rows)
    _write_table(df_work_orders, f"{cfg.catalog_schema}.fact_work_orders")
    print(f"  -> Wrote {cfg.catalog_schema}.fact_work_orders")

    print("\nCreating helper views...")
    for statement in helper_view_statements(cfg.catalog_schema):
        spark.sql(statement)
    print(f"  -> helper views in {cfg.catalog_schema}")

    print("\nCreating metric views...")
    view_names = ["production_metrics", "consumption_metrics", "contract_metrics", "financial_metrics", "forecast_metrics", "profitability_metrics", "incident_metrics", "maintenance_metrics", "vendor_metrics"]
    for i, statement in enumerate(metric_view_statements(cfg.catalog_schema)):
        try:
            spark.sql(statement)
            print(f"  -> {view_names[i]}")
        except Exception as e:
            print(f"  -> {view_names[i]} SKIPPED ({type(e).__name__})")

    print("\nVerifying fact_iot_telemetry (sample):")
    spark.table(f"{cfg.catalog_schema}.fact_iot_telemetry").limit(10).show()

    print(f"\nDone. Tables and metric views in {cfg.catalog_schema}:")
    for t in [
        "dim_assets",
        "dim_customers",
        "dim_contracts",
        "dim_technicians",
        "dim_parts_inventory",
        "dim_vendors",
        "fact_iot_telemetry",
        "fact_consumption",
        "fact_financials",
        "fact_demand_forecast",
        "fact_supply_forecast",
        "fact_work_orders",
    ]:
        cnt = spark.table(f"{cfg.catalog_schema}.{t}").count()
        print(f"  - {t}: {cnt:,} rows")
    print("  Metric views: production_metrics, consumption_metrics, contract_metrics, financial_metrics, forecast_metrics, profitability_metrics, incident_metrics, maintenance_metrics, vendor_metrics")

