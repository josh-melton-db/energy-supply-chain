"""Minimal serverless example aligned with modular data generation."""

try:
    from data_generation.generator_config import GeneratorConfig
    from data_generation.spark_session import get_serverless_spark
except ModuleNotFoundError:
    from generator_config import GeneratorConfig
    from spark_session import get_serverless_spark


def main() -> None:
    cfg = GeneratorConfig()
    spark = get_serverless_spark(cfg.profile)
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {cfg.catalog_schema}")
    print("Connected to serverless. Existing metric views:")
    spark.sql(
        f"""
        SELECT table_name
        FROM demos.information_schema.tables
        WHERE table_catalog = 'demos'
          AND table_schema = 'industrials_optimization'
          AND table_type = 'METRIC_VIEW'
        ORDER BY table_name
        """
    ).show(truncate=False)


if __name__ == "__main__":
    main()
