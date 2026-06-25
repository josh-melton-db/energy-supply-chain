import { useEffect, useState } from "react";
import { BarChart3, Maximize2, X } from "lucide-react";
import type { Lane, MarginBreakdown } from "@/types/domain";
import { getMarginBreakdown } from "@/lib/energyApi";
import { formatCurrency } from "@/lib/format";
import WaterfallChart from "@/components/charts/WaterfallChart";
import { useScenario } from "@/lib/ScenarioContext";
import { cn } from "@/lib/utils";

export default function MarginActionPanel({ lane, lanes }: { lane: Lane | null; lanes: Lane[] }) {
  const [breakdown, setBreakdown] = useState<MarginBreakdown | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const { scenario } = useScenario();

  useEffect(() => {
    getMarginBreakdown(lane?.id, scenario, lanes).then(setBreakdown);
  }, [lane?.id, scenario, lanes]);

  if (!breakdown) return <div className="text-sm text-muted-foreground py-4 text-center">Loading margin data...</div>;

  const totalRevenue = breakdown.waterfall.find((n) => n.type === "start")?.value ?? 0;
  const netMargin = breakdown.waterfall.find((n) => n.type === "end")?.value ?? 0;
  const marginPct = totalRevenue > 0 ? (netMargin / totalRevenue) * 100 : 0;

  const topDrivers = breakdown.waterfall
    .filter((n) => n.type === "delta")
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 3);

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BarChart3 className="h-4 w-4 text-primary" />
          Margin Analysis {lane ? `— ${lane.id}` : "— All Lanes"}
        </div>

        {/* Summary */}
        <div className="bg-card border rounded-lg p-3">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Revenue</div>
                  <div className="font-medium">{formatCurrency(totalRevenue)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Net Margin</div>
                  <div className={cn("font-medium", netMargin >= 0 ? "text-green-600" : "text-red-500")}>{formatCurrency(netMargin)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Margin %</div>
                  <div className={cn("font-medium", marginPct >= 10 ? "text-green-600" : marginPct >= 5 ? "text-yellow-600" : "text-red-500")}>{marginPct.toFixed(1)}%</div>
                </div>
              </div>
            </div>

            {/* Top drivers */}
            <div className="bg-card border rounded-lg p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">Top 3 Margin Drivers</div>
              <div className="space-y-1.5">
                {topDrivers.map((d, i) => (
                  <div key={d.label} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{i + 1}. {d.label}</span>
                    <span className={cn("font-medium", d.value >= 0 ? "text-green-600" : "text-red-500")}>
                      {d.value >= 0 ? "+" : ""}{formatCurrency(d.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Full screen button */}
            <div className="flex items-center justify-end">
              <button
                onClick={() => setFullScreen(true)}
                className="p-1.5 rounded-md border bg-card hover:bg-muted transition-colors"
                title="Full screen"
              >
                <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>

        <div className="bg-card border rounded-lg p-2">
          <WaterfallChart data={breakdown.waterfall} height={180} />
        </div>
      </div>

      {/* Full-screen modal */}
      {fullScreen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setFullScreen(false)}>
          <div className="bg-card border rounded-xl shadow-2xl w-[90vw] max-w-[1100px] max-h-[85vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-base font-semibold">
                <BarChart3 className="h-5 w-5 text-primary" />
                Margin Analysis {lane ? `— ${lane.id}` : "— All Lanes"}
              </div>
              <button onClick={() => setFullScreen(false)} className="p-1.5 rounded-md hover:bg-muted transition-colors">
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>

            {/* Summary row */}
            <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="text-xs text-muted-foreground">Revenue</div>
                <div className="text-lg font-semibold">{formatCurrency(totalRevenue)}</div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="text-xs text-muted-foreground">Net Margin</div>
                <div className={cn("text-lg font-semibold", netMargin >= 0 ? "text-green-600" : "text-red-500")}>{formatCurrency(netMargin)}</div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="text-xs text-muted-foreground">Margin %</div>
                <div className={cn("text-lg font-semibold", marginPct >= 10 ? "text-green-600" : marginPct >= 5 ? "text-yellow-600" : "text-red-500")}>{marginPct.toFixed(1)}%</div>
              </div>
            </div>

            <div className="border rounded-lg p-4 bg-background">
              <WaterfallChart data={breakdown.waterfall} height={420} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
