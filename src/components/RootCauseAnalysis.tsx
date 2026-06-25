import { useEffect, useState } from "react";
import { AlertTriangle, Brain, CheckCircle2 } from "lucide-react";
import type { Incident } from "@/types/domain";
import { getRootCauseSummary } from "@/lib/energyApi";

export default function RootCauseAnalysis({ incidents, laneId }: { incidents: Incident[]; laneId?: string }) {
  const [summary, setSummary] = useState("Generating root-cause summary...");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!laneId) {
      setSummary("Lane context is unavailable for RCA summary.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSummary("Generating root-cause summary...");
    void getRootCauseSummary(laneId, incidents)
      .then((text) => {
        if (!cancelled) setSummary(text);
      })
      .catch(() => {
        if (!cancelled) setSummary("RCA summary is temporarily unavailable. Please retry in a moment.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [incidents, laneId]);

  return (
    <div className="border rounded-lg overflow-hidden bg-gradient-to-br from-purple-500/5 to-blue-500/5">
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-3">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-white" />
          <span className="font-semibold text-white">SupplyOps AI Root Cause Analysis</span>
        </div>
      </div>

      <div className="p-4">
        <div className="bg-background border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            Analyzing lane {laneId ?? "Unknown"} with {incidents.length} active incident(s).
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-orange-500 flex-shrink-0" />
            <div className="text-sm whitespace-pre-wrap">{loading ? "Generating root-cause summary..." : summary}</div>
          </div>
        </div>
      </div>

      <div className="border-t bg-muted/30 px-4 py-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>SupplyOps AI Analysis</span>
          <span className="text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Complete</span>
        </div>
      </div>
    </div>
  );
}
