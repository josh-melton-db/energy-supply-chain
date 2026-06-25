import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Filter, AlertTriangle, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Center, Customer, Incident, Lane, KpiMode, GasOrderOption } from "@/types/domain";
import { RISK_THRESHOLDS as T } from "@/types/domain";
import { computeProfitabilityBands, profitabilityBand, profitabilityLabels } from "@/lib/profitabilityBands";
import type { ProfitabilityBands } from "@/lib/profitabilityBands";
import { getEnergyCenters, getEnergyCustomers, getEnergyIncidents, getEnergyLanes, getTlcPartnerPurchaseOptions } from "@/lib/energyApi";
import { useScenario } from "@/lib/ScenarioContext";
import { useAgentChat } from "@/lib/AgentChatContext";
import { applyScenario, isScenarioActive, scenarioLabel } from "@/lib/scenarioEngine";
import { formatCurrency } from "@/lib/format";
import { getMitigationOverride, recordDemoAction, getTotalMarginUplift, getSessionLanes, setTlcPurchaseOverride, getTlcPurchaseOverride, addSessionLane, type SessionLane } from "@/lib/sessionState";
import MapView from "@/components/MapView/MapView";
import Legend from "@/components/MapView/Legend";
import KPICards from "@/components/KPICards";
import LaneDetails from "@/components/LaneDetails";
import ReroutePanel from "@/components/ReroutePanel";
import KpiActionWorkspace from "@/components/KpiActionWorkspace";


const STATUS_FILTER_CONFIG: Record<KpiMode, { title: string; excess?: string; low: string; medium: string; high: string }> = {
  risk: {
    title: "All Technical Status Levels",
    low: "Stable",
    medium: "Watch",
    high: "Critical",
  },
  forecastDiscrepancy: {
    title: "All Forecast Bands",
    excess: "Excess Supply",
    low: "Balanced",
    medium: "Moderate Shortage",
    high: "Severe Shortage",
  },
  totalLandedCost: {
    title: "All Landed Cost Bands",
    low: "< $225k/mo",
    medium: "$225k-$500k/mo",
    high: "> $500k/mo",
  },
  profitability: {
    title: "All Profitability Bands",
    low: "Top lanes",
    medium: "Middle 50%",
    high: "Lowest lanes",
  },
};

function laneStatusBand(lane: Lane, mode: KpiMode, bands?: ProfitabilityBands): "excess" | "low" | "medium" | "high" {
  if (mode === "forecastDiscrepancy") {
    const pct = lane.forecastDiscrepancyPct ?? 0;
    if (pct > T.forecastExcessPct) return "excess";
    if (pct < -T.forecastShortageCriticalPct) return "high";
    if (pct < -T.forecastShortageWatchPct) return "medium";
    return "low";
  }
  if (mode === "totalLandedCost") {
    const tlc = (lane.totalLandedCostPerTon ?? 150) * lane.avgDailyVolume * 30;
    if (tlc >= T.totalLandedCostMonthlyHighUsd) return "high";
    if (tlc >= T.totalLandedCostMonthlyLowUsd) return "medium";
    return "low";
  }
  if (mode === "profitability") {
    return profitabilityBand(lane.profitabilityPct ?? 20, bands ?? { highMax: T.profitabilityCriticalPct, mediumMax: T.profitabilityWatchPct });
  }
  if (lane.technicalStatus === "critical") return "high";
  if (lane.technicalStatus === "watch") return "medium";
  return "low";
}

