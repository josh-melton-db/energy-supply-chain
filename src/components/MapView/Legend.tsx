import type { KpiMode } from "@/types/domain";
import { STATUS_CSS } from "@/lib/colors";

interface LegendProps {
  activeKpi: KpiMode;
  profitabilityLabels?: { low: string; mid: string; high: string };
}

type LegendItem = { color: string; label: string };

type LegendCfg = { title: string; items: LegendItem[] };

function buildLegendConfig(kpi: KpiMode, profitabilityLabels?: { low: string; mid: string; high: string }): LegendCfg {
  switch (kpi) {
    case "risk":
      return { title: "Incident Status", items: [
        { color: STATUS_CSS.GREEN, label: "Stable" },
        { color: STATUS_CSS.YELLOW, label: "Watch" },
        { color: STATUS_CSS.RED, label: "Critical" },
      ]};
    case "forecastDiscrepancy":
      return { title: "Forecast Discrepancy", items: [
        { color: STATUS_CSS.BLUE, label: "Excess Supply (> 8%)" },
        { color: STATUS_CSS.GREEN, label: "Balanced" },
        { color: STATUS_CSS.YELLOW, label: "Moderate Shortage" },
        { color: STATUS_CSS.RED, label: "Severe Shortage (> 10%)" },
      ]};
    case "totalLandedCost":
      return { title: "Total Landed Cost", items: [
        { color: STATUS_CSS.GREEN, label: "< $225k/mo" },
        { color: STATUS_CSS.YELLOW, label: "$225k-$500k/mo" },
        { color: STATUS_CSS.RED, label: "> $500k/mo" },
      ]};
    case "profitability": {
      const p = profitabilityLabels;
      return { title: "Profitability", items: [
        { color: STATUS_CSS.GREEN, label: p?.low ?? "≥ 15%" },
        { color: STATUS_CSS.YELLOW, label: p?.mid ?? "5–15%" },
        { color: STATUS_CSS.RED, label: p?.high ?? "< 5%" },
      ]};
    }
  }
}

export default function Legend({ activeKpi, profitabilityLabels }: LegendProps) {
  const cfg = buildLegendConfig(activeKpi, profitabilityLabels);

  return (
    <div className="absolute bottom-6 left-6 bg-card/95 backdrop-blur-sm border rounded-lg shadow-lg p-4 text-sm z-10">
      <div className="font-semibold mb-3">{cfg.title}</div>
      <div className="space-y-2">
        {cfg.items.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <div className="w-8 h-1 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t">
        <div className="font-semibold mb-2">Lane Types</div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <svg width="32" height="12" viewBox="0 0 32 12">
              <line x1="0" y1="6" x2="32" y2="6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-foreground/70" />
            </svg>
            <span className="text-muted-foreground">Pipeline flow</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="32" height="12" viewBox="0 0 32 12">
              <path d="M0,10 Q16,0 32,10" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-foreground/70" />
            </svg>
            <span className="text-muted-foreground">Bulk trip</span>
          </div>
        </div>
      </div>
    </div>
  );
}
