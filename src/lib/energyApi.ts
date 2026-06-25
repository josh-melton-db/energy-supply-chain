import type {
  Center, Lane, Incident, Shipment, RerouteSuggestion, Customer,
  MaintenanceContext, LdExposureContext, MarginBreakdown, ForecastPoint,
  CustomerAnomaly, UpsellOpportunity, WaterfallNode, ScenarioParams,
  DemandOpportunity, GasOrderOption,
} from "@/types/domain";
import { RISK_THRESHOLDS } from "@/types/domain";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8001/api";
export const TLC_PARTNER_P80_THRESHOLD = 136.75;

type HomeLaneApiRow = Lane & {
  originName?: string | null;
  destName?: string | null;
  originLat?: number | null;
  originLng?: number | null;
  destLat?: number | null;
  destLng?: number | null;
};

let homeLaneCache: HomeLaneApiRow[] | null = null;
let homeCustomerCache: Customer[] | null = null;

export function getTlcPartnerPurchaseOptions(lane: Lane | null | undefined): GasOrderOption[] {
  if (!lane) return [];
  const currentTlc = lane.totalLandedCostPerTon ?? 150;
  if (currentTlc < TLC_PARTNER_P80_THRESHOLD) return [];

  const product = lane.product ?? "CRD";
  const demandTpd = Math.max(5, lane.demandTpd ?? lane.avgDailyVolume ?? 25);

  const lowPrice = Math.max(65, currentTlc - 18);
  const nearPrice = Math.max(70, currentTlc - 5);
  const highPrice = currentTlc + 14;

  return [
    {
      vendorName: "GulfOps Emergency Logistics",
      laneId: `EXT-TLC-GEL-${lane.id}`,
      product,
      availableCapacityTpd: Math.round(demandTpd * 0.45),
      pricePerTonUsd: Number(lowPrice.toFixed(2)),
      etaHours: 10,
      notes: "Spot barrels from a Houston Ship Channel terminal with dedicated tanker dispatch.",
      vendorLat: 29.74,
      vendorLng: -95.08,
    },
    {
      vendorName: "GulfOps Midstream Supply",
      laneId: `EXT-TLC-DMS-${lane.id}`,
      product,
      availableCapacityTpd: Math.round(demandTpd * 0.30),
      pricePerTonUsd: Number(nearPrice.toFixed(2)),
      etaHours: 9,
      notes: "Regional truck and barge dispatch from Lake Charles inventory.",
      vendorLat: 30.23,
      vendorLng: -93.22,
    },
    {
      vendorName: "Third-Party Broker",
      laneId: `EXT-TLC-BR-${lane.id}`,
      product,
      availableCapacityTpd: Math.round(demandTpd * 0.40),
      pricePerTonUsd: Number(highPrice.toFixed(2)),
      etaHours: 6,
      notes: "Fast fulfillment with premium pricing.",
      vendorLat: 29.73,
      vendorLng: -93.87,
    },
  ];
}

function safeNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function pseudoCoord(id: string, offset: number): number {
  const n = id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0) + offset;
  return n;
}

async function fetchHomeLanesFromBackend(): Promise<HomeLaneApiRow[]> {
  if (homeLaneCache) return homeLaneCache;
  const response = await fetch(`${BACKEND_URL}/home/lanes`);
  if (!response.ok) throw new Error(`Failed to fetch /home/lanes: ${response.status}`);
  const rows = (await response.json()) as HomeLaneApiRow[];
  homeLaneCache = rows;
  return rows;
}

async function fetchHomeCustomersFromBackend(): Promise<Customer[]> {
  if (homeCustomerCache) return homeCustomerCache;
  const response = await fetch(`${BACKEND_URL}/home/customers`);
  if (!response.ok) throw new Error(`Failed to fetch /home/customers: ${response.status}`);
  const rows = (await response.json()) as Customer[];
  homeCustomerCache = rows;
  return rows;
}

const centers: Center[] = [
  { id: "HUB-001", name: "Houston Ship Channel Terminal 001", lat: 29.74, lng: -95.08, type: "facility", region: "Upper Texas Coast" },
  { id: "HUB-002", name: "Midland Fractionator 002", lat: 31.99, lng: -102.08, type: "facility", region: "Permian Basin" },
  { id: "HUB-003", name: "Lake Charles Storage Hub 003", lat: 30.23, lng: -93.22, type: "facility", region: "Louisiana Industrial Corridor" },
  { id: "HUB-004", name: "Baton Rouge Pipeline Hub 004", lat: 30.45, lng: -91.19, type: "facility", region: "Lower Mississippi Corridor" },
  { id: "CUST-0001", name: "GulfOps Refining Alpha - Port Arthur Site", lat: 29.88, lng: -93.94, type: "customer_site", region: "Upper Texas Coast" },
  { id: "CUST-0002", name: "GulfOps Petrochem Bravo - Corpus Christi Site", lat: 27.80, lng: -97.39, type: "customer_site", region: "South Texas Coast" },
  { id: "CUST-0003", name: "GulfOps LNG Charlie - Cameron Site", lat: 29.80, lng: -93.34, type: "customer_site", region: "Louisiana Industrial Corridor" },
  { id: "CUST-0004", name: "GulfOps Fuels Delta - Baton Rouge Site", lat: 30.45, lng: -91.15, type: "customer_site", region: "Louisiana Industrial Corridor" },
];

