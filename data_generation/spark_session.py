from __future__ import annotations

from databricks.connect import DatabricksSession


def get_serverless_spark(profile: str):
    spark = DatabricksSession.builder.serverless().profile(profile).getOrCreate()
    spark.conf.set("spark.sql.ansi.enabled", "false")
    return spark