export default function IncidentResponseView() {
  const [centers, setCenters] = useState<Center[]>([]);
  const [baseLanes, setBaseLanes] = useState<Lane[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  const [selectedLane, setSelectedLane] = useState<Lane | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [openMitigation, setOpenMitigation] = useState(false);
  const [rcaStartedLocal, setRcaStartedLocal] = useState(false);
  const [workOrderSubmittedLocal, setWorkOrderSubmittedLocal] = useState(false);
  const [activeKpi, setActiveKpi] = useState<KpiMode>("profitability");
  const [mitigatedLanes, setMitigatedLanes] = useState<Set<string>>(new Set());
  const { scenario, resetScenario } = useScenario();
  const navigate = useNavigate();
  const agentChat = useAgentChat();
  const [sessionLaneVersion, setSessionLaneVersion] = useState(0);
  const [sessionLaneIds, setSessionLaneIds] = useState<Set<string>>(new Set());
  const [purchasedTlcVendorKeys, setPurchasedTlcVendorKeys] = useState<Set<string>>(new Set());

  const handleMitigationComplete = useCallback((laneId: string) => {
    setMitigatedLanes((prev) => new Set(prev).add(laneId));
    recordDemoAction("supplyReplenishment");
    setMarginUplift(getTotalMarginUplift());
  }, []);

  const [marginUplift, setMarginUplift] = useState(() => getTotalMarginUplift());

  const handleRcaStarted = useCallback(() => {
    setRcaStartedLocal(true);
  }, []);

  const handleWorkOrderSubmitted = useCallback((laneOverride?: Lane) => {
    const targetLane = laneOverride ?? selectedLane;
    if (!targetLane) return;

    const destCenter = centers.find((c) => c.id === targetLane.dest);
    if (destCenter) {
      const securedTpd = Math.max(
        8,
        Math.round(Math.max(targetLane.avgDailyVolume * 0.2, ((targetLane.demandTpd ?? targetLane.avgDailyVolume) - (targetLane.supplyTpd ?? targetLane.avgDailyVolume)) * 0.7))
      );
      const sessionLane: SessionLane = {
        id: `SES-FACILITY-OUTAGE-${targetLane.origin}-${targetLane.dest}-${targetLane.product ?? "CRD"}`,
        origin: `EXT-SHUTDOWN-${targetLane.origin}`,
        originLat: destCenter.lat + 0.35,
        originLng: destCenter.lng + 0.2,
        dest: targetLane.dest,
        destLat: destCenter.lat,
        destLng: destCenter.lng,
        mode: "truck",
        product: targetLane.product ?? "CRD",
        avgDailyVolume: securedTpd,
        totalLandedCostPerTon: (targetLane.totalLandedCostPerTon ?? 150) + 18,
        forecastDiscrepancyPct: 0,
        sourceLabel: `Facility outage mitigation lane: Temporary supplier -> ${targetLane.destName ?? targetLane.dest}`,
      };
      addSessionLane(sessionLane);
      setSessionLaneVersion((v) => v + 1);
      setSessionLaneIds((prev) => new Set(prev).add(sessionLane.id));
      setSelectedLaneId(sessionLane.id);
    }

    setWorkOrderSubmittedLocal(true);
    recordDemoAction("workOrderAssigned");
    setMarginUplift(getTotalMarginUplift());
  }, [centers, selectedLane]);

  const handleOrderXTpd = useCallback(async (requestedTpd: number) => {
    const lane = selectedLane;
    if (!lane) return;
    const safeRequestedTpd = Math.max(0, Number.isFinite(requestedTpd) ? requestedTpd : 0);
    if (safeRequestedTpd <= 0) return;

    setActiveKpi("forecastDiscrepancy");
    recordDemoAction("supplyReplenishment");
    setMarginUplift(getTotalMarginUplift());
  }, [selectedLane]);

  const scenarioActive = isScenarioActive(scenario);
  const scenarioResult = useMemo(() => applyScenario(baseLanes, scenario), [baseLanes, scenario]);
  const lanes = scenarioResult.adjustedLanes;
  const bands = useMemo(() => computeProfitabilityBands(lanes), [lanes]);

  const handleSessionLaneAdded = useCallback((laneId?: string) => {
    setSessionLaneVersion((v) => v + 1);
    if (laneId) {
      setSessionLaneIds((prev) => new Set(prev).add(laneId));
      setSelectedLaneId(laneId);
    }
    setMarginUplift(getTotalMarginUplift());
  }, []);

  const handleTlcPartnerPurchase = useCallback((targetLane: Lane, option: GasOrderOption) => {
    const demand = Math.max(1, targetLane.demandTpd ?? targetLane.avgDailyVolume);
    const covered = Math.min(option.availableCapacityTpd, demand);
    const currentTlc = targetLane.totalLandedCostPerTon ?? ((targetLane.productionCostPerTon ?? 120) + (targetLane.distributionCostPerTon ?? 30));
    const adjustedTlc = ((currentTlc * Math.max(0, demand - covered)) + (option.pricePerTonUsd * covered)) / demand;

    setTlcPurchaseOverride(targetLane.id, {
      vendorName: option.vendorName,
      pricePerTonUsd: option.pricePerTonUsd,
      availableCapacityTpd: option.availableCapacityTpd,
      etaHours: option.etaHours,
      securedVolumeTpd: covered,
      originalTlcPerTon: currentTlc,
      adjustedTlcPerTon: adjustedTlc,
    });

    const destCenter = centers.find((c) => c.id === targetLane.dest);
    if (destCenter) {
      const sessionLane: SessionLane = {
        id: `SES-TLC-PARTNER-${option.vendorName.replace(/\s+/g, "-")}-${targetLane.dest}`,
        origin: `EXT-${option.vendorName.replace(/\s+/g, "-")}`,
        originLat: option.vendorLat ?? destCenter.lat + 0.4,
        originLng: option.vendorLng ?? destCenter.lng + 0.4,
        dest: targetLane.dest,
        destLat: destCenter.lat,
        destLng: destCenter.lng,
        mode: "truck",
        product: option.product,
        avgDailyVolume: covered,
        totalLandedCostPerTon: option.pricePerTonUsd,
        forecastDiscrepancyPct: targetLane.forecastDiscrepancyPct ?? 0,
        sourceLabel: `TLC partner purchase: ${option.vendorName} → ${targetLane.destName ?? targetLane.dest}`,
      };
      addSessionLane(sessionLane);
    }

    setPurchasedTlcVendorKeys((prev) => new Set(prev).add(`${targetLane.id}::${option.vendorName}`));
    recordDemoAction("partnerPurchase");
    handleSessionLaneAdded(`SES-TLC-PARTNER-${option.vendorName.replace(/\s+/g, "-")}-${targetLane.dest}`);
  }, [centers, handleSessionLaneAdded]);

  const filteredBaseLanes = useMemo(() => {
    let filtered = lanes.map((lane) => {
      const adjusted = { ...lane };
      if (mitigatedLanes.has(lane.id)) {
        adjusted.technicalStatus = "stable" as const;
        adjusted.technicalScore = 15;
        adjusted.daysToZero = Math.max(8, lane.daysToZero ?? 5);
      }
      if (marginUplift > 0) {
        adjusted.profitabilityPct = (adjusted.profitabilityPct ?? 10) + marginUplift;
      }
      const tlcOverride = getTlcPurchaseOverride(lane.id);
      if (tlcOverride) {
        adjusted.totalLandedCostPerTon = tlcOverride.adjustedTlcPerTon;
        const production = adjusted.productionCostPerTon ?? lane.productionCostPerTon ?? 120;
        adjusted.distributionCostPerTon = Math.max(0, tlcOverride.adjustedTlcPerTon - production);
      }
      return adjusted;
    });
    if (selectedCustomerId) {
      filtered = filtered.filter((lane) => lane.dest === selectedCustomerId);
    }
    if (riskFilter) {
      filtered = filtered.filter((lane) => laneStatusBand(lane, activeKpi, bands) === riskFilter);
    }
    return filtered;
  }, [lanes, selectedCustomerId, riskFilter, activeKpi, bands, mitigatedLanes, marginUplift]);

  // Merge session lanes into map display
  const sessionLanes = useMemo(() => getSessionLanes(), [sessionLaneVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const mapCenters = useMemo(() => {
    if (sessionLanes.length === 0) return centers;
    const extra: Center[] = [];
    const existing = new Set(centers.map((c) => c.id));
    sessionLanes.forEach((sl) => {
      if (!existing.has(sl.origin)) {
        extra.push({ id: sl.origin, name: sl.sourceLabel, lat: sl.originLat, lng: sl.originLng, type: "facility" });
        existing.add(sl.origin);
      }
    });
    return extra.length > 0 ? [...centers, ...extra] : centers;
  }, [centers, sessionLanes]);
  const displaySessionLanes = useMemo<Lane[]>(() => {
    if (sessionLanes.length === 0) return [];
    const centerNameById = new Map(centers.map((c) => [c.id, c.name]));
    return sessionLanes.map((sl) => ({
      id: sl.id,
      origin: sl.origin,
      dest: sl.dest,
      destName: centerNameById.get(sl.dest) ?? sl.dest,
      mode: sl.mode,
      product: sl.product as Lane["product"],
      avgDailyVolume: sl.avgDailyVolume,
      totalLandedCostPerTon: sl.totalLandedCostPerTon,
      forecastDiscrepancyPct: sl.forecastDiscrepancyPct,
      onTimePct: 1,
      delayMinutes: 0,
      slaRiskPct: 0,
      technicalStatus: "stable" as const,
      technicalScore: 10,
      profitabilityPct: 15,
      isSessionLane: true,
      sessionLabel: sl.sourceLabel,
    }));
  }, [centers, sessionLanes]);

  const mapLanes = useMemo(() => {
    if (displaySessionLanes.length === 0) return filteredBaseLanes;
    let filteredSession = displaySessionLanes;
    if (selectedCustomerId) {
      filteredSession = filteredSession.filter((lane) => lane.dest === selectedCustomerId);
    }
    if (riskFilter) {
      filteredSession = filteredSession.filter((lane) => laneStatusBand(lane, activeKpi, bands) === riskFilter);
    }
    return [...filteredBaseLanes, ...filteredSession];
  }, [activeKpi, bands, displaySessionLanes, filteredBaseLanes, riskFilter, selectedCustomerId]);

  useEffect(() => {
    Promise.all([getEnergyCenters(), getEnergyLanes(), getEnergyCustomers()]).then(
      ([centerData, laneData, customerData]) => {
        setCenters(centerData);
        setBaseLanes(laneData);
        setCustomers(customerData);
        setLoading(false);

        const restoredMitigations = new Set<string>();
        laneData.forEach((l) => {
          if (getMitigationOverride(l.id)) restoredMitigations.add(l.id);
        });
        if (restoredMitigations.size > 0) setMitigatedLanes(restoredMitigations);

        const restoredPurchased = new Set<string>();
        laneData.forEach((l) => {
          const override = getTlcPurchaseOverride(l.id);
          if (override?.vendorName) restoredPurchased.add(`${l.id}::${override.vendorName}`);
        });
        if (restoredPurchased.size > 0) setPurchasedTlcVendorKeys(restoredPurchased);
      }
    );
  }, []);

  useEffect(() => {
    setRcaStartedLocal(false);
    setWorkOrderSubmittedLocal(false);
  }, [selectedLaneId]);

  useEffect(() => {
    if (!selectedLaneId) {
      setIncidents([]);
      setSelectedLane(null);
      return;
    }
    const lane = mapLanes.find((entry) => entry.id === selectedLaneId) ?? null;
    setSelectedLane(lane);
    if (lane?.isSessionLane) {
      setIncidents([]);
      return;
    }
    getEnergyIncidents(selectedLaneId).then(setIncidents);
  }, [selectedLaneId, mapLanes]);

  // --- Sync local state into the global agent chat context ---
  useEffect(() => {
    agentChat.setSelectedLane(selectedLane);
  }, [selectedLane]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    agentChat.setActiveKpi(activeKpi);
  }, [activeKpi]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    agentChat.setRcaStarted(rcaStartedLocal);
  }, [rcaStartedLocal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    agentChat.setWorkOrderSubmitted(workOrderSubmittedLocal);
  }, [workOrderSubmittedLocal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    agentChat.setActionHandlers({
      assignWorkOrder: () => {
        handleWorkOrderSubmitted();
      },
      partnerPurchase: () => {
        if (activeKpi === "totalLandedCost" && selectedLane) {
          const options = getTlcPartnerPurchaseOptions(selectedLane);
          const chosen = options.find((o) => o.pricePerTonUsd < (selectedLane.totalLandedCostPerTon ?? 150)) ?? options[0];
          if (chosen) {
            handleTlcPartnerPurchase(selectedLane, chosen);
            return;
          }
        }
        setActiveKpi("forecastDiscrepancy");
      },
      orderXTpd: (tpd: number) => {
        void handleOrderXTpd(tpd);
      },
      analyzeRootCause: () => {
        handleRcaStarted();
      },
      selectLane: (laneId: string) => {
        setSelectedLaneId(laneId);
      },
      selectKpi: (kpi: KpiMode) => {
        setActiveKpi(kpi);
      },
    });
  }, [handleWorkOrderSubmitted, handleRcaStarted, handleOrderXTpd, activeKpi, selectedLane, handleTlcPartnerPurchase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    agentChat.setVisibleLanes(
      mapLanes.map((lane) => ({
        id: lane.id,
        destName: lane.destName,
        dest: lane.dest,
        totalLandedCostPerTon: lane.totalLandedCostPerTon,
        daysToZero: lane.daysToZero,
        profitabilityPct: lane.profitabilityPct,
        technicalStatus: lane.technicalStatus,
      }))
    );
  }, [mapLanes]); // eslint-disable-line react-hooks/exhaustive-deps

  const kpiLanes = useMemo(() => {
    if (selectedLane) return [selectedLane];
    return filteredBaseLanes;
  }, [selectedLane, filteredBaseLanes]);

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
          <div className="mt-4 text-muted-foreground">Loading network...</div>
        </div>
      </div>
    );
  }

  const navSlot = document.getElementById("nav-slot");
  const pLabels = profitabilityLabels(bands);
  const statusCfg =
    activeKpi === "profitability"
      ? { title: STATUS_FILTER_CONFIG.profitability.title, low: pLabels.low, medium: pLabels.mid, high: pLabels.high }
      : STATUS_FILTER_CONFIG[activeKpi];

  const filters = (
    <>
      <Filter className="h-4 w-4 text-white/70" />
      <select value={selectedCustomerId ?? ""} onChange={(e) => { setSelectedCustomerId(e.target.value || null); setSelectedLaneId(null); }} className="w-44 bg-white/10 border border-white/20 text-white rounded-md px-3 py-1.5 text-sm [&>option]:bg-[#1B3139] [&>option]:text-white">
        <option value="">All Customer Sites</option>
        {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
      </select>
      <select value={riskFilter} onChange={(e) => { setRiskFilter(e.target.value); setSelectedLaneId(null); }} className="bg-white/10 border border-white/20 text-white rounded-md px-3 py-1.5 text-sm [&>option]:bg-[#1B3139] [&>option]:text-white">
        <option value="">{statusCfg.title}</option>
        {statusCfg.excess && <option value="excess">🔵 {statusCfg.excess}</option>}
        <option value="low">🟢 {statusCfg.low}</option>
        <option value="medium">🟡 {statusCfg.medium}</option>
        <option value="high">🔴 {statusCfg.high}</option>
      </select>
    </>
  );

  return (
    <div className="flex flex-col bg-background" style={{ height: "calc(100vh - 57px)" }}>
      {navSlot && createPortal(filters, navSlot)}

      {/* Scenario banner */}
      {scenarioActive && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center gap-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
          <span className="font-medium text-amber-900 dark:text-amber-100">Scenario Active:</span>
          <span className="text-amber-800 dark:text-amber-200">{scenarioLabel(scenario)}</span>
          {scenarioResult.kpiSummary.plImpactUsd !== 0 && (
            <span className="text-amber-700 dark:text-amber-300 font-medium">
              P&L Impact: {formatCurrency(scenarioResult.kpiSummary.plImpactUsd)}/mo
            </span>
          )}
          <div className="flex-1" />
          <button onClick={() => navigate("/simulator")} className="text-xs text-amber-700 dark:text-amber-300 underline hover:no-underline">Edit Scenario</button>
          <button onClick={resetScenario} className="p-0.5 rounded hover:bg-amber-200 dark:hover:bg-amber-800"><X className="h-3.5 w-3.5 text-amber-700" /></button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          <MapView centers={mapCenters} lanes={mapLanes} selectedLaneId={selectedLaneId} highlightedSessionLaneIds={sessionLaneIds} activeKpi={activeKpi} profitabilityBands={bands} onLaneClick={(id) => setSelectedLaneId(id)} />
          <Legend activeKpi={activeKpi} profitabilityLabels={pLabels} />
        </div>
        <div className="w-[420px] border-l bg-card/30 backdrop-blur-sm flex flex-col overflow-hidden">
          <div className="border-b">
            <KPICards
              lanes={filteredBaseLanes}
              activeKpi={activeKpi}
              onKpiChange={setActiveKpi}
              scenarioResult={scenarioActive ? scenarioResult : undefined}
            />
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {selectedLane?.isSessionLane ? (
              <div className="space-y-4">
                <div className="bg-card border rounded-lg p-4 shadow-sm">
                  <div className="text-sm font-medium mb-1">Lane just generated, no data yet</div>
                  <div className="text-xs text-muted-foreground">{selectedLane.sessionLabel ?? "Temporary lane was created from an action. Operational history and incidents will appear after data refresh."}</div>
                </div>
                <KpiActionWorkspace activeKpi={activeKpi} selectedLane={selectedLane} incidents={incidents} lanes={activeKpi === "totalLandedCost" ? filteredBaseLanes : kpiLanes} centers={centers} onLaneSelect={setSelectedLaneId} onWorkOrderSubmitted={handleWorkOrderSubmitted} onSessionLaneAdded={handleSessionLaneAdded} rcaStarted={rcaStartedLocal} onTlcPartnerPurchase={handleTlcPartnerPurchase} purchasedTlcVendorKeys={purchasedTlcVendorKeys} />
              </div>
            ) : selectedLane && (activeKpi === "risk" || activeKpi === "totalLandedCost") ? (
              <div className="space-y-4">
                <LaneDetails lane={selectedLane} incidents={incidents} scenarioActive={scenarioActive} rcaStarted={rcaStartedLocal} />
                <KpiActionWorkspace activeKpi={activeKpi} selectedLane={selectedLane} incidents={incidents} lanes={activeKpi === "totalLandedCost" ? filteredBaseLanes : kpiLanes} centers={centers} onLaneSelect={setSelectedLaneId} onWorkOrderSubmitted={handleWorkOrderSubmitted} onSessionLaneAdded={handleSessionLaneAdded} rcaStarted={rcaStartedLocal} onTlcPartnerPurchase={handleTlcPartnerPurchase} purchasedTlcVendorKeys={purchasedTlcVendorKeys} />
              </div>
            ) : (
              <KpiActionWorkspace activeKpi={activeKpi} selectedLane={selectedLane} incidents={incidents} lanes={activeKpi === "totalLandedCost" ? filteredBaseLanes : kpiLanes} centers={centers} onLaneSelect={setSelectedLaneId} onWorkOrderSubmitted={handleWorkOrderSubmitted} onSessionLaneAdded={handleSessionLaneAdded} rcaStarted={rcaStartedLocal} onTlcPartnerPurchase={handleTlcPartnerPurchase} purchasedTlcVendorKeys={purchasedTlcVendorKeys} />
            )}
          </div>
        </div>
      </div>

      {selectedLaneId && (
        <ReroutePanel
          laneId={selectedLaneId}
          open={openMitigation}
          onOpenChange={setOpenMitigation}
          onComplete={handleMitigationComplete}
        />
      )}
    </div>
  );
}