const lanes: Lane[] = [
  {
    id: "HUB-001-CUST-0001-CRD",
    origin: "HUB-001",
    dest: "CUST-0001",
    destName: "GulfOps Refining Alpha Port Arthur",
    mode: "pipeline",
    product: "CRD",
    contractId: "CTR-0001",
    sourceAssetId: "HUB-001",
    avgDailyVolume: 220,
    onTimePct: 0.95,
    delayMinutes: 35,
    slaRiskPct: 0.07,
    profitabilityPct: 12,
    daysToZero: 3.5,
    ldExposureUsd: 28000,
    productionCostPerTon: 118,
    distributionCostPerTon: 3,
    totalLandedCostPerTon: 121,
    supplyTpd: 242,
    demandTpd: 220,
    forecastDiscrepancyPct: 10,
    utilizationPct: 0.83,
    availableCapacity: 140,
    technicalStatus: "stable",
    technicalScore: 24,
  },
  {
    id: "HUB-002-CUST-0002-NGL",
    origin: "HUB-002",
    dest: "CUST-0002",
    destName: "GulfOps Petrochem Bravo Corpus Christi",
    mode: "truck",
    product: "NGL",
    contractId: "CTR-0002",
    sourceAssetId: "HUB-002",
    avgDailyVolume: 140,
    onTimePct: 0.79,
    delayMinutes: 115,
    slaRiskPct: 0.29,
    profitabilityPct: 3,
    daysToZero: 1.7,
    ldExposureUsd: 118000,
    productionCostPerTon: 142,
    distributionCostPerTon: 95,
    totalLandedCostPerTon: 237,
    supplyTpd: 126,
    demandTpd: 148,
    forecastDiscrepancyPct: -14.9,
    utilizationPct: 0.97,
    availableCapacity: 26,
    technicalStatus: "critical",
    technicalScore: 83,
  },
  {
    id: "HUB-004-CUST-0004-CRD",
    origin: "HUB-004",
    dest: "CUST-0004",
    destName: "GulfOps Fuels Delta Baton Rouge",
    mode: "pipeline",
    product: "CRD",
    contractId: "CTR-0003",
    sourceAssetId: "HUB-004",
    avgDailyVolume: 185,
    onTimePct: 0.87,
    delayMinutes: 74,
    slaRiskPct: 0.18,
    profitabilityPct: 8,
    daysToZero: 2.9,
    ldExposureUsd: 64000,
    productionCostPerTon: 135,
    distributionCostPerTon: 5,
    totalLandedCostPerTon: 140,
    supplyTpd: 178,
    demandTpd: 188,
    forecastDiscrepancyPct: -5.3,
    utilizationPct: 0.9,
    availableCapacity: 65,
    technicalStatus: "watch",
    technicalScore: 58,
  },
  {
    id: "HUB-003-CUST-0003-LNG",
    origin: "HUB-003",
    dest: "CUST-0003",
    destName: "GulfOps LNG Charlie Cameron",
    mode: "truck",
    product: "LNG",
    contractId: "CTR-0004",
    sourceAssetId: "HUB-003",
    avgDailyVolume: 95,
    onTimePct: 0.92,
    delayMinutes: 42,
    slaRiskPct: 0.09,
    profitabilityPct: 18,
    daysToZero: 5.2,
    ldExposureUsd: 12000,
    productionCostPerTon: 110,
    distributionCostPerTon: 68,
    totalLandedCostPerTon: 178,
    supplyTpd: 108,
    demandTpd: 96,
    forecastDiscrepancyPct: 12.5,
    utilizationPct: 0.7,
    availableCapacity: 110,
    technicalStatus: "stable",
    technicalScore: 31,
  },
];

const customers: Customer[] = [
  { id: "CUST-0001", name: "GulfOps Refining Alpha Port Arthur", contact: "ops+0001@example.com", tier: "Strategic", industry: "Refining" },
  { id: "CUST-0002", name: "GulfOps Petrochem Bravo Corpus Christi", contact: "ops+0002@example.com", tier: "Enterprise", industry: "Petrochemicals" },
  { id: "CUST-0003", name: "GulfOps LNG Charlie Cameron", contact: "ops+0003@example.com", tier: "Strategic", industry: "LNG Export" },
  { id: "CUST-0004", name: "GulfOps Fuels Delta Baton Rouge", contact: "ops+0004@example.com", tier: "Enterprise", industry: "Refined Products" },
];

function customerNameById(id: string): string {
  return customers.find((c) => c.id === id)?.name ?? id;
}

