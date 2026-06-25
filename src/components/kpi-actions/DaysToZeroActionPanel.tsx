import { useEffect, useState, useCallback } from "react";
import { Clock, AlertTriangle, TrendingDown, TrendingUp, CheckCircle, ArrowRight, Truck, Package, Loader2 } from "lucide-react";
import type { Lane, Center, ForecastPoint, CustomerAnomaly, DemandOpportunity, GasOrderOption } from "@/types/domain";
import { getForecastContext, getCustomerAnomalies, getDemandOpportunities, getLdExposureContext } from "@/lib/energyApi";
import { addSessionLane, recordDemoAction, type SessionLane } from "@/lib/sessionState";
import ForecastMiniChart from "@/components/charts/ForecastMiniChart";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

function formatTpd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatSignedTpd(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return `${n > 0 ? "+" : ""}${n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

interface Props {
  lane: Lane | null;
  lanes: Lane[];
  centers?: Center[];
  onLaneSelect?: (laneId: string) => void;
  onSessionLaneAdded?: (laneId?: string) => void;
}

export default function DaysToZeroActionPanel({ lane, lanes, centers, onLaneSelect, onSessionLaneAdded }: Props) {
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [anomalies, setAnomalies] = useState<CustomerAnomaly[]>([]);
  const [demandOpps, setDemandOpps] = useState<DemandOpportunity[]>([]);
  const [vendorOptions, setVendorOptions] = useState<GasOrderOption[]>([]);
  const [tab, setTab] = useState<"forecast" | "deviations">("forecast");
  const [appliedDeliveries, setAppliedDeliveries] = useState<Set<string>>(new Set());
  const [purchasedVendors, setPurchasedVendors] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const isExcess = lane && (lane.forecastDiscrepancyPct ?? 0) > 3;
  const isShortage = lane && (lane.forecastDiscrepancyPct ?? 0) < -3;

  useEffect(() => {
    setLoading(true);
    const promises: Promise<unknown>[] = [];

    if (lane) {
      promises.push(getForecastContext(lane.id).then(setForecast));
      if ((lane.forecastDiscrepancyPct ?? 0) > 3 && centers) {
        promises.push(getDemandOpportunities(lane.id, lanes, centers).then(setDemandOpps));
      } else {
        setDemandOpps([]);
      }
      if ((lane.forecastDiscrepancyPct ?? 0) < -3) {
        promises.push(getLdExposureContext(lane.id).then((ctx) => setVendorOptions(ctx.gasOrderOptions)));
      } else {
        setVendorOptions([]);
      }
    } else {
      setForecast([]);
      setDemandOpps([]);
      setVendorOptions([]);
    }
    promises.push(getCustomerAnomalies(lanes).then(setAnomalies));

    void Promise.all(promises).finally(() => setLoading(false));
  }, [lane?.id, lanes, centers]);

  const handleApplyTruckDelivery = useCallback((opp: DemandOpportunity) => {
    if (!lane || !centers) return;
    const sourceCenter = centers.find((c) => c.id === lane.origin);
    const targetCenter = centers.find((c) => c.id === opp.targetCustomerId);
    if (!sourceCenter || !targetCenter) return;

    const sessionLane: SessionLane = {
      id: `SES-${lane.origin}-${opp.targetCustomerId}-${opp.product}`,
      origin: lane.origin,
      originLat: sourceCenter.lat,
      originLng: sourceCenter.lng,
      dest: opp.targetCustomerId,
      destLat: targetCenter.lat,
      destLng: targetCenter.lng,
      mode: "truck",
      product: opp.product,
      avgDailyVolume: opp.unmetDemandTpd,
      totalLandedCostPerTon: opp.estimatedTlcPerTon,
      forecastDiscrepancyPct: 0,
      sourceLabel: `New bulk trip: ${sourceCenter.name} → ${opp.targetCustomerName}`,
    };
    addSessionLane(sessionLane);
    setAppliedDeliveries((prev) => new Set(prev).add(opp.targetCustomerId));
    recordDemoAction("supplyReplenishment");
    onSessionLaneAdded?.(sessionLane.id);
  }, [lane, centers, onSessionLaneAdded]);

  const handlePartnerPurchase = useCallback((opt: GasOrderOption) => {
    if (!lane || !centers) return;
    const destCenter = centers.find((c) => c.id === lane.dest);
    if (!destCenter) return;

    const sessionLane: SessionLane = {
      id: `SES-PARTNER-${opt.vendorName.replace(/\s+/g, "-")}-${lane.dest}`,
      origin: `EXT-${opt.vendorName.replace(/\s+/g, "-")}`,
      originLat: opt.vendorLat ?? destCenter.lat + 0.5,
      originLng: opt.vendorLng ?? destCenter.lng + 0.5,
      dest: lane.dest,
      destLat: destCenter.lat,
      destLng: destCenter.lng,
      mode: "truck",
      product: opt.product,
      avgDailyVolume: opt.availableCapacityTpd,
      totalLandedCostPerTon: opt.pricePerTonUsd,
      forecastDiscrepancyPct: 0,
      sourceLabel: `Partner purchase: ${opt.vendorName} → ${lane.destName ?? lane.dest}`,
    };
    addSessionLane(sessionLane);
    setPurchasedVendors((prev) => new Set(prev).add(opt.vendorName));
    recordDemoAction("partnerPurchase");
    onSessionLaneAdded?.(sessionLane.id);
  }, [lane, centers, onSessionLaneAdded]);

  const displayed = lane ? anomalies.filter((a) => a.laneId === lane.id) : anomalies;
  const flagged = displayed.filter((a) => Math.abs(a.deviationPct) > 3).length;

  const avgForecastedTpd = displayed.length ? Math.round(displayed.reduce((s, a) => s + a.forecastedTpd, 0) / displayed.length) : 0;
  const avgActualTpd = displayed.length ? Math.round(displayed.reduce((s, a) => s + a.actualTpd, 0) / displayed.length) : 0;
  const avgDeviationPct = displayed.length ? displayed.reduce((s, a) => s + a.deviationPct, 0) / displayed.length : 0;
  const deltaTpd = avgActualTpd - avgForecastedTpd;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Clock className="h-4 w-4 text-blue-500" />
        Forecast Discrepancy {lane ? `— ${lane.id} (${(lane.forecastDiscrepancyPct ?? 0) > 0 ? "+" : ""}${(lane.forecastDiscrepancyPct ?? 0).toFixed(1)}%)` : "— Network Overview"}
      </div>

      {lane ? (
        <div className="bg-card border rounded-lg p-3">
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">Supply</div>
              <div className="font-semibold">{formatTpd(lane.supplyTpd)} TPD</div>
            </div>
            <div>
              <div className="text-muted-foreground">Demand</div>
              <div className="font-semibold">{formatTpd(lane.demandTpd)} TPD</div>
            </div>
            <div>
              <div className="text-muted-foreground">Gap</div>
              <div className={cn("font-semibold", (lane.forecastDiscrepancyPct ?? 0) < -3 ? "text-red-500" : (lane.forecastDiscrepancyPct ?? 0) > 8 ? "text-blue-500" : "text-green-600")}>
                {formatSignedTpd((lane.supplyTpd ?? 0) - (lane.demandTpd ?? 0))} TPD
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Discrepancy</div>
              <div className={cn("font-semibold", (lane.forecastDiscrepancyPct ?? 0) < -3 ? "text-red-500" : (lane.forecastDiscrepancyPct ?? 0) > 8 ? "text-blue-500" : "text-green-600")}>
                {(lane.forecastDiscrepancyPct ?? 0) > 0 ? "+" : ""}{(lane.forecastDiscrepancyPct ?? 0).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      ) : displayed.length > 0 ? (
        <div className="bg-card border rounded-lg p-3">
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">Forecast</div>
              <div className="font-semibold">{avgForecastedTpd} TPD</div>
            </div>
            <div>
              <div className="text-muted-foreground">Actual</div>
              <div className="font-semibold">{avgActualTpd} TPD</div>
            </div>
            <div>
              <div className="text-muted-foreground">Delta</div>
              <div className={cn("font-semibold", deltaTpd < 0 ? "text-red-500" : "text-green-600")}>
                {deltaTpd > 0 ? "+" : ""}{deltaTpd} TPD
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Deviation</div>
              <div className={cn("font-semibold", avgDeviationPct < -3 ? "text-red-500" : avgDeviationPct < 0 ? "text-yellow-600" : "text-green-600")}>
                {avgDeviationPct > 0 ? "+" : ""}{avgDeviationPct.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex gap-1 bg-muted rounded-lg p-0.5">
        <button onClick={() => setTab("forecast")} className={cn("flex-1 text-xs py-1.5 rounded-md transition-colors", tab === "forecast" ? "bg-background shadow-sm font-medium" : "text-muted-foreground")}>
          Forecast
        </button>
        <button onClick={() => setTab("deviations")} className={cn("flex-1 text-xs py-1.5 rounded-md transition-colors", tab === "deviations" ? "bg-background shadow-sm font-medium" : "text-muted-foreground")}>
          Deviations {flagged > 0 ? `(${flagged})` : ""}
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-sm">
            {isShortage ? "Loading purchase options..." : isExcess ? "Loading demand opportunities..." : "Loading..."}
          </span>
        </div>
      ) : tab === "forecast" ? (
        <>
          {lane && forecast.length > 0 && (
            <div className="bg-card border rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-2">14-Day Supply vs Demand Forecast</div>
              <ForecastMiniChart data={forecast} height={130} />
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Avg Supply</span>
                  <div className="font-medium">{formatTpd(forecast.reduce((s, f) => s + f.supplyTpd, 0) / forecast.length)} TPD</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Avg Demand</span>
                  <div className="font-medium">{formatTpd(forecast.reduce((s, f) => s + f.demandTpd, 0) / forecast.length)} TPD</div>
                </div>
              </div>
            </div>
          )}

          {/* --- DEMAND OPPORTUNITIES (excess supply lanes) --- */}
          {isExcess && demandOpps.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground px-1 flex items-center gap-1">
                <Truck className="h-3 w-3" />
                Demand Opportunities — nearby customers with unmet demand
              </div>
              {demandOpps.map((opp) => {
                const isApplied = appliedDeliveries.has(opp.targetCustomerId);
                return (
                  <div key={opp.targetCustomerId} className={cn("bg-card border rounded-lg p-3", isApplied && "border-green-200 dark:border-green-800")}>
                    <div className="flex items-center gap-3">
                      {isApplied ? (
                        <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                      ) : (
                        <Truck className="h-4 w-4 text-blue-500 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{opp.targetCustomerName}</div>
                        <div className="text-xs text-muted-foreground">
                          Unmet: {formatTpd(opp.unmetDemandTpd)} TPD | {opp.distanceKm} km | Est. ${opp.estimatedTlcPerTon}/ton
                        </div>
                      </div>
                      {opp.savingsPerTon > 0 && (
                        <div className="text-sm font-bold text-green-600 whitespace-nowrap">
                          -${opp.savingsPerTon}/ton
                        </div>
                      )}
                    </div>
                    {!isApplied ? (
                      <Button size="sm" className="w-full mt-2" onClick={() => handleApplyTruckDelivery(opp)}>
                        <Truck className="mr-1 h-3 w-3" /> Apply Truck Delivery
                      </Button>
                    ) : (
                      <div className="mt-2 text-xs text-green-700 dark:text-green-300 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" /> Bulk trip route added to map
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* --- PARTNER PURCHASE (shortage lanes) --- */}
          {isShortage && vendorOptions.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground px-1 flex items-center gap-1">
                <Package className="h-3 w-3" />
                Partner Purchase — fill the supply gap from external vendors
              </div>
              <div className="bg-card border rounded-lg p-3 mb-1.5">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Committed</div>
                    <div className="font-semibold">{formatTpd(lane?.demandTpd ?? 0)} TPD</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Actual Supply</div>
                    <div className="font-semibold">{formatTpd(lane?.supplyTpd ?? 0)} TPD</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Gap</div>
                    <div className="font-semibold text-red-500">{formatTpd(Math.abs((lane?.supplyTpd ?? 0) - (lane?.demandTpd ?? 0)))} TPD</div>
                  </div>
                </div>
              </div>
              {vendorOptions.map((opt) => {
                const isPurchased = purchasedVendors.has(opt.vendorName);
                return (
                  <div key={opt.vendorName} className={cn("bg-card border rounded-lg p-3", isPurchased && "border-green-200 dark:border-green-800")}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="text-sm font-medium">{opt.vendorName}</div>
                        <div className="text-xs text-muted-foreground">{opt.notes}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                      <div><span className="text-muted-foreground">Capacity</span><div className="font-medium">{formatTpd(opt.availableCapacityTpd)} TPD</div></div>
                      <div><span className="text-muted-foreground">Price</span><div className="font-medium">{formatCurrency(opt.pricePerTonUsd)}/ton</div></div>
                      <div><span className="text-muted-foreground">ETA</span><div className="font-medium">{opt.etaHours}h</div></div>
                    </div>
                    {!isPurchased ? (
                      <Button size="sm" className="w-full" onClick={() => handlePartnerPurchase(opt)}>
                        Purchase Spot Barrels <ArrowRight className="ml-1 h-3 w-3" />
                      </Button>
                    ) : (
                      <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded p-2 text-xs text-green-700 dark:text-green-300 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" /> Sourcing team notified — route added to map
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty state when no lane or balanced lane */}
          {!isExcess && !isShortage && !lane ? (
            <div className="bg-card border rounded-lg p-6 text-center text-sm text-muted-foreground">
              Select a lane to view supply/demand forecast and opportunities
            </div>
          ) : !isExcess && !isShortage && lane ? (
            <div className="bg-card border rounded-lg p-4 text-center text-sm text-muted-foreground">
              Supply and demand are balanced on this lane
            </div>
          ) : null}
        </>
      ) : displayed.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground px-1">Consumption vs forecast — deviations indicate actual draw rate differs from predicted demand.</div>
          {displayed.map((a) => (
              <div
                key={a.laneId}
                onClick={() => onLaneSelect?.(a.laneId)}
                className={cn(
                  "bg-card border rounded-lg p-3 flex items-center gap-3",
                  Math.abs(a.deviationPct) > 8 && "border-red-200 dark:border-red-800",
                  onLaneSelect && "cursor-pointer hover:bg-muted/50 transition-colors"
                )}
              >
                {a.deviationPct < -5 ? (
                  <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
                ) : a.deviationPct < 0 ? (
                  <TrendingDown className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                ) : (
                  <TrendingUp className="h-4 w-4 text-green-500 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{a.customerName} — {a.product}</div>
                  <div className="text-xs text-muted-foreground">
                    Forecast: {formatTpd(a.forecastedTpd)} TPD | Actual: {formatTpd(a.actualTpd)} TPD | Delta: {formatSignedTpd(a.actualTpd - a.forecastedTpd)} TPD
                  </div>
                </div>
                <div className={cn("text-sm font-bold whitespace-nowrap", a.deviationPct < -5 ? "text-red-500" : a.deviationPct < 0 ? "text-yellow-600" : "text-green-600")}>
                  {a.deviationPct > 0 ? "+" : ""}{a.deviationPct.toFixed(1)}%
                </div>
              </div>
          ))}
        </div>
      ) : (
        <div className="bg-card border rounded-lg p-6 text-center text-sm text-muted-foreground">
          No forecast deviations detected on this lane
        </div>
      )}

    </div>
  );
}
