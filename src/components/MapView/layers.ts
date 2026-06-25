import { ArcLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Center, Lane, KpiMode } from "@/types/domain";
import { RISK_THRESHOLDS as T } from "@/types/domain";
import type { ProfitabilityBands } from "@/lib/profitabilityBands";
import { STATUS_COLORS, type RGBA } from "@/lib/colors";

const { GREEN, YELLOW, RED, BLUE } = STATUS_COLORS;

function lerp(a: RGBA, b: RGBA, t: number): RGBA {
  const c = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * c),
    Math.round(a[1] + (b[1] - a[1]) * c),
    Math.round(a[2] + (b[2] - a[2]) * c),
    Math.round(a[3] + (b[3] - a[3]) * c),
  ];
}

function riskColor(lane: Lane): RGBA {
  if (lane.technicalStatus === "critical") return RED;
  if (lane.technicalStatus === "watch") return YELLOW;
  return GREEN;
}

function forecastDiscrepancyColor(lane: Lane): RGBA {
  const pct = lane.forecastDiscrepancyPct ?? 0;
  if (pct > T.forecastExcessPct) return BLUE;
  if (pct < -T.forecastShortageCriticalPct) return RED;
  if (pct < -T.forecastShortageWatchPct) return YELLOW;
  return GREEN;
}

function totalLandedCostColor(lane: Lane): RGBA {
  const v = (lane.totalLandedCostPerTon ?? 150) * lane.avgDailyVolume * 30;
  if (v >= T.totalLandedCostMonthlyHighUsd) return RED;
  if (v <= T.totalLandedCostMonthlyLowUsd) return GREEN;
  const range = T.totalLandedCostMonthlyHighUsd - T.totalLandedCostMonthlyLowUsd;
  const t = (v - T.totalLandedCostMonthlyLowUsd) / range;
  return t < 0.5 ? lerp(GREEN, YELLOW, t * 2) : lerp(YELLOW, RED, (t - 0.5) * 2);
}

function profitabilityColor(lane: Lane, bands?: ProfitabilityBands): RGBA {
  const v = lane.profitabilityPct ?? 20;
  const lo = bands?.highMax ?? T.profitabilityCriticalPct;
  const hi = bands?.mediumMax ?? T.profitabilityWatchPct;
  if (v <= lo) return RED;
  if (v > hi) return GREEN;
  const range = hi - lo;
  const t = range > 0 ? (v - lo) / range : 1;
  return t < 0.5 ? lerp(RED, YELLOW, t * 2) : lerp(YELLOW, GREEN, (t - 0.5) * 2);
}

export function getLaneColor(lane: Lane, kpi: KpiMode, bands?: ProfitabilityBands): RGBA {
  switch (kpi) {
    case "risk": return riskColor(lane);
    case "forecastDiscrepancy": return forecastDiscrepancyColor(lane);
    case "totalLandedCost": return totalLandedCostColor(lane);
    case "profitability": return profitabilityColor(lane, bands);
  }
}

function fadedColor(c: RGBA): RGBA {
  return [c[0], c[1], c[2], 100];
}

export function hubsLayer(centers: Center[], selectedLaneId?: string | null, lanes?: Lane[]) {
  const connectedIds = new Set<string>();
  if (selectedLaneId && lanes) {
    const lane = lanes.find((l) => l.id === selectedLaneId);
    if (lane) {
      connectedIds.add(lane.origin);
      connectedIds.add(lane.dest);
    }
  }
  const hasSelection = connectedIds.size > 0;

  return new ScatterplotLayer({
    id: "hubs",
    data: centers,
    getPosition: (d: Center) => [d.lng, d.lat],
    getRadius: 26000,
    radiusUnits: "meters",
    getFillColor: (d: Center) => {
      const base: RGBA = d.type === "facility" ? [147, 51, 234, 200] : [59, 130, 246, 200];
      if (hasSelection && !connectedIds.has(d.id)) return [base[0], base[1], base[2], 25];
      return base;
    },
    stroked: true,
    lineWidthMinPixels: 2,
    getLineColor: (d: Center) => {
      if (hasSelection && !connectedIds.has(d.id)) return [255, 255, 255, 25] as RGBA;
      return [255, 255, 255, 150] as RGBA;
    },
    pickable: true,
    updateTriggers: { getFillColor: [selectedLaneId], getLineColor: [selectedLaneId] },
  });
}

