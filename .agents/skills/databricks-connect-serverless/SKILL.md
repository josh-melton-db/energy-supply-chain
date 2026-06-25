---
name: databricks-connect-serverless
description: Run PySpark code locally against Databricks serverless compute via Databricks Connect. Use when writing/interacting with Databricks from an IDE or local script without a cluster, executing Spark jobs on serverless, or developing data pipelines that write to Unity Catalog from a local environment.
---

# Databricks Connect with Serverless

Run PySpark code locally while execution happens on Databricks serverless compute. No cluster to start or manage.

**Docs:** https://docs.databricks.com/dev-tools/databricks-connect/python/tutorial-serverless

---

## When to Use

- Running PySpark scripts from IDE or terminal against Databricks
- Data generation, ETL, or analytics that write to Unity Catalog
- Local development without provisioning a cluster
- CI/CD or automation that needs Spark execution

**Triggers:** "databricks connect", "run pyspark locally", "serverless compute", "write to Unity Catalog from local", "datagen with databricks connect"

---

## Requirements

- **Python 3.12** (required for Databricks Connect 17.3 LTS; 15.4+ for serverless support)
- **Databricks Connect 15.4 LTS or above** (serverless support)
- **Databricks CLI** installed and authenticated
- **Serverless compute enabled** in the workspace

---

## Setup

### 1. Authenticate

```bash
databricks auth login --host <workspace-url>
```

### 2. Configure Profile

Add to `~/.databrickscfg`:

```ini
[DEFAULT]
host                  = https://your-workspace.cloud.databricks.com
auth_type             = databricks-cli
serverless_compute_id = auto
```

### 3. Install Dependencies

```bash
python3.12 -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install "databricks-connect==17.3.*"
```

---

## Code Patterns

### Basic Session (Serverless)

```python
from databricks.connect import DatabricksSession

# Explicit serverless
spark = DatabricksSession.builder.serverless().profile("DEFAULT").getOrCreate()

# Or use profile with serverless_compute_id=auto in .databrickscfg
spark = DatabricksSession.builder.getOrCreate()
```

### Read Tables

```python
df = spark.read.table("catalog.schema.table_name")
df.show(10)
```

### Write to Unity Catalog

```python
# Create schema if needed
spark.sql("CREATE SCHEMA IF NOT EXISTS catalog.schema_name")

# Write Delta table
df.write.format("delta").mode("overwrite").saveAsTable("catalog.schema.table_name")
```

### Environment Variables (Alternative)

```bash
export DATABRICKS_SERVERLESS_COMPUTE_ID=auto   # serverless
export DATABRICKS_CLUSTER_ID=<cluster_id>      # classic cluster
```

---

## Production-Ready Pattern

Avoid hardcoding compute in code so it works in both local (serverless) and deployed (cluster) environments:

```python
# No .serverless() in code - uses profile/env
spark = DatabricksSession.builder.getOrCreate()
```

Configure `serverless_compute_id = auto` in the DEFAULT profile for local dev; deployed code on a cluster uses the cluster's Spark session automatically.

---

## Common Gotchas

### pyspark and databricks-connect Conflict

`pyspark` and `databricks-connect` cannot be installed in the same environment. Databricks Connect bundles its own PySpark; a standalone `pyspark` causes:

```
Exception: pyspark and databricks-connect cannot be installed at the same time.
```

**Fix:** Use a dedicated venv with only databricks-connect (no standalone pyspark):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install "databricks-connect==17.3.*"
```

Or uninstall the conflicting packages and reinstall:

```bash
pip uninstall -y databricks-connect pyspark pyspark-connect
pip install "databricks-connect==17.3.*"
```

### ANSI Mode / Divide-by-Zero

Serverless (Photon) enforces ANSI mode. Libraries like dbldatagen with weighted distributions can trigger divide-by-zero. Disable if needed:

```python
spark.conf.set("spark.sql.ansi.enabled", "false")
```

### DataGenerator `.drop()` on DataFrame

dbldatagen's `DataGenerator` has no `.drop()` method. Chain `.drop()` on the result:

```python
df = dg.DataGenerator(spark, ...).build().drop("column_to_remove")  # correct
# .build().drop()  # wrong - DataGenerator has no drop
```

### Python Version

Databricks Connect 17.x requires Python 3.12. Check with `python --version`. Use pyenv or a venv with 3.12.

### Default Parallelism Warning

`Error getting default parallelism, using default setting of 200` is normal when running locally—serverless manages parallelism.

---

## Example: Full Datagen + UC Write

```python
from databricks.connect import DatabricksSession
import dbldatagen as dg

spark = DatabricksSession.builder.serverless().profile("DEFAULT").getOrCreate()
spark.conf.set("spark.sql.ansi.enabled", "false")

spark.sql("CREATE SCHEMA IF NOT EXISTS demos.industrials_optimization")

df = (
    dg.DataGenerator(spark, name="dim_assets", rows=50)
    .withColumn("asset_id", "string", expr="concat('ASU-', lpad(id, 3, '0'))")
    .build()
)
df.write.format("delta").mode("overwrite").saveAsTable("demos.industrials_optimization.dim_assets")
```

---

## Related Skills

- **[databricks-config](../databricks-config/SKILL.md)** - profile and authentication setup
- **[databricks-python-sdk](../databricks-python-sdk/SKILL.md)** - SDK, CLI, REST API; Databricks Connect cluster mode
- **[databricks-unity-catalog](../databricks-unity-catalog/SKILL.md)** - catalog governance and volumes
- **[databricks-synthetic-data-generation](../databricks-synthetic-data-generation/SKILL.md)** - synthetic data with Spark/Faker
