import { useEffect, useState } from "react";
import { Wrench, User, Package, FileText, CheckCircle, Clock, Brain } from "lucide-react";
import type { Lane, MaintenanceContext, StaffAssignment, PartsRequirement } from "@/types/domain";
import { getMaintenanceContext } from "@/lib/energyApi";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function CriticalLanesActionPanel({ lane, onWorkOrderSubmitted, rcaStarted = false }: { lane: Lane; onWorkOrderSubmitted?: (lane: Lane) => void; rcaStarted?: boolean }) {
  const [ctx, setCtx] = useState<MaintenanceContext | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [recommendedStaffId, setRecommendedStaffId] = useState<string | null>(null);

  useEffect(() => {
    setSubmitted(false);
    setSelectedStaff(new Set());
    setRecommendedStaffId(null);
    getMaintenanceContext(lane.id).then(setCtx);
  }, [lane.id]);

  useEffect(() => {
    if (!ctx || !rcaStarted) return;
    const preferred = ctx.staff.find((s) => s.id === "TECH-212" && s.available);
    const fallback = ctx.staff.find((s) => s.available);
    const recommended = preferred ?? fallback ?? null;
    if (recommended) {
      setRecommendedStaffId(recommended.id);
      setSelectedStaff(new Set([recommended.id]));
    }
  }, [ctx, rcaStarted]);

  if (!ctx) return <div className="text-sm text-muted-foreground py-4 text-center">Loading maintenance context...</div>;

  if (submitted) {
    return (
      <div className="space-y-3">
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <div className="font-semibold text-green-900 dark:text-green-100">Mitigation Lane Created</div>
              <div className="text-sm text-green-700 dark:text-green-300 mt-1">
                Facility outage response lane configured for {lane.sourceAssetId ?? lane.origin} to protect {lane.destName ?? lane.dest}.
                {selectedStaff.size > 0 && ` ${selectedStaff.size} technician(s) assigned to response crew.`}
              </div>
              <div className="text-xs text-green-600 dark:text-green-400 mt-2 flex items-center gap-1">
                <Clock className="h-3 w-3" /> Temporary coverage expected within 6-12 hours
              </div>
            </div>
          </div>
        </div>
        <Button variant="outline" className="w-full" onClick={() => setSubmitted(false)}>Create Another Mitigation Lane</Button>
      </div>
    );
  }

  function toggleStaff(id: string) {
    setSelectedStaff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Wrench className="h-4 w-4 text-primary" />
        Unplanned Facility Outage Response - {lane.sourceAssetId ?? lane.origin}
      </div>

      {!rcaStarted ? (
        <div className="bg-card border rounded-lg p-3 text-sm text-muted-foreground flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          Run root cause analysis to unlock recommended response staff, inventory, and shutdown recovery playbooks.
        </div>
      ) : (
        <>
          {/* Historical Fixes */}
          <div className="bg-card border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
              <FileText className="h-3.5 w-3.5" /> Similar Historical Fixes
            </div>
            <div className="space-y-2">
              {ctx.historicalFixes.map((fix) => (
                <div key={fix.workOrderId} className="text-xs border-l-2 border-primary/30 pl-2">
                  <div className="font-medium">{fix.workOrderId} — {fix.date}</div>
                  <div className="text-muted-foreground">{fix.summary}</div>
                  <div className="text-primary/70 mt-0.5">Resolved in {fix.resolutionDays} day(s)</div>
                </div>
              ))}
            </div>
          </div>

          {/* Staff */}
          <div className="bg-card border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
              <User className="h-3.5 w-3.5" /> Assign Staff
            </div>
            <div className="space-y-1.5">
              {ctx.staff.map((s: StaffAssignment) => (
                <label
                  key={s.id}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded-md border text-sm cursor-pointer transition-colors",
                    selectedStaff.has(s.id) ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                    !s.available && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedStaff.has(s.id)}
                    onChange={() => s.available && toggleStaff(s.id)}
                    disabled={!s.available}
                    className="rounded"
                  />
                  <div className="flex-1">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground ml-1">— {s.role}</span>
                  </div>
                  {recommendedStaffId === s.id && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">Recommended</span>
                  )}
                  <span className={cn("text-xs", s.available ? "text-green-600" : "text-red-500")}>
                    {s.available ? "Available" : "Unavailable"}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Parts */}
          <div className="bg-card border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
              <Package className="h-3.5 w-3.5" /> Parts Inventory
            </div>
            <div className="space-y-1">
              {ctx.parts.map((p: PartsRequirement) => (
                <div key={p.sku} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                  <div>
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground ml-1">({p.sku})</span>
                  </div>
                  <div className="text-right">
                    <span className={cn("text-xs font-medium", p.qtyOnHand >= p.qtyNeeded ? "text-green-600" : "text-red-500")}>
                      {p.qtyOnHand}/{p.qtyNeeded} on hand
                    </span>
                    {p.qtyOnHand < p.qtyNeeded && (
                      <div className="text-[10px] text-orange-500">{p.leadTimeDays}d lead time</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Tech Docs */}
      <div className="flex flex-wrap gap-1.5">
        {ctx.techDocLinks.map((doc) => (
          <span key={doc.title} className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
            {doc.title}
          </span>
        ))}
      </div>

      <Button className="w-full" onClick={() => { setSubmitted(true); onWorkOrderSubmitted?.(lane); }} disabled={selectedStaff.size === 0 || !rcaStarted}>
        <Wrench className="mr-2 h-4 w-4" />
        Create Mitigation Lane ({selectedStaff.size} staff)
      </Button>
    </div>
  );
}
