export type Center = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: "facility" | "customer_site";
  region?: string;
};

export type TechnicalStatus = "critical" | "watch" | "stable";

export type Lane = {
  id: string;
  origin: string;
  dest: string;
  destName?: string;
  mode: "pipeline" | "truck";
  avgDailyVolume: number;
  onTimePct: number;
  delayMinutes: number;
  slaRiskPct: number;
  product?: "CRD" | "NGL" | "LNG";
  contractId?: string;
  sourceAssetId?: string;
  profitabilityPct?: number;
  daysToZero?: number;
  ldExposureUsd?: number;
  productionCostPerTon?: number;
  distributionCostPerTon?: number;
  totalLandedCostPerTon?: number;
  supplyTpd?: number;
  demandTpd?: number;
  forecastDiscrepancyPct?: number;
  utilizationPct?: number;
  availableCapacity?: number;
  technicalStatus?: TechnicalStatus;
  technicalScore?: number;
  activeDisruptionDays?: number;
  vibrationAlerts?: number;
  maxDisruptionStage?: number;
  upstreamDisruptionPct?: number;
  isSessionLane?: boolean;
  sessionLabel?: string;
};

export type Incident = {
  laneId: string;
  timestamp: string;
  type:
    | "facility_outage"
    | "vibration_anomaly"
    | "weather_disruption"
    | "pipeline_constraint"
    | "inventory_critical"
    | "supply_shortfall";
  ref: string;
  cause: string;
  confidence: number;
  severity?: "low" | "medium" | "high";
  impactMinutes?: number;
  impactThroughputPct?: number;
  recommendedAction?: string;
};

export type Shipment = {
  trackingId: string;
  customerId: string;
  contractId?: string;
  priority: "LOW" | "MED" | "HIGH";
  laneId: string;
  promisedETA: string;
  currentETA: string;
  product?: "CRD" | "NGL" | "LNG";
  requestedVolumeTons?: number;
  siteName?: string;
};

export type RerouteSuggestion = {
  laneId: string;
  strategy: string;
  deltaETAminutes: number;
  addedCostUSD: number;
  capacityUsedPct: number;
  notes: string;
  co2DeltaPct?: number;
  sourceType?: "spot_purchase" | "pipeline_shift" | "production_reallocation";
};

export type Customer = {
  id: string;
  name: string;
  contact: string;
  tier: string;
  industry?: string;
};

export type KpiMode = "risk" | "forecastDiscrepancy" | "totalLandedCost" | "profitability";

export type TechnicalStatusThresholds = {
  criticalMinScore: number;
  watchMinScore: number;
  criticalStageMin: number;
  watchStageMin: number;
  criticalActiveDisruptionDaysMin: number;
  watchActiveDisruptionDaysMin: number;
};

export type RiskThresholds = {
  daysToZeroCritical: number;
  daysToZeroWatch: number;
  daysToZeroSafe: number;
  ldExposureCriticalUsd: number;
  ldExposureSafeUsd: number;
  totalLandedCostHighPerTon: number;
  totalLandedCostLowPerTon: number;
  totalLandedCostMonthlyHighUsd: number;
  totalLandedCostMonthlyLowUsd: number;
  forecastExcessPct: number;
  forecastShortageCriticalPct: number;
  forecastShortageWatchPct: number;
  profitabilityCriticalPct: number;
  profitabilityWatchPct: number;
  delayMinutesCritical: number;
  slaRiskPctCritical: number;
};

export const RISK_THRESHOLDS: RiskThresholds = {
  daysToZeroCritical: 4.0,
  daysToZeroWatch: 8.0,
  daysToZeroSafe: 8.0,
  ldExposureCriticalUsd: 850_000,
  ldExposureSafeUsd: 50_000,
  totalLandedCostHighPerTon: 250,
  totalLandedCostLowPerTon: 150,
  // Monthly landed-cost bands (USD), calibrated from generated lane distribution.
  totalLandedCostMonthlyHighUsd: 500_000,
  totalLandedCostMonthlyLowUsd: 225_000,
  forecastExcessPct: 8,
  forecastShortageCriticalPct: 10,
  forecastShortageWatchPct: 3,
  profitabilityCriticalPct: 5.0,
  profitabilityWatchPct: 15.0,
  delayMinutesCritical: 89,
  slaRiskPctCritical: 0.05,
};

export const TECHNICAL_STATUS_THRESHOLDS: TechnicalStatusThresholds = {
  criticalMinScore: 88,
  watchMinScore: 48,
  criticalStageMin: 3,
  watchStageMin: 3,
  criticalActiveDisruptionDaysMin: 8,
  watchActiveDisruptionDaysMin: 8,
};

