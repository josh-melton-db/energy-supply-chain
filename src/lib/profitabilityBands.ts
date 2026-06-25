import type { Lane } from "@/types/domain";
import { RISK_THRESHOLDS as T } from "@/types/domain";

export type ProfitabilityBands = {
  highMax: number;
  mediumMax: number;
};

export function computeProfitabilityBands(lanes: Lane[]): ProfitabilityBands {
  const profits = lanes
    .map((lane) => lane.profitabilityPct ?? 0)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (profits.length === 0) {
    return { highMax: T.profitabilityCriticalPct, mediumMax: T.profitabilityWatchPct };
  }
  const n = profits.length;
  const redCount = Math.max(1, Math.round(n * 0.2));
  const yellowCount = Math.max(1, Math.round(n * 0.5));
  const highIdx = Math.min(n - 1, redCount - 1);
  const mediumIdx = Math.min(n - 1, redCount + yellowCount - 1);
  return {
    highMax: profits[highIdx],
    mediumMax: profits[mediumIdx],
  };
}

export function profitabilityBand(profitPct: number, bands: ProfitabilityBands): "low" | "medium" | "high" {
  if (profitPct <= bands.highMax) return "high";
  if (profitPct <= bands.mediumMax) return "medium";
  return "low";
}

export function profitabilityLabels(bands: ProfitabilityBands) {
  return {
    low: `> ${bands.mediumMax.toFixed(1)}%`,
    mid: `${bands.highMax.toFixed(1)}% – ${bands.mediumMax.toFixed(1)}%`,
    high: `≤ ${bands.highMax.toFixed(1)}%`,
  };
}