const supplyTickets: Shipment[] = [
  { trackingId: "SUP-90021", customerId: "CUST-0002", contractId: "CTR-0002", laneId: "HUB-002-CUST-0002-NGL", priority: "HIGH", promisedETA: "2026-03-03T02:00:00Z", currentETA: "2026-03-03T05:45:00Z", product: "NGL", requestedVolumeTons: 28, siteName: "GulfOps Petrochem Bravo Corpus Christi" },
  { trackingId: "SUP-90022", customerId: "CUST-0002", contractId: "CTR-0002", laneId: "HUB-002-CUST-0002-NGL", priority: "HIGH", promisedETA: "2026-03-03T09:00:00Z", currentETA: "2026-03-03T12:40:00Z", product: "NGL", requestedVolumeTons: 21, siteName: "GulfOps Petrochem Bravo Corpus Christi" },
  { trackingId: "SUP-90031", customerId: "CUST-0004", contractId: "CTR-0003", laneId: "HUB-004-CUST-0004-CRD", priority: "MED", promisedETA: "2026-03-03T06:00:00Z", currentETA: "2026-03-03T07:20:00Z", product: "CRD", requestedVolumeTons: 18, siteName: "GulfOps Fuels Delta Baton Rouge" },
  { trackingId: "SUP-90045", customerId: "CUST-0001", contractId: "CTR-0001", laneId: "HUB-001-CUST-0001-CRD", priority: "LOW", promisedETA: "2026-03-03T10:00:00Z", currentETA: "2026-03-03T10:25:00Z", product: "CRD", requestedVolumeTons: 16, siteName: "GulfOps Refining Alpha Port Arthur" },
];

function laneRiskBand(lane: Lane): "low" | "medium" | "high" {
  if (lane.technicalStatus === "critical") return "high";
  if (lane.technicalStatus === "watch") return "medium";
  if (lane.technicalStatus === "stable") return "low";
  const profit = lane.profitabilityPct ?? 20;
  if (
    (lane.daysToZero ?? 999) <= RISK_THRESHOLDS.daysToZeroCritical ||
    (lane.ldExposureUsd ?? 0) >= RISK_THRESHOLDS.ldExposureCriticalUsd ||
    profit < RISK_THRESHOLDS.profitabilityCriticalPct
  ) {
    return "high";
  }
  if (
    (lane.daysToZero ?? 999) <= RISK_THRESHOLDS.daysToZeroWatch ||
    lane.delayMinutes >= RISK_THRESHOLDS.delayMinutesCritical ||
    lane.slaRiskPct >= RISK_THRESHOLDS.slaRiskPctCritical ||
    profit < RISK_THRESHOLDS.profitabilityWatchPct
  ) {
    return "medium";
  }
  return "low";
}

function incidentsForLane(lane: Lane): Incident[] {
  const output: Incident[] = [];

  // Weather / inventory disruptions — resolved via purchase stopgaps + supply replenishment
  if ((lane.delayMinutes > 90 || lane.slaRiskPct > 0.25) && lane.mode === "truck") {
    output.push({
      laneId: lane.id,
      timestamp: "2026-03-02T11:15:00Z",
      type: "weather_disruption",
      ref: `WX-${lane.contractId ?? lane.id}`,
      cause: "Gulf thunderstorm cell and terminal gate congestion reduced tanker turnaround at the loading rack. Refinery inventory is declining faster than scheduled replenishment.",
      impactMinutes: Math.max(45, lane.delayMinutes - 20),
      confidence: 0.9,
      severity: "high",
      recommendedAction: "Initiate spot purchase from nearest available Gulf Coast supplier and dispatch emergency tanker transfer via replenishment workflow.",
    });
  }

  if ((lane.daysToZero ?? 999) <= RISK_THRESHOLDS.daysToZeroCritical) {
    output.push({
      laneId: lane.id,
      timestamp: "2026-03-02T08:25:00Z",
      type: "inventory_critical",
      ref: `INV-${lane.contractId ?? lane.id}`,
      cause: `Customer feedstock inventory projected to reach zero in ${lane.daysToZero?.toFixed(1)} days due to sustained above-forecast refinery runs. Current draw rate exceeds scheduled delivery cadence.`,
      confidence: 0.94,
      severity: "high",
      recommendedAction: "Execute emergency spot purchase and coordinate pull-forward tanker or pipeline delivery to extend coverage.",
    });
  }

  // Mechanical / equipment issues — resolved via work orders + root cause analysis
  if (lane.id.includes("HUB-002") || lane.id.includes("HUB-004")) {
    output.push({
      laneId: lane.id,
      timestamp: "2026-03-02T07:10:00Z",
      type: "vibration_anomaly",
      ref: `VIB-${lane.sourceAssetId ?? lane.id}`,
      cause: "Main transfer pump vibration exceeded maintenance threshold (0.42 in/s vs 0.35 in/s limit). Bearing wear pattern is consistent with cavitation during high-throughput cycles.",
      impactThroughputPct: 12,
      confidence: 0.82,
      severity: "medium",
      recommendedAction: "Create maintenance work order for pump bearing inspection and seal flush validation. Assign rotating equipment specialist for root cause analysis.",
    });
  }

  if (lane.mode === "pipeline" && lane.id.includes("HUB-001")) {
    output.push({
      laneId: lane.id,
      timestamp: "2026-03-02T05:45:00Z",
      type: "supply_shortfall",
      ref: `PL-TECH-${lane.sourceAssetId ?? lane.id}`,
      cause: "Pipeline flow meter detected 14% throughput degradation. Root cause analysis indicates fouling buildup in exchanger HX-201 reducing preheat efficiency. Correlated with elevated inlet temperature readings over the past 72 hours.",
      impactThroughputPct: 14,
      confidence: 0.88,
      severity: "medium",
      recommendedAction: "Issue priority work order for exchanger cleaning and inspection. Assign technician for root cause analysis per SOP-HX-201. Review parts inventory for gasket replacement kit GK-HX-201.",
    });
  }

  if ((lane.profitabilityPct ?? 20) < 5 && lane.technicalStatus === "critical") {
    output.push({
      laneId: lane.id,
      timestamp: "2026-03-02T09:40:00Z",
      type: "supply_shortfall",
      ref: `MNT-${lane.contractId ?? lane.id}`,
      cause: `Throughput degraded to ${Math.round((1 - 0.18) * 100)}% of rated capacity due to valve actuator malfunction on a transfer manifold. Lane margin at ${(lane.profitabilityPct ?? 0).toFixed(1)}%.`,
      impactThroughputPct: 18,
      confidence: 0.87,
      severity: laneRiskBand(lane) === "high" ? "high" : "medium",
      recommendedAction: "Issue priority work order for valve actuator replacement. Review root cause analysis from similar transfer manifold incident WO-2024-1102.",
    });
  }

  return output;
}

