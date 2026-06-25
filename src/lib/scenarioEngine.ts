import type { Lane, ScenarioParams, ScenarioResult, VarianceItem } from "@/types/domain";
import { DEFAULT_SCENARIO } from "@/types/domain";

export function isScenarioActive(params: ScenarioParams): boolean {
  return (
    params.energyPriceShiftPct !== 0 ||
    params.demandShiftPct !== 0 ||
    params.logisticsCostShiftPct !== 0 ||
    params.facilityOutageId !== null ||
    params.carbonPriceUsdPerTon !== 0
  );
}

const PRICE_PER_TON = 195;

function estimateLaneRevenueUsd(lane: Lane): number {
  return lane.avgDailyVolume * PRICE_PER_TON * 30;
}

function estimateLaneTotalCostUsd(lane: Lane): number {
  const rev = estimateLaneRevenueUsd(lane);
  return rev * (1 - (lane.profitabilityPct ?? 10) / 100);
}

function estimateLaneEnergyCostUsd(lane: Lane): number {
  return estimateLaneTotalCostUsd(lane) * 0.55;
}

function estimateLaneLogisticsCostUsd(lane: Lane): number {
  return estimateLaneTotalCostUsd(lane) * 0.25;
}

export function applyScenario(baseLanes: Lane[], params: ScenarioParams): ScenarioResult {
  const baseKpi = computeKpi(baseLanes);

  if (!isScenarioActive(params)) {
    return {
      adjustedLanes: baseLanes,
      kpiSummary: { ...baseKpi, plImpactUsd: 0 },
      baseKpiSummary: baseKpi,
      varianceBreakdown: [],
    };
  }

  let totalEnergyDelta = 0;
  let totalDemandDelta = 0;
  let totalLogisticsDelta = 0;
  let totalCarbonDelta = 0;
  let totalLdDelta = 0;

  const adjustedLanes = baseLanes.map((lane) => {
    const adjusted = { ...lane };

    const isOutaged = params.facilityOutageId && lane.origin === params.facilityOutageId;
    const isDemandTarget =
      !params.demandShiftCustomerId || lane.dest === params.demandShiftCustomerId;

    if (isOutaged) {
      adjusted.technicalStatus = "critical";
      adjusted.technicalScore = 95;
      adjusted.availableCapacity = 0;
      adjusted.utilizationPct = 1;
      adjusted.daysToZero = Math.max(0.5, (lane.daysToZero ?? 5) * 0.3);
      adjusted.ldExposureUsd = (lane.ldExposureUsd ?? 0) + estimateLaneRevenueUsd(lane) * 0.08;
      adjusted.totalLandedCostPerTon = (lane.totalLandedCostPerTon ?? 150) * 1.8;
      adjusted.profitabilityPct = -15;
      // Supply drops to zero on outage → severe shortage
      adjusted.supplyTpd = 0;
      adjusted.forecastDiscrepancyPct = -100;

      totalLdDelta += adjusted.ldExposureUsd - (lane.ldExposureUsd ?? 0);
      totalEnergyDelta -= estimateLaneRevenueUsd(lane) * 0.3;
      return adjusted;
    }

    // Energy price impact: energy is ~60% of cost base
    if (params.energyPriceShiftPct !== 0) {
      const energyCost = estimateLaneEnergyCostUsd(lane);
      const delta = energyCost * (params.energyPriceShiftPct / 100);
      totalEnergyDelta += delta;
      const revenueEst = estimateLaneRevenueUsd(lane);
      const marginShift = (delta / revenueEst) * 100;
      adjusted.profitabilityPct = (lane.profitabilityPct ?? 10) - marginShift;
      // Adjust TLC production cost component
      const prodCostShift = (lane.productionCostPerTon ?? 120) * (params.energyPriceShiftPct / 100);
      adjusted.productionCostPerTon = (lane.productionCostPerTon ?? 120) + prodCostShift;
      adjusted.totalLandedCostPerTon = (adjusted.productionCostPerTon ?? 120) + (lane.distributionCostPerTon ?? 30);
    }

    // Demand shift
    if (params.demandShiftPct !== 0 && isDemandTarget) {
      const factor = 1 + params.demandShiftPct / 100;
      const newVolume = lane.avgDailyVolume * factor;
      const volumeDelta = newVolume - lane.avgDailyVolume;

      adjusted.avgDailyVolume = Math.max(10, newVolume);

      if (lane.daysToZero != null) {
        adjusted.daysToZero = lane.daysToZero / Math.max(0.3, factor);
      }

      // Recompute forecast discrepancy: supply stays fixed, demand shifts
      const supply = lane.supplyTpd ?? lane.avgDailyVolume;
      const newDemand = (lane.demandTpd ?? lane.avgDailyVolume) * factor;
      adjusted.demandTpd = Math.max(1, newDemand);
      adjusted.supplyTpd = supply;
      adjusted.forecastDiscrepancyPct = newDemand > 0 ? ((supply - newDemand) / newDemand) * 100 : 0;

      if (params.demandShiftPct < 0) {
        const revenueImpact = Math.abs(volumeDelta) * 180 * 30;
        totalDemandDelta -= revenueImpact;
        adjusted.ldExposureUsd = Math.max(0, (lane.ldExposureUsd ?? 0) * 0.6);
      } else {
        adjusted.ldExposureUsd = (lane.ldExposureUsd ?? 0) * (1 + params.demandShiftPct / 200);
        totalDemandDelta += volumeDelta * 40 * 30;
      }
    }

    // Logistics cost shift
    if (params.logisticsCostShiftPct !== 0) {
      const logCost = estimateLaneLogisticsCostUsd(lane);
      const delta = logCost * (params.logisticsCostShiftPct / 100);
      totalLogisticsDelta += delta;
      const revenueEst = estimateLaneRevenueUsd(lane);
      adjusted.profitabilityPct = (adjusted.profitabilityPct ?? 10) - (delta / revenueEst) * 100;
      // Adjust TLC distribution cost component
      const distCostShift = (lane.distributionCostPerTon ?? 30) * (params.logisticsCostShiftPct / 100);
      adjusted.distributionCostPerTon = (lane.distributionCostPerTon ?? 30) + distCostShift;
      adjusted.totalLandedCostPerTon = (adjusted.productionCostPerTon ?? lane.productionCostPerTon ?? 120) + (adjusted.distributionCostPerTon ?? 30);
    }

    // Carbon price
    if (params.carbonPriceUsdPerTon > 0) {
      const carbonTons = lane.avgDailyVolume * 0.4 * 30;
      const delta = carbonTons * params.carbonPriceUsdPerTon;
      totalCarbonDelta += delta;
      const revenueEst = estimateLaneRevenueUsd(lane);
      adjusted.profitabilityPct = (adjusted.profitabilityPct ?? 10) - (delta / revenueEst) * 100;
    }

    // Recompute technical status from adjusted margin
    const margin = adjusted.profitabilityPct ?? 10;
    if (margin < 2) {
      adjusted.technicalStatus = "critical";
    } else if (margin < 8) {
      adjusted.technicalStatus = adjusted.technicalStatus === "critical" ? "critical" : "watch";
    }

    return adjusted;
  });

  const scenarioKpi = computeKpi(adjustedLanes);

  const varianceBreakdown: VarianceItem[] = [];
  if (totalEnergyDelta !== 0)
    varianceBreakdown.push({ label: "Energy Cost Impact", deltaUsd: -totalEnergyDelta });
  if (totalDemandDelta !== 0)
    varianceBreakdown.push({ label: "Demand Volume Impact", deltaUsd: totalDemandDelta });
  if (totalLogisticsDelta !== 0)
    varianceBreakdown.push({ label: "Logistics Cost Impact", deltaUsd: -totalLogisticsDelta });
  if (totalCarbonDelta !== 0)
    varianceBreakdown.push({ label: "Carbon Cost Impact", deltaUsd: -totalCarbonDelta });
  if (totalLdDelta !== 0)
    varianceBreakdown.push({ label: "LD Penalty Exposure", deltaUsd: -totalLdDelta });

  varianceBreakdown.sort((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd));

  const plImpact = varianceBreakdown.reduce((sum, v) => sum + v.deltaUsd, 0);

  return {
    adjustedLanes,
    kpiSummary: { ...scenarioKpi, plImpactUsd: plImpact },
    baseKpiSummary: baseKpi,
    varianceBreakdown,
  };
}

