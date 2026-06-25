import type { Center, Incident, KpiMode, Lane } from "@/types/domain";
import CriticalLanesActionPanel from "@/components/kpi-actions/CriticalLanesActionPanel";
import TotalLandedCostActionPanel from "@/components/kpi-actions/TotalLandedCostActionPanel";
import MarginActionPanel from "@/components/kpi-actions/MarginActionPanel";
import DaysToZeroActionPanel from "@/components/kpi-actions/DaysToZeroActionPanel";
import type { GasOrderOption } from "@/types/domain";

interface Props {
  activeKpi: KpiMode;
  selectedLane: Lane | null;
  incidents: Incident[];
  lanes: Lane[];
  centers?: Center[];
  onLaneSelect?: (laneId: string) => void;
  onWorkOrderSubmitted?: (lane: Lane) => void;
  onSessionLaneAdded?: (laneId?: string) => void;
  rcaStarted?: boolean;
  onTlcPartnerPurchase?: (lane: Lane, option: GasOrderOption) => void;
  purchasedTlcVendorKeys?: Set<string>;
}

const KPI_GUIDANCE: Record<KpiMode, { title: string; description: string }> = {
  risk: {
    title: "Select a Critical Lane",
    description: "Click a lane on the map to run facility outage response, review parts inventory, and create a mitigation lane.",
  },
  totalLandedCost: {
    title: "Select a Lane for Cost Analysis",
    description: "Click a lane to see supply + distribution cost breakdown and compare landed cost across the network.",
  },
  profitability: {
    title: "Margin Analysis",
    description: "View the margin waterfall and cash flow breakdown across all lanes, or select a lane for lane-level detail.",
  },
  forecastDiscrepancy: {
    title: "Forecast Discrepancy Overview",
    description: "View supply/demand discrepancies. Select a lane with shortage to purchase spot barrels or excess to apply tanker deliveries.",
  },
};

export default function KpiActionWorkspace({ activeKpi, selectedLane, lanes, centers, onLaneSelect, onWorkOrderSubmitted, onSessionLaneAdded, rcaStarted = false, onTlcPartnerPurchase, purchasedTlcVendorKeys }: Props) {
  if (activeKpi === "profitability") {
    return <MarginActionPanel lane={selectedLane} lanes={lanes} />;
  }

  if (activeKpi === "forecastDiscrepancy") {
    return <DaysToZeroActionPanel lane={selectedLane} lanes={lanes} centers={centers} onLaneSelect={onLaneSelect} onSessionLaneAdded={onSessionLaneAdded} />;
  }

  if (!selectedLane) {
    const guidance = KPI_GUIDANCE[activeKpi];
    return (
      <div className="text-center p-6">
        <div className="text-4xl mb-3 opacity-20">
          {activeKpi === "risk" ? "🔧" : "📋"}
        </div>
        <h3 className="font-semibold mb-1">{guidance.title}</h3>
        <p className="text-sm text-muted-foreground">{guidance.description}</p>
      </div>
    );
  }

  if (activeKpi === "risk") {
    if (selectedLane.technicalStatus !== "critical") {
      return (
        <div className="text-center p-6">
          <div className="text-4xl mb-3 opacity-20">✅</div>
          <h3 className="font-semibold mb-1">No Issues on Selected Lane</h3>
          <p className="text-sm text-muted-foreground">This lane is not in critical status. Select a critical lane to run outage response actions.</p>
        </div>
      );
    }
    return <CriticalLanesActionPanel lane={selectedLane} onWorkOrderSubmitted={onWorkOrderSubmitted} rcaStarted={rcaStarted} />;
  }

  if (activeKpi === "totalLandedCost") {
    return <TotalLandedCostActionPanel lane={selectedLane} lanes={lanes} onPartnerPurchase={onTlcPartnerPurchase} purchasedVendorKeys={purchasedTlcVendorKeys} />;
  }

  return null;
}