export async function getEnergyCenters(): Promise<Center[]> {
  await sleep(80);
  try {
    const laneRows = await fetchHomeLanesFromBackend();
    const byId = new Map<string, Center>();
    laneRows.forEach((lane) => {
      if (!byId.has(lane.origin)) {
        byId.set(lane.origin, {
          id: lane.origin,
          name: lane.originName ?? lane.origin,
          lat: safeNumber(lane.originLat, 25 + (pseudoCoord(lane.origin, 3) % 2300) / 100),
          lng: safeNumber(lane.originLng, -123 + (pseudoCoord(lane.origin, 7) % 5600) / 100),
          type: "facility",
        });
      }
      if (!byId.has(lane.dest)) {
        byId.set(lane.dest, {
          id: lane.dest,
          name: lane.destName ?? lane.dest,
          lat: safeNumber(lane.destLat, 25 + (pseudoCoord(lane.dest, 11) % 2300) / 100),
          lng: safeNumber(lane.destLng, -123 + (pseudoCoord(lane.dest, 13) % 5600) / 100),
          type: "customer_site",
        });
      }
    });
    const output = [...byId.values()];
    if (output.length > 0) return output;
  } catch {
    // fallback to local mock below
  }
  return centers;
}

export async function getEnergyLanes(): Promise<Lane[]> {
  await sleep(100);
  try {
    const rows = await fetchHomeLanesFromBackend();
    if (rows.length > 0) return rows;
  } catch {
    // fallback to local mock below
  }
  return lanes;
}

export async function getEnergyCustomers(): Promise<Customer[]> {
  await sleep(80);
  try {
    const rows = await fetchHomeCustomersFromBackend();
    if (rows.length > 0) return rows;
  } catch {
    // fallback to local mock below
  }
  return customers;
}
export async function getEnergySupplyTickets(laneId?: string): Promise<Shipment[]> {
  await sleep(100);
  try {
    const url = laneId ? `${BACKEND_URL}/home/supply-tickets?lane_id=${laneId}` : `${BACKEND_URL}/home/supply-tickets`;
    const res = await fetch(url);
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) return rows;
    }
  } catch { /* fall back */ }
  return laneId ? supplyTickets.filter((t) => t.laneId === laneId) : supplyTickets;
}
export async function getEnergyIncidents(laneId?: string): Promise<Incident[]> {
  await sleep(100);
  try {
    const url = laneId ? `${BACKEND_URL}/home/incidents?lane_id=${laneId}` : `${BACKEND_URL}/home/incidents`;
    const res = await fetch(url);
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) return rows;
    }
  } catch { /* fall back */ }
  const allLanes = await getEnergyLanes();
  const all = allLanes.flatMap((lane) => incidentsForLane(lane));
  return laneId ? all.filter((incident) => incident.laneId === laneId) : all;
}

