import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sliders, Zap, TrendingDown, Factory, Leaf, Play, RotateCcw, ArrowRight, AlertTriangle, BarChart3 } from "lucide-react";
import type { Lane, ScenarioParams, ScenarioPreset } from "@/types/domain";
import { DEFAULT_SCENARIO } from "@/types/domain";
import { useScenario } from "@/lib/ScenarioContext";
import { applyScenario, isScenarioActive, scenarioLabel } from "@/lib/scenarioEngine";
import { getEnergyLanes, getEnergyCenters } from "@/lib/energyApi";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PRESETS: ScenarioPreset[] = [
  {
    id: "energy-spike",
    name: "Power Price Spike +5%",
    description: "Electricity and fuel costs increase 5% across terminals and fractionators due to grid volatility. Impacts margin and operating cost.",
    params: { ...DEFAULT_SCENARIO, energyPriceShiftPct: 5 },
  },
  {
    id: "demand-drop",
    name: "Refinery Demand Drop -20%",
    description: "Refinery and petrochemical demand declines 20% across all customers, increasing take-or-pay exposure and network imbalance risk.",
    params: { ...DEFAULT_SCENARIO, demandShiftPct: -20, demandShiftCustomerId: null },
  },
  {
    id: "facility-outage",
    name: "Corpus Christi Fractionator Outage",
    description: "Unplanned outage at HUB-002. All lanes sourced from this facility lose capacity. Emergency sourcing required.",
    params: { ...DEFAULT_SCENARIO, facilityOutageId: "HUB-002" },
  },
  {
    id: "pipeline-disruption",
    name: "Pipeline Disruption (Houston Ship Channel)",
    description: "Critical pipeline from the Houston Ship Channel terminal to GulfOps Refining Alpha loses supply. Customer must be rerouted via tanker trip or partner purchase at higher cost.",
    params: { ...DEFAULT_SCENARIO, facilityOutageId: "HUB-001" },
  },
  {
    id: "combined-stress",
    name: "Combined Stress Test",
    description: "Energy +3%, demand -10% globally, logistics +8%, carbon price $45/ton. Tests Gulf Coast network resilience under multiple pressures.",
    params: { ...DEFAULT_SCENARIO, energyPriceShiftPct: 3, demandShiftPct: -10, logisticsCostShiftPct: 8, carbonPriceUsdPerTon: 45 },
  },
];

