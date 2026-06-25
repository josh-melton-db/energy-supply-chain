import DeckGL from "@deck.gl/react";
import { useMemo, useState } from "react";
import { Map } from "react-map-gl/maplibre";
import type { Center, Lane, KpiMode } from "@/types/domain";
import type { ProfitabilityBands } from "@/lib/profitabilityBands";
import { flowsLayer, hubsLayer, getLaneColor } from "./layers";
import { formatCurrency } from "@/lib/format";
import "maplibre-gl/dist/maplibre-gl.css";

const INITIAL_VIEW = { longitude: -96.0, latitude: 29.2, zoom: 5.2, bearing: 0, pitch: 30 };

interface MapViewProps {
  centers: Center[];
  lanes: Lane[];
  selectedLaneId?: string | null;
  highlightedSessionLaneIds?: Set<string>;
  activeKpi: KpiMode;
  profitabilityBands?: ProfitabilityBands;
  onLaneClick?: (laneId: string | null) => void;
}

const KPI_TOOLTIP_LABEL: Record<KpiMode, string> = {
  risk: "Risk",
  forecastDiscrepancy: "Forecast Discrepancy",
  totalLandedCost: "Total Landed Cost",
  profitability: "Margin",
};

function kpiValueForTooltip(lane: Lane, kpi: KpiMode): string {
  switch (kpi) {
    case "risk": {
      if (lane.technicalStatus === "critical") return "Critical";
      if (lane.technicalStatus === "watch") return "Watch";
      return "Stable";
    }
    case "forecastDiscrepancy": {
      const pct = lane.forecastDiscrepancyPct ?? 0;
      return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
    }
    case "totalLandedCost": return `${formatCurrency((lane.totalLandedCostPerTon ?? 150) * lane.avgDailyVolume * 30)}/mo`;
    case "profitability": return `${(lane.profitabilityPct ?? 0).toFixed(1)}%`;
  }
}

export default function MapView({ centers, lanes, selectedLaneId, highlightedSessionLaneIds, activeKpi, profitabilityBands, onLaneClick }: MapViewProps) {
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const centersById = useMemo(() => Object.fromEntries(centers.map((center) => [center.id, center])), [centers]);
  const layers = useMemo(
    () => [
      ...flowsLayer(lanes, centersById, selectedLaneId, activeKpi, profitabilityBands, highlightedSessionLaneIds),
      hubsLayer(centers, selectedLaneId, lanes),
    ],
    [lanes, centersById, selectedLaneId, centers, activeKpi, profitabilityBands, highlightedSessionLaneIds]
  );

  return (
    <div className="h-full w-full relative">
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: next }) => {
          if (next && typeof next === "object" && "longitude" in next && "latitude" in next && "zoom" in next) {
            setViewState({
              longitude: Number(next.longitude),
              latitude: Number(next.latitude),
              zoom: Number(next.zoom),
              bearing: Number(next.bearing ?? 0),
              pitch: Number(next.pitch ?? 30),
            });
          }
        }}
        layers={layers}
        controller
        onClick={({ object }) => {
          if (!onLaneClick) return;
          onLaneClick(object?.id ? (object.id as string) : null);
        }}
        getTooltip={({ object }) => {
          if (!object?.id) return null;
          if ("type" in object && (object.type === "facility" || object.type === "customer_site")) {
            const center = object as Center;
            const icon = center.type === "facility" ? "🏭" : "📍";
            const label = center.type === "facility" ? "Production Facility" : "Customer Site";
            return {
              html: `<div class="deck-tooltip">
                <div style="font-weight: 600; margin-bottom: 4px;">${icon} ${center.name}</div>
                <div style="font-size: 11px; opacity: 0.8;">${label}</div>
              </div>`,
              style: { backgroundColor: "transparent", padding: "0" },
            };
          }
          const lane = object as Lane;
          const modeIcon = lane.mode === "pipeline" ? "🛢️" : "🚚";
          const modeLabel = lane.mode === "pipeline" ? "Pipeline" : "Bulk Trip";
          const [r, g, b] = getLaneColor(lane, activeKpi, profitabilityBands);
          const kpiLabel = KPI_TOOLTIP_LABEL[activeKpi];
          const kpiVal = kpiValueForTooltip(lane, activeKpi);
          return {
            html: `<div class="deck-tooltip">
              <div style="font-weight: 600; margin-bottom: 4px;">${modeIcon} ${lane.id}</div>
              <div style="font-size: 11px; opacity: 0.8;">${modeLabel} · ${lane.avgDailyVolume.toLocaleString()} tons/day</div>
              <div style="margin-top: 6px; display: flex; align-items: center; gap: 6px;">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:rgb(${r},${g},${b})"></span>
                <span>${kpiLabel}: <strong>${kpiVal}</strong></span>
              </div>
            </div>`,
            style: { backgroundColor: "transparent", padding: "0" },
          };
        }}
      >
        <Map reuseMaps mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json" />
      </DeckGL>
    </div>
  );
}