function computeKpi(lanes: Lane[]) {
  const criticalLanes = lanes.filter((l) => l.technicalStatus === "critical").length;
  const avgDaysToZero = lanes.length
    ? lanes.reduce((s, l) => s + (l.daysToZero ?? 0), 0) / lanes.length
    : 0;
  const avgForecastDiscrepancyPct = lanes.length
    ? lanes.reduce((s, l) => s + (l.forecastDiscrepancyPct ?? 0), 0) / lanes.length
    : 0;
  // True monthly landed cost in USD: $/ton * tons/day * ~30 days
  const totalLandedCost = lanes.reduce(
    (s, l) => s + ((l.totalLandedCostPerTon ?? 150) * (l.avgDailyVolume ?? 0) * 30),
    0
  );
  const avgProfitabilityPct = lanes.length
    ? lanes.reduce((s, l) => s + (l.profitabilityPct ?? 0), 0) / lanes.length
    : 0;
  return { criticalLanes, avgDaysToZero, avgForecastDiscrepancyPct, totalLandedCost, avgProfitabilityPct };
}

export function scenarioLabel(params: ScenarioParams): string {
  const parts: string[] = [];
  if (params.energyPriceShiftPct !== 0)
    parts.push(`Energy ${params.energyPriceShiftPct > 0 ? "+" : ""}${params.energyPriceShiftPct}%`);
  if (params.demandShiftPct !== 0)
    parts.push(`Demand ${params.demandShiftPct > 0 ? "+" : ""}${params.demandShiftPct}%`);
  if (params.logisticsCostShiftPct !== 0)
    parts.push(`Logistics ${params.logisticsCostShiftPct > 0 ? "+" : ""}${params.logisticsCostShiftPct}%`);
  if (params.facilityOutageId) parts.push(`${params.facilityOutageId} Outage`);
  if (params.carbonPriceUsdPerTon > 0)
    parts.push(`Carbon $${params.carbonPriceUsdPerTon}/ton`);
  return parts.length > 0 ? parts.join(" | ") : "Baseline";
}

export { DEFAULT_SCENARIO };
