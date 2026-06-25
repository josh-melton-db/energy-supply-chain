import { AlertTriangle, Clock, DollarSign, TrendingUp } from "lucide-react";
import type { Lane, KpiMode, ScenarioResult } from "@/types/domain";
import { RISK_THRESHOLDS as T } from "@/types/domain";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";

interface KPICardsProps {
  lanes: Lane[];
  activeKpi: KpiMode;
  onKpiChange: (kpi: KpiMode) => void;
  scenarioResult?: ScenarioResult;
}

export default function KPICards({ lanes, activeKpi, onKpiChange, scenarioResult }: KPICardsProps) {
  const critical = lanes.filter((lane) => lane.technicalStatus === "critical").length;
  const avgDiscrepancy = lanes.length ? lanes.reduce((sum, lane) => sum + (lane.forecastDiscrepancyPct ?? 0), 0) / lanes.length : 0;
  const totalTlc = lanes.reduce((sum, lane) => sum + ((lane.totalLandedCostPerTon ?? 150) * lane.avgDailyVolume * 30), 0);
  const avgProfitability = lanes.length ? lanes.reduce((sum, lane) => sum + (lane.profitabilityPct ?? 0), 0) / lanes.length : 0;

  const base = scenarioResult?.baseKpiSummary;

  type CardDef = { kpi: KpiMode; value: string; label: string; icon: typeof AlertTriangle; color: string; valueColor?: string; deltaText?: string | null; deltaWorse?: boolean };

  const criticalDelta = base ? critical - base.criticalLanes : 0;
  const discrepancyDelta = base ? avgDiscrepancy - base.avgForecastDiscrepancyPct : 0;
  const tlcDelta = base ? totalTlc - base.totalLandedCost : 0;
  const marginDelta = base ? avgProfitability - base.avgProfitabilityPct : 0;

  const cards: CardDef[] = [
    { kpi: "profitability", value: `${avgProfitability.toFixed(1)}%`, label: "Avg Margin", icon: TrendingUp, color: "text-primary", valueColor: avgProfitability >= T.profitabilityWatchPct ? "text-green-600" : avgProfitability >= T.profitabilityCriticalPct ? "text-yellow-600" : "text-red-500", deltaText: base && Math.abs(marginDelta) > 0.1 ? `${marginDelta > 0 ? "+" : ""}${marginDelta.toFixed(1)}%` : null, deltaWorse: marginDelta < 0 },
    { kpi: "forecastDiscrepancy", value: `${avgDiscrepancy > 0 ? "+" : ""}${avgDiscrepancy.toFixed(1)}%`, label: "Forecast Discrepancy", icon: Clock, color: "text-blue-500", deltaText: base && Math.abs(discrepancyDelta) > 0.1 ? `${discrepancyDelta > 0 ? "+" : ""}${discrepancyDelta.toFixed(1)}%` : null, deltaWorse: discrepancyDelta < 0 },
    { kpi: "totalLandedCost", value: formatCurrency(totalTlc), label: "Total Landed Cost (Monthly)", icon: DollarSign, color: "text-orange-500", valueColor: totalTlc <= T.totalLandedCostMonthlyLowUsd ? "text-green-600" : totalTlc <= T.totalLandedCostMonthlyHighUsd ? "text-yellow-600" : "text-red-500", deltaText: base && Math.abs(tlcDelta) > 1 ? `${tlcDelta > 0 ? "+" : ""}${formatCurrency(tlcDelta)}` : null, deltaWorse: tlcDelta > 0 },
    { kpi: "risk", value: String(critical), label: "Critical Lanes", icon: AlertTriangle, color: "text-red-500", valueColor: "text-red-500", deltaText: base && criticalDelta !== 0 ? `${criticalDelta > 0 ? "+" : ""}${criticalDelta}` : null, deltaWorse: criticalDelta > 0 },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 p-3">
      {cards.map(({ kpi, value, label, icon: Icon, color, valueColor, deltaText, deltaWorse }) => (
        <button
          key={kpi}
          onClick={() => onKpiChange(kpi)}
          className={cn(
            "bg-card border rounded-lg p-3 shadow-sm text-left transition-all cursor-pointer",
            activeKpi === kpi ? "ring-2 ring-primary border-primary" : "hover:border-muted-foreground/40"
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className={cn("text-xl font-bold", valueColor)}>{value}</span>
                {deltaText && (
                  <span className={cn("text-xs font-semibold", deltaWorse ? "text-red-500" : "text-green-600")}>
                    {deltaText}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
            <Icon className={cn("h-6 w-6 opacity-70", color)} />
          </div>
        </button>
      ))}
    </div>
  );
}