function SliderControl({ label, value, onChange, min, max, step, unit, icon: Icon }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; unit: string; icon: typeof Zap;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {label}
        </div>
        <span className={cn("text-sm font-bold tabular-nums", value !== 0 ? (value > 0 ? "text-red-500" : "text-green-600") : "text-muted-foreground")}>
          {value > 0 ? "+" : ""}{value}{unit}
        </span>
      </div>
      <div className="relative h-6 flex items-center">
        <div className="absolute inset-x-0 h-2 rounded-full bg-muted-foreground/20" />
        <div
          className="absolute h-2 rounded-full bg-primary"
          style={{ left: `${Math.min(pct, ((0 - min) / (max - min)) * 100)}%`, width: `${Math.abs(pct - ((0 - min) / (max - min)) * 100)}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-x-0 w-full h-6 appearance-none bg-transparent cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:shadow-md [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent"
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

export default function ConfigurationPage() {
  const navigate = useNavigate();
  const { scenario: activeScenario, setScenario } = useScenario();
  const [draft, setDraft] = useState<ScenarioParams>(activeScenario);
  const [baseLanes, setBaseLanes] = useState<Lane[]>([]);
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getEnergyLanes(), getEnergyCenters()]).then(([lanes, centers]) => {
      setBaseLanes(lanes);
      setFacilities(centers.filter((c) => c.type === "facility").map((c) => ({ id: c.id, name: c.name })));
      setLoading(false);
    });
  }, []);

  const preview = useMemo(() => applyScenario(baseLanes, draft), [baseLanes, draft]);
  const baseResult = useMemo(() => applyScenario(baseLanes, DEFAULT_SCENARIO), [baseLanes]);
  const draftActive = isScenarioActive(draft);

  const outageAsset = facilities.find((f) => f.id === draft.facilityOutageId);
  const outageRevenue = draft.facilityOutageId
    ? baseLanes.filter((l) => l.origin === draft.facilityOutageId).reduce((s, l) => s + l.avgDailyVolume * 195, 0)
    : 0;

  function applyPreset(preset: ScenarioPreset) {
    setDraft(preset.params);
  }

  function applyToMainView() {
    setScenario(draft);
    navigate("/");
  }

  function resetDraft() {
    setDraft(DEFAULT_SCENARIO);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
      </div>
    );
  }

  return (
    <div className="bg-background overflow-y-auto" style={{ minHeight: "calc(100vh - 57px)", maxHeight: "calc(100vh - 57px)" }}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8 pb-16">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Scenario Simulator</h1>
            <p className="text-muted-foreground mt-1">
              Model energy, refinery demand, logistics, and terminal disruptions. See how they cascade through KPIs and P&L.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={resetDraft} disabled={!draftActive}>
              <RotateCcw className="mr-2 h-4 w-4" />Reset
            </Button>
            <Button onClick={applyToMainView} disabled={!draftActive}>
              <Play className="mr-2 h-4 w-4" />Apply to Main View
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Presets + Sliders */}
          <div className="lg:col-span-2 space-y-6">
            {/* Presets */}
            <div>
              <h2 className="text-lg font-semibold mb-3">Scenario Presets</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PRESETS.map((preset) => {
                  const isActive = JSON.stringify(draft) === JSON.stringify(preset.params);
                  return (
                    <button
                      key={preset.id}
                      onClick={() => applyPreset(preset)}
                      className={cn(
                        "text-left border rounded-lg p-4 transition-all",
                        isActive ? "ring-2 ring-primary border-primary bg-primary/5" : "bg-card hover:border-muted-foreground/40"
                      )}
                    >
                      <div className="font-medium text-sm mb-1">{preset.name}</div>
                      <div className="text-xs text-muted-foreground">{preset.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom sliders */}
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Sliders className="h-5 w-5" /> Custom Scenario Builder
              </h2>
              <div className="bg-card border rounded-lg p-5 space-y-5">
                <SliderControl
                  label="Energy Price Shift"
                  value={draft.energyPriceShiftPct}
                  onChange={(v) => setDraft({ ...draft, energyPriceShiftPct: v })}
                  min={-20} max={30} step={1} unit="%" icon={Zap}
                />
                <SliderControl
                  label="Demand Shift"
                  value={draft.demandShiftPct}
                  onChange={(v) => setDraft({ ...draft, demandShiftPct: v })}
                  min={-30} max={20} step={1} unit="%" icon={TrendingDown}
                />
                <SliderControl
                  label="Logistics Cost Shift"
                  value={draft.logisticsCostShiftPct}
                  onChange={(v) => setDraft({ ...draft, logisticsCostShiftPct: v })}
                  min={-10} max={25} step={1} unit="%" icon={Factory}
                />
                <SliderControl
                  label="Carbon Price"
                  value={draft.carbonPriceUsdPerTon}
                  onChange={(v) => setDraft({ ...draft, carbonPriceUsdPerTon: v })}
                  min={0} max={150} step={5} unit=" $/ton" icon={Leaf}
                />

                {/* Facility outage selector */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                    Facility Outage
                  </div>
                  <select
                    value={draft.facilityOutageId ?? ""}
                    onChange={(e) => setDraft({ ...draft, facilityOutageId: e.target.value || null })}
                    className="w-full px-3 py-2 border rounded-md bg-background text-sm"
                  >
                    <option value="">No outage</option>
                    {facilities.map((f) => (
                      <option key={f.id} value={f.id}>{f.name} ({f.id})</option>
                    ))}
                  </select>
                  {outageAsset && (
                    <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm">
                      <div className="flex items-center gap-2 font-medium text-red-900 dark:text-red-100">
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                        Estimated impact: {formatCurrency(outageRevenue)}/day
                      </div>
                      <div className="text-xs text-red-700 dark:text-red-300 mt-1">
                        {baseLanes.filter((l) => l.origin === draft.facilityOutageId).length} lane(s) affected.
                        All downstream customers will require emergency sourcing.
                      </div>
                    </div>
                  )}
                </div>

                {/* Demand target */}
                {draft.demandShiftPct !== 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Demand Shift Target</div>
                    <select
                      value={draft.demandShiftCustomerId ?? ""}
                      onChange={(e) => setDraft({ ...draft, demandShiftCustomerId: e.target.value || null })}
                      className="w-full px-3 py-2 border rounded-md bg-background text-sm"
                    >
                      <option value="">All customers (global)</option>
                      <option value="CUST-0001">GulfOps Refining Alpha Port Arthur</option>
                      <option value="CUST-0002">GulfOps Petrochem Bravo Corpus Christi</option>
                      <option value="CUST-0003">GulfOps LNG Charlie Cameron</option>
                      <option value="CUST-0004">GulfOps Fuels Delta Baton Rouge</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Live Preview */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <BarChart3 className="h-5 w-5" /> Live Impact Preview
            </h2>

            {draftActive ? (
              <>
                {/* Scenario label */}
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm">
                  <div className="font-medium text-amber-900 dark:text-amber-100">{scenarioLabel(draft)}</div>
                </div>

                {/* KPI comparison */}
                <div className="bg-card border rounded-lg p-4 space-y-3">
                  <div className="text-xs font-medium text-muted-foreground">KPI Impact</div>
                  <KpiRow label="Critical Lanes" base={baseResult.kpiSummary.criticalLanes} scenario={preview.kpiSummary.criticalLanes} worse={(v) => v > baseResult.kpiSummary.criticalLanes} />
                  <KpiRow label="Forecast Discrepancy" base={Number(baseResult.kpiSummary.avgForecastDiscrepancyPct.toFixed(1))} scenario={Number(preview.kpiSummary.avgForecastDiscrepancyPct.toFixed(1))} suffix="%" worse={(v) => v < baseResult.kpiSummary.avgForecastDiscrepancyPct} />
                  <KpiRow label="Total Landed Cost (Monthly)" base={Number(baseResult.kpiSummary.totalLandedCost.toFixed(0))} scenario={Number(preview.kpiSummary.totalLandedCost.toFixed(0))} format="currency" worse={(v) => v > baseResult.kpiSummary.totalLandedCost} />
                  <KpiRow label="Avg Margin" base={Number(baseResult.kpiSummary.avgProfitabilityPct.toFixed(1))} scenario={Number(preview.kpiSummary.avgProfitabilityPct.toFixed(1))} suffix="%" worse={(v) => v < baseResult.kpiSummary.avgProfitabilityPct} />
                </div>

                {/* P&L Impact */}
                <div className="bg-card border rounded-lg p-4">
                  <div className="text-xs font-medium text-muted-foreground mb-2">Monthly P&L Impact</div>
                  <div className={cn("text-2xl font-bold", preview.kpiSummary.plImpactUsd >= 0 ? "text-green-600" : "text-red-500")}>
                    {formatCurrency(preview.kpiSummary.plImpactUsd)}
                  </div>
                </div>

                {/* Variance waterfall */}
                {preview.varianceBreakdown.length > 0 && (
                  <div className="bg-card border rounded-lg p-4">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Variance Breakdown</div>
                    <div className="space-y-1.5">
                      {preview.varianceBreakdown.map((v) => (
                        <div key={v.label} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{v.label}</span>
                          <span className={cn("font-medium", v.deltaUsd >= 0 ? "text-green-600" : "text-red-500")}>
                            {v.deltaUsd >= 0 ? "+" : ""}{formatCurrency(v.deltaUsd)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Apply button (sticky) */}
                <Button className="w-full" size="lg" onClick={applyToMainView}>
                  <Play className="mr-2 h-5 w-5" />
                  Apply Scenario to Main View
                </Button>
              </>
            ) : (
              <div className="bg-card border rounded-lg p-8 text-center">
                <Sliders className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">Adjust parameters or select a preset to preview impact on KPIs and P&L.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiRow({ label, base, scenario, suffix = "", format, worse }: {
  label: string; base: number; scenario: number; suffix?: string; format?: "currency"; worse: (v: number) => boolean;
}) {
  const changed = Math.abs(scenario - base) > 0.05;
  const isWorse = worse(scenario);
  const fmt = (v: number) => format === "currency" ? formatCurrency(v) : `${v}${suffix}`;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground/60">{fmt(base)}</span>
        {changed && (
          <>
            <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
            <span className={cn("font-medium", isWorse ? "text-red-500" : "text-green-600")}>{fmt(scenario)}</span>
          </>
        )}
      </div>
    </div>
  );
}