function dimIfUnselected(color: RGBA, laneId: string, selectedId: string | null | undefined): RGBA {
  if (!selectedId || laneId === selectedId) return color;
  return [color[0], color[1], color[2], 18];
}

export function flowsLayer(
  lanes: Lane[],
  centersById: Record<string, Center>,
  selectedLaneId: string | null | undefined,
  kpi: KpiMode,
  bands?: ProfitabilityBands,
  highlightedSessionLaneIds: Set<string> = new Set(),
) {
  const validLanes = lanes.filter((lane) => centersById[lane.origin] && centersById[lane.dest]);
  const pipelineLanes = validLanes.filter((lane) => lane.mode === "pipeline");
  const truckLanes = validLanes.filter((lane) => lane.mode === "truck");

  const layers = [];

  if (truckLanes.length > 0) {
    layers.push(
      new ArcLayer({
        id: "flows-truck",
        data: truckLanes,
        getSourcePosition: (d: Lane) => {
          const from = centersById[d.origin];
          return from ? [from.lng, from.lat] : [0, 0];
        },
        getTargetPosition: (d: Lane) => {
          const to = centersById[d.dest];
          return to ? [to.lng, to.lat] : [0, 0];
        },
        getWidth: (d: Lane) => {
          if (highlightedSessionLaneIds.has(d.id) && d.id === selectedLaneId) return 24;
          if (d.id === selectedLaneId) return 18;
          return 13;
        },
        getHeight: 0.4,
        getSourceColor: (d: Lane) => {
          const base = getLaneColor(d, kpi, bands);
          const highlighted = highlightedSessionLaneIds.has(d.id) && d.id === selectedLaneId
            ? [base[0], base[1], base[2], 255] as RGBA
            : base;
          return dimIfUnselected(highlighted, d.id, selectedLaneId);
        },
        getTargetColor: (d: Lane) => {
          const base = fadedColor(getLaneColor(d, kpi, bands));
          const highlighted = highlightedSessionLaneIds.has(d.id) && d.id === selectedLaneId
            ? [base[0], base[1], base[2], 215] as RGBA
            : base;
          return dimIfUnselected(highlighted, d.id, selectedLaneId);
        },
        greatCircle: true,
        pickable: true,
        updateTriggers: {
          getSourceColor: [kpi, bands, selectedLaneId, highlightedSessionLaneIds],
          getTargetColor: [kpi, bands, selectedLaneId, highlightedSessionLaneIds],
          getWidth: [selectedLaneId, highlightedSessionLaneIds],
        },
      })
    );
  }

  if (pipelineLanes.length > 0) {
    layers.push(
      new PathLayer({
        id: "flows-pipeline",
        data: pipelineLanes,
        getPath: (d: Lane) => {
          const from = centersById[d.origin];
          const to = centersById[d.dest];
          return from && to ? [[from.lng, from.lat], [to.lng, to.lat]] : [];
        },
        getWidth: (d: Lane) => {
          if (highlightedSessionLaneIds.has(d.id) && d.id === selectedLaneId) return 18;
          if (d.id === selectedLaneId) return 14;
          return 10;
        },
        widthUnits: "pixels",
        getColor: (d: Lane) => {
          const base = getLaneColor(d, kpi, bands);
          const highlighted = highlightedSessionLaneIds.has(d.id) && d.id === selectedLaneId
            ? [base[0], base[1], base[2], 255] as RGBA
            : base;
          return dimIfUnselected(highlighted, d.id, selectedLaneId);
        },
        capRounded: true,
        jointRounded: true,
        pickable: true,
        updateTriggers: { getColor: [kpi, bands, selectedLaneId, highlightedSessionLaneIds], getWidth: [selectedLaneId, highlightedSessionLaneIds] },
      })
    );
  }

  return layers;
}
