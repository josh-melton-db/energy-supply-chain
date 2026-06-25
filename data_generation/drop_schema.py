"""
Drop all tables and views in demos.industrials_optimization via Databricks Connect
(used by the Gulf Coast operations reference solution sample).
"""

try:
    from data_generation.generator_config import GeneratorConfig
    from data_generation.spark_session import get_serverless_spark
except ModuleNotFoundError:
    from generator_config import GeneratorConfig
    from spark_session import get_serverless_spark


def main() -> None:
    cfg = GeneratorConfig()
    spark = get_serverless_spark(cfg.profile)
    schema = cfg.catalog_schema

    # Drop schema and all objects (tables, views) with CASCADE
    spark.sql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
    print(f"Dropped schema {schema} (all tables and views)")


if __name__ == "__main__":
    main()