// ---------------------------------------------------------------------------
// Scenario Simulator
// ---------------------------------------------------------------------------

export type ScenarioParams = {
  energyPriceShiftPct: number;
  demandShiftPct: number;
  demandShiftCustomerId: string | null;
  logisticsCostShiftPct: number;
  facilityOutageId: string | null;
  carbonPriceUsdPerTon: number;
};

export const DEFAULT_SCENARIO: ScenarioParams = {
  energyPriceShiftPct: 0,
  demandShiftPct: 0,
  demandShiftCustomerId: null,
  logisticsCostShiftPct: 0,
  facilityOutageId: null,
  carbonPriceUsdPerTon: 0,
};

export type VarianceItem = {
  label: string;
  deltaUsd: number;
};

export type ScenarioResult = {
  adjustedLanes: Lane[];
  kpiSummary: {
    criticalLanes: number;
    avgDaysToZero: number;
    avgForecastDiscrepancyPct: number;
    totalLandedCost: number;
    avgProfitabilityPct: number;
    plImpactUsd: number;
  };
  baseKpiSummary: {
    criticalLanes: number;
    avgDaysToZero: number;
    avgForecastDiscrepancyPct: number;
    totalLandedCost: number;
    avgProfitabilityPct: number;
  };
  varianceBreakdown: VarianceItem[];
};

export type ScenarioPreset = {
  id: string;
  name: string;
  description: string;
  params: ScenarioParams;
};

// ---------------------------------------------------------------------------
// KPI Action Panel Types
// ---------------------------------------------------------------------------

export type StaffAssignment = {
  id: string;
  name: string;
  role: string;
  available: boolean;
};

export type PartsRequirement = {
  sku: string;
  name: string;
  qtyOnHand: number;
  qtyNeeded: number;
  leadTimeDays: number;
};

export type HistoricalFix = {
  workOrderId: string;
  date: string;
  assetId: string;
  summary: string;
  resolutionDays: number;
};

export type MaintenanceContext = {
  staff: StaffAssignment[];
  parts: PartsRequirement[];
  historicalFixes: HistoricalFix[];
  techDocLinks: { title: string; url: string }[];
};

export type ContractContext = {
  contractId: string;
  customerName: string;
  product: string;
  committedVolumeTpd: number;
  actualVolumeTpd: number;
  pricePerTonUsd: number;
  ldPenaltyRateUsd: number;
  supplyDemandGapTpd: number;
  guaranteeOfSupply: boolean;
};

export type GasOrderOption = {
  vendorName: string;
  laneId: string;
  product: string;
  availableCapacityTpd: number;
  pricePerTonUsd: number;
  etaHours: number;
  notes: string;
  vendorLat?: number;
  vendorLng?: number;
};

export type DemandOpportunity = {
  targetCustomerId: string;
  targetCustomerName: string;
  sourceLaneId: string;
  sourceAssetId: string;
  unmetDemandTpd: number;
  distanceKm: number;
  estimatedTlcPerTon: number;
  currentTlcPerTon: number;
  savingsPerTon: number;
  product: string;
};

export type LdExposureContext = {
  contract: ContractContext;
  gasOrderOptions: GasOrderOption[];
};

export type WaterfallNode = {
  label: string;
  value: number;
  type: "start" | "delta" | "end";
};

export type SankeyNode = {
  id: string;
  label: string;
};

export type SankeyLink = {
  source: string;
  target: string;
  value: number;
  label?: string;
};

export type MarginBreakdown = {
  waterfall: WaterfallNode[];
  sankeyNodes: SankeyNode[];
  sankeyLinks: SankeyLink[];
};

export type ForecastPoint = {
  date: string;
  demandTpd: number;
  supplyTpd: number;
};

export type CustomerAnomaly = {
  laneId: string;
  customerName: string;
  product: string;
  forecastedTpd: number;
  actualTpd: number;
  deviationPct: number;
};

export type UpsellOpportunity = {
  laneId: string;
  customerName: string;
  product: string;
  excessSupplyTpd: number;
  excessPct: number;
  suggestedUpsellTpd: number;
  pricePerTonUsd: number;
  contractTerm: string;
  startDate: string;
  estimatedRevenueUsd: number;
};

export type QuoteParams = {
  opportunityId: string;
  customerName: string;
  product: string;
  volumeTpd: number;
  pricePerTonUsd: number;
  discountPct: number;
  contractTerm: string;
  startDate: string;
  estimatedMonthlyRevenueUsd: number;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};
