import { AlertCircle } from "lucide-react";
import type { Incident, Lane } from "@/types/domain";
import { formatPercent } from "@/lib/format";
import IncidentTimeline from "./IncidentTimeline";
import RootCauseAnalysis from "./RootCauseAnalysis";

export default function LaneDetails({ lane, incidents, scenarioActive, rcaStarted = false }: { lane: Lane; incidents: Incident[]; scenarioActive?: boolean; rcaStarted?: boolean }) {
  return (
    <div className="space-y-4">
      <div className="bg-card border rounded-lg p-4 shadow-sm">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-semibold">{lane.id}</h3>
            <div className="text-sm text-muted-foreground">{lane.mode === "truck" ? "Bulk Trip" : "Pipeline"} • {lane.origin} → {lane.destName ?? lane.dest}</div>
          </div>
          <div className="flex items-center gap-2">
            {scenarioActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium">Scenario</span>}
            {lane.slaRiskPct > 0.1 && <div className="flex items-center gap-1 text-orange-500 text-sm"><AlertCircle className="h-4 w-4" />At Risk</div>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><div className="text-xs text-muted-foreground">Contract Volume (TPD)</div><div className="text-lg font-medium">{lane.avgDailyVolume.toLocaleString()}</div></div>
          <div><div className="text-xs text-muted-foreground">Supply Reliability</div><div className="text-lg font-medium">{formatPercent(lane.onTimePct, 1)}</div></div>
          <div><div className="text-xs text-muted-foreground">SLA Risk</div><div className="text-lg font-medium text-red-500">{formatPercent(lane.slaRiskPct, 1)}</div></div>
          <div><div className="text-xs text-muted-foreground">Forecast Discrepancy</div><div className={`text-lg font-medium ${(lane.forecastDiscrepancyPct ?? 0) < -3 ? "text-red-500" : (lane.forecastDiscrepancyPct ?? 0) > 8 ? "text-blue-500" : "text-green-600"}`}>{(lane.forecastDiscrepancyPct ?? 0) > 0 ? "+" : ""}{(lane.forecastDiscrepancyPct ?? 0).toFixed(1)}%</div></div>
          <div><div className="text-xs text-muted-foreground">Landed Cost</div><div className="text-lg font-medium">${(lane.totalLandedCostPerTon ?? 0).toFixed(0)}/ton</div></div>
          <div><div className="text-xs text-muted-foreground">Margin</div><div className={`text-lg font-medium ${(lane.profitabilityPct ?? 0) >= 15 ? "text-green-600" : (lane.profitabilityPct ?? 0) >= 5 ? "text-yellow-600" : "text-red-500"}`}>{(lane.profitabilityPct ?? 0).toFixed(1)}%</div></div>
        </div>
      </div>

      {incidents.length > 0 && (
        <div className="bg-card border rounded-lg p-4 shadow-sm">
          <h4 className="font-medium mb-3">Active Incidents</h4>
          <IncidentTimeline incidents={incidents.slice(0, 1)} />
        </div>
      )}

      {rcaStarted && incidents.length > 0 && <RootCauseAnalysis incidents={incidents} laneId={lane.id} />}
    </div>
  );
}