export async function getRootCauseSummary(laneId: string, incidents: Incident[]): Promise<string> {
  await sleep(80);
  try {
    const res = await fetch(`${BACKEND_URL}/home/rca-summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ laneId, incidents }),
    });
    if (res.ok) {
      const data = await res.json();
      if (typeof data.summary === "string" && data.summary.trim().length > 0) {
        return data.summary.trim();
      }
    }
  } catch {
    // fall back below
  }
  const high = incidents.filter((incident) => incident.severity === "high").length;
  return `Root cause summary:
- High severity events: ${high}
- Primary driver: ${incidents[0]?.cause ?? "Unknown"}

Recommended playbook:
1. Protect critical customer tanks below 48-hour coverage.
2. Secure spot barrels and dispatch tanker transfers.
3. Shift pipeline nominations and defer lower-priority demand.`;
}
export async function getEnergyUrgentSupplyTickets(laneId: string): Promise<Shipment[]> {
  await sleep(100);
  const matching = supplyTickets.filter((ticket) => ticket.laneId === laneId && ticket.priority === "HIGH");
  if (matching.length > 0) return matching;

  const allLanes = await getEnergyLanes();
  const lane = allLanes.find((l) => l.id === laneId);
  if (!lane) return [];

  const shortfall = Math.max(12, Math.round(lane.avgDailyVolume * 0.15));
  const siteName = lane.destName ?? customerNameById(lane.dest);
  return [
    { trackingId: `SUP-${laneId.slice(-4)}-A`, customerId: lane.dest, contractId: lane.contractId, laneId, priority: "HIGH", promisedETA: "2026-03-03T04:00:00Z", currentETA: "2026-03-03T08:30:00Z", product: lane.product, requestedVolumeTons: Math.round(shortfall * 0.6), siteName },
    { trackingId: `SUP-${laneId.slice(-4)}-B`, customerId: lane.dest, contractId: lane.contractId, laneId, priority: "HIGH", promisedETA: "2026-03-03T10:00:00Z", currentETA: "2026-03-03T14:15:00Z", product: lane.product, requestedVolumeTons: Math.round(shortfall * 0.4), siteName },
  ];
}
export async function getEnergyMitigationOptions(laneId: string): Promise<RerouteSuggestion[]> {
  await sleep(120);
  const allLanes = await getEnergyLanes();
  const lane = allLanes.find((entry) => entry.id === laneId);
  if (!lane) return [];
  const shortfall = Math.max(8, Math.round(lane.avgDailyVolume * 0.15));
  return [
    {
      laneId,
      strategy: "Spot Purchase + Dedicated Truck Transfers",
      deltaETAminutes: 85,
      addedCostUSD: 68000,
      capacityUsedPct: 58,
      notes: `Buy ${shortfall} TPD of ${lane.product ?? "CRD"} and dispatch dedicated tanker loads from an external supplier.`,
      sourceType: "spot_purchase",
      co2DeltaPct: 6.8,
    },
    {
      laneId,
      strategy: "Reallocate Supply from Nearby Terminal",
      deltaETAminutes: 35,
      addedCostUSD: 42000,
      capacityUsedPct: 81,
      notes: "Shift supply allocation from a neighboring terminal and rebalance lower-priority contracts.",
      sourceType: "production_reallocation",
      co2DeltaPct: 2.1,
    },
    {
      laneId,
      strategy: "Pipeline Nomination Shift + Demand Deferral",
      deltaETAminutes: 20,
      addedCostUSD: 26000,
      capacityUsedPct: 74,
      notes: "Increase pipeline nomination for this customer and defer non-critical merchant deliveries by one cycle.",
      sourceType: "pipeline_shift",
      co2DeltaPct: -1.5,
    },
  ];
}

// ---------------------------------------------------------------------------
// KPI Action Mock Data
// ---------------------------------------------------------------------------

export async function getMaintenanceContext(laneId: string): Promise<MaintenanceContext> {
  await sleep(80);
  try {
    const res = await fetch(`${BACKEND_URL}/home/lanes/${laneId}/maintenance`);
    if (res.ok) {
      const data = await res.json();
      if (data.staff?.length > 0) return data;
    }
  } catch { /* fall back */ }
  const allLanes = await getEnergyLanes();
  const lane = allLanes.find((l) => l.id === laneId);
  const asset = lane?.sourceAssetId ?? "HUB-014";
  return {
    staff: [
      { id: "TECH-201", name: "Marcus Rivera", role: "Rotating Equipment Specialist", available: true },
      { id: "TECH-204", name: "Sarah Chen", role: "Instrument Technician", available: true },
      { id: "TECH-207", name: "James Okafor", role: "Pipeline Technician", available: false },
      { id: "TECH-212", name: "Linda Park", role: "Reliability Engineer", available: true },
    ],
    parts: [
      { sku: "PMP-SEAL-440", name: "Transfer Pump Seal Kit", qtyOnHand: 3, qtyNeeded: 1, leadTimeDays: 0 },
      { sku: "VIB-SENS-220", name: "Vibration Sensor Module", qtyOnHand: 6, qtyNeeded: 2, leadTimeDays: 0 },
      { sku: "VLV-ACT-880", name: "Valve Actuator Assembly", qtyOnHand: 0, qtyNeeded: 1, leadTimeDays: 3 },
      { sku: "BRG-MAIN-110", name: "Main Bearing Set", qtyOnHand: 1, qtyNeeded: 1, leadTimeDays: 0 },
    ],
    historicalFixes: [
      { workOrderId: "WO-2025-0847", date: "2025-11-14", assetId: asset, summary: "Replaced transfer pump bearings after vibration threshold breach. Root cause: cavitation during extended high-rate run cycle.", resolutionDays: 3 },
      { workOrderId: "WO-2025-0623", date: "2025-08-22", assetId: asset, summary: "Recalibrated vibration sensors and replaced pump seal kit. Throughput restored to 98% within 18 hours.", resolutionDays: 1 },
      { workOrderId: "WO-2024-1102", date: "2024-12-03", assetId: asset, summary: "Emergency valve actuator replacement during Gulf storm surge watch. Coordinated with logistics to maintain minimum refinery supply.", resolutionDays: 4 },
    ],
    techDocLinks: [
      { title: `${asset} Transfer Pump Maintenance Manual`, url: "#" },
      { title: "Vibration Analysis Threshold Guide v3.2", url: "#" },
      { title: "Emergency Shutdown Procedure - Terminal Operations", url: "#" },
    ],
  };
}

export async function getLdExposureContext(laneId: string): Promise<LdExposureContext> {
  await sleep(80);
  try {
    const [contractRes, vendorsRes] = await Promise.all([
      fetch(`${BACKEND_URL}/home/lanes/${laneId}/contract`),
      fetch(`${BACKEND_URL}/home/lanes/${laneId}/vendors`),
    ]);
    if (contractRes.ok) {
      const contractData = await contractRes.json();
      const vendorsData = vendorsRes.ok ? await vendorsRes.json() : [];
      if (contractData.contract) {
        return {
          contract: contractData.contract,
          gasOrderOptions: Array.isArray(vendorsData) ? vendorsData : [],
        };
      }
    }
  } catch { /* fall back */ }
  const allLanes = await getEnergyLanes();
  const lane = allLanes.find((l) => l.id === laneId);
  if (!lane) {
    return {
      contract: { contractId: "", customerName: "", product: "", committedVolumeTpd: 0, actualVolumeTpd: 0, pricePerTonUsd: 0, ldPenaltyRateUsd: 0, supplyDemandGapTpd: 0, guaranteeOfSupply: false },
      gasOrderOptions: [],
    };
  }
  const customerMap: Record<string, string> = { "CUST-0001": "GulfOps Refining Alpha Port Arthur", "CUST-0002": "GulfOps Petrochem Bravo Corpus Christi", "CUST-0003": "GulfOps LNG Charlie Cameron", "CUST-0004": "GulfOps Fuels Delta Baton Rouge" };
  const ldUsd = lane.ldExposureUsd ?? 0;
  const penaltyRate = 150;
  const gap = ldUsd > 0 ? Math.round(Math.max(ldUsd / (penaltyRate * 12), lane.avgDailyVolume * 0.25)) : 0;
  const actualVolume = lane.avgDailyVolume;
  const committed = actualVolume + gap;
  return {
    contract: {
      contractId: lane.contractId ?? laneId,
      customerName: customerMap[lane.dest] ?? lane.dest,
      product: lane.product ?? "CRD",
      committedVolumeTpd: committed,
      actualVolumeTpd: actualVolume,
      pricePerTonUsd: 195,
      ldPenaltyRateUsd: penaltyRate,
      supplyDemandGapTpd: gap,
      guaranteeOfSupply: ldUsd > 0,
    },
    gasOrderOptions: [
      { vendorName: "GulfOps Emergency Logistics", laneId: "EXT-GEL-001", product: lane.product ?? "CRD", availableCapacityTpd: 45, pricePerTonUsd: 210, etaHours: 10, notes: "Spot delivery via dedicated tanker from Houston Ship Channel inventory.", vendorLat: 29.74, vendorLng: -95.08 },
      { vendorName: "GulfOps Midstream Supply", laneId: "EXT-DMS-003", product: lane.product ?? "CRD", availableCapacityTpd: 30, pricePerTonUsd: 195, etaHours: 9, notes: "Available from Lake Charles terminal. Requires 4-hour advance notice.", vendorLat: 30.23, vendorLng: -93.22 },
      { vendorName: "Internal Reallocation", laneId: "HUB-003-REALLOC", product: lane.product ?? "CRD", availableCapacityTpd: Math.round((lanes.find((l) => l.id.includes("HUB-003"))?.availableCapacity ?? 50) * 0.4), pricePerTonUsd: 165, etaHours: 6, notes: "Redirect excess capacity from Lake Charles storage (lower-priority merchant contracts).", vendorLat: 30.23, vendorLng: -93.22 },
    ],
  };
}

export async function getMarginBreakdown(laneId?: string, _scenario?: ScenarioParams, providedLanes?: Lane[]): Promise<MarginBreakdown> {
  await sleep(80);
  if (!providedLanes) {
    try {
      const url = laneId ? `${BACKEND_URL}/home/margin?lane_id=${laneId}` : `${BACKEND_URL}/home/margin`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.waterfall?.length > 0) return data;
      }
    } catch { /* fall back */ }
  }
  const allLanes = providedLanes ?? await getEnergyLanes();
  const targetLanes = laneId ? allLanes.filter((l) => l.id === laneId) : allLanes;

  const pricePerTon = 195;
  const totalRevenue = targetLanes.reduce((s, l) => s + l.avgDailyVolume * pricePerTon * 30, 0);

  const avgMarginPct = targetLanes.length
    ? targetLanes.reduce((s, l) => s + (l.profitabilityPct ?? 0), 0) / targetLanes.length
    : 10;

  // Fixed cost decomposition: allocate total costs into buckets independently
  const totalCosts = totalRevenue * (1 - avgMarginPct / 100);
  const energyCost = Math.round(totalCosts * 0.45);
  const logisticsCost = Math.round(totalCosts * 0.22);
  const ldPenalties = Math.round(targetLanes.reduce((s, l) => s + (l.ldExposureUsd ?? 0), 0) * 0.1);
  const opsOverhead = Math.round(totalCosts - energyCost - logisticsCost - ldPenalties);
  const netMargin = totalRevenue - energyCost - logisticsCost - ldPenalties - opsOverhead;

  const waterfall: WaterfallNode[] = [
    { label: "Contract Revenue", value: totalRevenue, type: "start" },
    { label: "Energy Cost", value: -energyCost, type: "delta" },
    { label: "Logistics Cost", value: -logisticsCost, type: "delta" },
    ...(ldPenalties > 0 ? [{ label: "LD Penalties", value: -ldPenalties, type: "delta" as const }] : []),
    { label: "Ops Overhead", value: -opsOverhead, type: "delta" },
    { label: "Net Margin", value: netMargin, type: "end" },
  ];

  const customerNames: Record<string, string> = { "CUST-0001": "GulfOps Alpha", "CUST-0002": "GulfOps Bravo", "CUST-0003": "GulfOps Charlie", "CUST-0004": "GulfOps Delta" };

  const laneRevenues = targetLanes.map((l) => l.avgDailyVolume * pricePerTon * 30);

  return {
    waterfall,
    sankeyNodes: [
      ...targetLanes.map((l) => ({ id: `rev-${l.id}`, label: customerNames[l.dest] ?? l.dest })),
      { id: "total-revenue", label: "Total Revenue" },
      { id: "energy", label: "Energy" },
      { id: "logistics", label: "Logistics" },
      ...(ldPenalties > 0 ? [{ id: "ld-penalties", label: "LD Penalties" }] : []),
      { id: "ops", label: "Operations" },
      { id: "margin", label: "Net Margin" },
    ],
    sankeyLinks: [
      ...targetLanes.map((l, i) => ({ source: `rev-${l.id}`, target: "total-revenue", value: laneRevenues[i] })),
      { source: "total-revenue", target: "energy", value: energyCost },
      { source: "total-revenue", target: "logistics", value: logisticsCost },
      ...(ldPenalties > 0 ? [{ source: "total-revenue", target: "ld-penalties", value: ldPenalties }] : []),
      { source: "total-revenue", target: "ops", value: opsOverhead },
      { source: "total-revenue", target: "margin", value: Math.max(0, netMargin) },
    ],
  };
}

export async function getForecastContext(laneId: string): Promise<ForecastPoint[]> {
  await sleep(80);
  try {
    const res = await fetch(`${BACKEND_URL}/home/lanes/${laneId}/forecast`);
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) return rows;
    }
  } catch { /* fall back */ }
  const allLanes = await getEnergyLanes();
  const lane = allLanes.find((l) => l.id === laneId);
  if (!lane) return [];
  const baseDemand = lane.avgDailyVolume;
  const capacityRatio = Math.min((lane.availableCapacity ?? 50) / Math.max(lane.avgDailyVolume, 1), 1);
  const baseSupply = baseDemand * (1 + capacityRatio * 0.15);
  const points: ForecastPoint[] = [];
  for (let d = 0; d < 14; d++) {
    const date = new Date(2026, 2, 3 + d);
    const demandNoise = 1 + (Math.sin(d * 0.8) * 0.08) + (d > 7 ? 0.05 : 0);
    const supplyDecay = d > 5 ? 1 - (d - 5) * 0.03 : 1;
    points.push({
      date: date.toISOString().slice(0, 10),
      demandTpd: Math.round(baseDemand * demandNoise),
      supplyTpd: Math.round(baseSupply * supplyDecay * (0.95 + Math.sin(d * 0.5) * 0.03)),
    });
  }
  return points;
}

export async function getCustomerAnomalies(providedLanes?: Lane[]): Promise<CustomerAnomaly[]> {
  await sleep(80);
  if (!providedLanes) {
    try {
      const res = await fetch(`${BACKEND_URL}/home/anomalies`);
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0) return rows;
      }
    } catch { /* fall back */ }
  }
  const allLanes = providedLanes ?? await getEnergyLanes();

  function seededDeviation(laneId: string, daysToZero: number): number {
    const hash = laneId.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const base = ((hash % 17) - 8) * 0.7;
    const urgencyBias = daysToZero < 4 ? -4.5 : daysToZero < 6 ? -1.8 : 1.2;
    return Math.round((base + urgencyBias) * 10) / 10;
  }

  return allLanes.map((lane) => {
    const dtz = lane.daysToZero ?? 8;
    const deviationPct = seededDeviation(lane.id, dtz);
    const forecasted = Math.round(lane.avgDailyVolume * 1.05);
    const actual = Math.round(forecasted * (1 + deviationPct / 100));
    return {
      laneId: lane.id,
      customerName: lane.destName ?? customerNameById(lane.dest),
      product: lane.product ?? "CRD",
      forecastedTpd: forecasted,
      actualTpd: actual,
      deviationPct,
    };
  }).sort((a, b) => Math.abs(b.deviationPct) - Math.abs(a.deviationPct));
}

export async function getUpsellOpportunities(_forecast: ForecastPoint[], lanes: Lane[]): Promise<UpsellOpportunity[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/home/upsell-opportunities`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch { /* fall back to mock */ }

  await sleep(60);
  const EXCESS_THRESHOLD_PCT = 5;
  const contractTerms = ["6 months", "12 months", "3 months"];
  const startDates = ["2026-04-01", "2026-05-01", "2026-04-15"];

  return lanes
    .map((lane) => {
      const laneHash = lane.id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      const laneSupplyFactor = 1 + ((laneHash % 20) - 5) / 100;
      const laneAvgSupply = lane.avgDailyVolume * laneSupplyFactor * 1.08;
      const laneAvgDemand = lane.avgDailyVolume;
      const excessTpd = Math.round(laneAvgSupply - laneAvgDemand);
      const excessPct = laneAvgDemand > 0 ? ((laneAvgSupply - laneAvgDemand) / laneAvgDemand) * 100 : 0;

      if (excessPct < EXCESS_THRESHOLD_PCT) return null;

      const upsellVolume = Math.round(excessTpd * 0.7);
      const basePrice = 195;
      const discountPctOptions = [6, 8, 10, 12];
      const discountPct = discountPctOptions[laneHash % discountPctOptions.length];
      const discountedPrice = Math.round(basePrice * (1 - discountPct / 100));

      return {
        laneId: lane.id,
        customerName: lane.destName ?? customerNameById(lane.dest),
        product: lane.product ?? "CRD",
        excessSupplyTpd: excessTpd,
        excessPct: Math.round(excessPct * 10) / 10,
        suggestedUpsellTpd: upsellVolume,
        pricePerTonUsd: discountedPrice,
        contractTerm: contractTerms[laneHash % contractTerms.length],
        startDate: startDates[laneHash % startDates.length],
        estimatedRevenueUsd: upsellVolume * discountedPrice * 30,
      } as UpsellOpportunity;
    })
    .filter((o): o is UpsellOpportunity => o !== null)
    .sort((a, b) => b.excessSupplyTpd - a.excessSupplyTpd);
}

export async function getDemandOpportunities(sourceLaneId: string, allLanes: Lane[], allCenters: Center[]): Promise<DemandOpportunity[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/home/lanes/${sourceLaneId}/demand-opportunities`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch { /* fall back to mock */ }

  const sourceLane = allLanes.find((l) => l.id === sourceLaneId);
  if (!sourceLane) return [];

  const sourceCenter = allCenters.find((c) => c.id === sourceLane.origin);
  if (!sourceCenter) return [];

  // Find lanes with negative discrepancy (unmet demand)
  const shortageLanes = allLanes.filter(
    (l) => l.id !== sourceLaneId && (l.forecastDiscrepancyPct ?? 0) < -3
  );

  return shortageLanes.map((targetLane) => {
    const targetCenter = allCenters.find((c) => c.id === targetLane.dest);
    if (!targetCenter) return null;

    // Approximate distance in km using haversine-like rough calc
    const dlat = (targetCenter.lat - sourceCenter.lat) * 111;
    const dlng = (targetCenter.lng - sourceCenter.lng) * 111 * Math.cos((sourceCenter.lat * Math.PI) / 180);
    const distanceKm = Math.round(Math.sqrt(dlat * dlat + dlng * dlng));

    if (distanceKm > 800) return null; // too far for bulk trip

    const unmetDemand = Math.round(Math.abs(((targetLane.forecastDiscrepancyPct ?? 0) / 100) * (targetLane.demandTpd ?? targetLane.avgDailyVolume)));
    const estimatedDistCost = Math.round(distanceKm * 0.12); // ~$0.12/ton/km trucking
    const estimatedTlc = (sourceLane.productionCostPerTon ?? 120) + estimatedDistCost;
    const currentTlc = targetLane.totalLandedCostPerTon ?? 200;

    return {
      targetCustomerId: targetLane.dest,
      targetCustomerName: targetLane.destName ?? targetLane.dest,
      sourceLaneId: sourceLaneId,
      sourceAssetId: sourceLane.origin,
      unmetDemandTpd: unmetDemand,
      distanceKm,
      estimatedTlcPerTon: estimatedTlc,
      currentTlcPerTon: currentTlc,
      savingsPerTon: Math.max(0, currentTlc - estimatedTlc),
      product: sourceLane.product ?? "CRD",
    } as DemandOpportunity;
  })
  .filter((o): o is DemandOpportunity => o !== null)
  .sort((a, b) => b.savingsPerTon - a.savingsPerTon);
}
