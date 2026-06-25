"""
Run Gulf Coast operations datagen via Databricks Connect.
Writes tables and metric views to demos.industrials_optimization for the reference solution dataset.
"""

try:
    from data_generation.generator_config import GeneratorConfig
    from data_generation.pipeline import run_pipeline
    from data_generation.spark_session import get_serverless_spark
except ModuleNotFoundError:
    from generator_config import GeneratorConfig
    from pipeline import run_pipeline
    from spark_session import get_serverless_spark


def main() -> None:
    cfg = GeneratorConfig()
    spark = get_serverless_spark(cfg.profile)
    run_pipeline(spark, cfg)


if __name__ == "__main__":
    main()
