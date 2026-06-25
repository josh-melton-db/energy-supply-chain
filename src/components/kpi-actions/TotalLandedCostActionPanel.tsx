import { useMemo } from "react";
import { ArrowRight, DollarSign, Factory, Truck } from "lucide-react";
import type { GasOrderOption, Lane } from "@/types/domain";
import { RISK_THRESHOLDS as T } from "@/types/domain";
import { getTlcPartnerPurchaseOptions, TLC_PARTNER_P80_THRESHOLD } from "@/lib/energyApi";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Props {
  lane: Lane;
  lanes: Lane[];
  onPartnerPurchase?: (lane: Lane, option: GasOrderOption) => void;
  purchasedVendorKeys?: Set<string>;
}

function costBandColor(tlc: number): string {
  if (tlc <= T.totalLandedCostLowPerTon) return "text-green-600";
  if (tlc <= T.totalLandedCostHighPerTon) return "text-yellow-600";
  return "text-red-500";
}

export default function TotalLandedCostActionPanel({ lane, lanes, onPartnerPurchase, purchasedVendorKeys }: Props) {
  const prod = lane.productionCostPerTon ?? 120;
  const dist = lane.distributionCostPerTon ?? 30;
  const tlc = lane.totalLandedCostPerTon ?? (prod + dist);
  const isPipeline = lane.mode === "pipeline";
  const partnerOptions = useMemo(() => getTlcPartnerPurchaseOptions(lane), [lane]);
  const showPartnerOptions = tlc >= TLC_PARTNER_P80_THRESHOLD && partnerOptions.length > 0;

  const avgTlc = lanes.length
    ? lanes.reduce((s, l) => s + (l.totalLandedCostPerTon ?? 150), 0) / lanes.length
    : 150;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <DollarSign className="h-4 w-4 text-orange-500" />
        Total Landed Cost — {lane.destName ?? lane.dest}
      </div>

      {/* Cost breakdown */}
      <div className="bg-card border rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">Mode</div>
          <div className="text-sm font-medium flex items-center gap-1.5">
            {isPipeline ? <Factory className="h-3.5 w-3.5" /> : <Truck className="h-3.5 w-3.5" />}
            {isPipeline ? "Pipeline" : "Bulk Trip"}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Production Cost</span>
            <span className="font-medium">${prod.toFixed(0)}/ton</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.min(100, (prod / tlc) * 100)}%` }} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Distribution Cost</span>
            <span className="font-medium">${dist.toFixed(0)}/ton</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div className="bg-orange-500 h-2 rounded-full" style={{ width: `${Math.min(100, (dist / tlc) * 100)}%` }} />
          </div>
        </div>

        <div className="border-t pt-2 flex items-center justify-between">
          <span className="text-sm font-medium">Total Landed Cost</span>
          <span className={cn("text-lg font-bold", costBandColor(tlc))}>
            ${tlc.toFixed(0)}/ton
          </span>
        </div>
      </div>

      {/* Comparison across visible lanes */}
      <div className="bg-card border rounded-lg p-3">
        <div className="text-xs font-medium text-muted-foreground mb-2">Comparison Across Lanes</div>
        <div className="space-y-1.5">
          {lanes
            .slice()
            .sort((a, b) => (a.totalLandedCostPerTon ?? 150) - (b.totalLandedCostPerTon ?? 150))
            .map((l) => {
              const lTlc = l.totalLandedCostPerTon ?? 150;
              const isSelected = l.id === lane.id;
              return (
                <div key={l.id} className={cn("flex items-center justify-between text-xs py-1 px-2 rounded", isSelected && "bg-primary/10 ring-1 ring-primary/30")}>
                  <div className="flex items-center gap-1.5">
                    {l.mode === "pipeline" ? <Factory className="h-3 w-3 text-muted-foreground" /> : <Truck className="h-3 w-3 text-muted-foreground" />}
                    <span className={cn(isSelected ? "font-semibold" : "text-muted-foreground")}>{l.destName ?? l.dest}</span>
                  </div>
                  <span className={cn("font-medium", costBandColor(lTlc))}>${lTlc.toFixed(0)}/ton</span>
                </div>
              );
            })}
        </div>
        <div className="border-t mt-2 pt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Network Average</span>
          <span className="font-medium">${avgTlc.toFixed(0)}/ton</span>
        </div>
      </div>

      {/* Insight */}
      {isPipeline && (
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-2.5 text-xs text-green-700 dark:text-green-300">
          Pipeline delivery keeps distribution cost near $0. This is the most cost-effective delivery mode for high-volume customers.
        </div>
      )}
      {!isPipeline && dist > 60 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 text-xs text-amber-700 dark:text-amber-300">
          High distribution cost due to tanker trip distance. Consider evaluating closer terminal inventory or pipeline feasibility to reduce landed cost.
        </div>
      )}

      {showPartnerOptions && (
        <div className="bg-card border rounded-lg p-3 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Partner Purchase Options (high TLC lane: ≥ ${TLC_PARTNER_P80_THRESHOLD.toFixed(2)}/ton)
          </div>
          {partnerOptions.map((opt) => {
            const isPurchased = purchasedVendorKeys?.has(`${lane.id}::${opt.vendorName}`) ?? false;
            const savings = tlc - opt.pricePerTonUsd;
            const demand = Math.max(1, lane.demandTpd ?? lane.avgDailyVolume);
            const covered = Math.min(opt.availableCapacityTpd, demand);
            const blended = ((tlc * Math.max(0, demand - covered)) + (opt.pricePerTonUsd * covered)) / demand;
            return (
              <div key={opt.vendorName} className={cn("border rounded-md p-2 space-y-2", isPurchased && "border-green-200 dark:border-green-800")}>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{opt.vendorName}</div>
                  <div className={cn("text-xs font-semibold px-2 py-0.5 rounded", savings >= 0 ? "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300" : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300")}>
                    ${opt.pricePerTonUsd.toFixed(0)}/ton
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Capacity</div>
                    <div className="font-medium">{opt.availableCapacityTpd.toFixed(1)} TPD</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">ETA</div>
                    <div className="font-medium">{opt.etaHours.toFixed(0)}h</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Projected TLC</div>
                    <div className={cn("font-medium", blended <= tlc ? "text-green-600" : "text-red-500")}>${blended.toFixed(0)}/ton</div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">{opt.notes}</div>
                {!isPurchased ? (
                  <Button size="sm" className="w-full" onClick={() => onPartnerPurchase?.(lane, opt)}>
                    Apply Partner Purchase <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                ) : (
                  <div className="text-xs text-green-700 dark:text-green-300">Partner purchase applied for this vendor.</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
