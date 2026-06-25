# Genie Space Curation for Gulf Coast Landed Cost Semantics

Instructions below support the **reference solution** Genie space (customer-shareable curation, not internal-only notes).

The `genie_space_template.json` includes embedded instructions and example SQL queries that are deployed automatically when you run `create_genie_space.py`. These align "cost" questions with Total Landed Cost Per Ton from consumption_metrics.

If you need to refine or extend curation, you can add the following manually in the Databricks UI (Configure > Instructions).

## Text Instructions (General)

Add to **Configure > Instructions > Text**:

```
Lane cost semantics:
- For lane questions about "cost", "average cost", or "highest cost", use Total Landed Cost Per Ton from consumption_metrics. This is supply cost + distribution cost (cost to serve).
- Contract Price USD in contract_metrics is the selling price (what the customer pays), NOT landed cost. Do not use it for "which lane has the highest cost" questions.
- profitability_metrics.Lane Cost is allocated cost in USD, not per-ton. For per-ton cost ranking, use consumption_metrics.Total Landed Cost Per Ton.
```

## Example SQL Query (Trusted Asset)

Add to **Configure > Instructions > SQL Queries** as an example query:

**Title:** Which lane has the highest landed cost?

**SQL:**
```sql
SELECT
  `Lane ID`,
  `Asset Name`,
  `Customer Name`,
  MEASURE(`Total Landed Cost Per Ton`) AS total_landed_cost_per_ton
FROM demos.industrials_optimization.consumption_metrics
GROUP BY `Lane ID`, `Asset Name`, `Customer Name`
ORDER BY MEASURE(`Total Landed Cost Per Ton`) DESC
LIMIT 1
```

This ensures "which lane has the highest average cost" and similar phrasings map to the canonical landed cost measure used by the UI.

## Knowledge Store (Optional)

In **Configure > Data**, for `consumption_metrics`:
- Add synonym "cost to serve" and "delivered cost" to the `Total Landed Cost Per Ton` measure description if the UI supports column-level metadata.

For `contract_metrics`:
- Clarify in column description that `Contract Price USD` is selling price, not cost.
