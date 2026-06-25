"""
Notebook-friendly wrapper for the modular datagen pipeline.

This script now delegates to the same module entrypoint used by
`run_datagen_connect.py` so behavior stays consistent.
"""

try:
    from data_generation.generator_config import GeneratorConfig
    from data_generation.pipeline import run_pipeline
    from data_generation.spark_session import get_serverless_spark
except ModuleNotFoundError:
    from generator_config import GeneratorConfig
    from pipeline import run_pipeline
    from spark_session import get_serverless_spark


def run_from_notebook_or_connect() -> None:
    cfg = GeneratorConfig()
    local_spark = globals().get("spark")
    if local_spark is None:
        local_spark = get_serverless_spark(cfg.profile)
    run_pipeline(local_spark, cfg)


run_from_notebook_or_connect()