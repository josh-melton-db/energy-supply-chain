import { formatDate } from "@/lib/format";
import type { Incident } from "@/types/domain";
import { Activity, AlertTriangle, Cloud, Factory, Gauge, Waves } from "lucide-react";

const displayMap = {
  facility_outage: { icon: Factory, label: "Facility Outage", color: "text-red-500", bg: "bg-red-500/20" },
  vibration_anomaly: { icon: Activity, label: "Vibration Anomaly", color: "text-amber-500", bg: "bg-amber-500/20" },
  weather_disruption: { icon: Cloud, label: "Weather Disruption", color: "text-purple-500", bg: "bg-purple-500/20" },
  pipeline_constraint: { icon: Waves, label: "Pipeline Constraint", color: "text-cyan-500", bg: "bg-cyan-500/20" },
  inventory_critical: { icon: Gauge, label: "Inventory Critical", color: "text-orange-500", bg: "bg-orange-500/20" },
  supply_shortfall: { icon: AlertTriangle, label: "Supply Shortfall", color: "text-red-500", bg: "bg-red-500/20" },
} as const;

export default function IncidentTimeline({ incidents }: { incidents: Incident[] }) {
  return (
    <div className="space-y-3">
      {incidents.map((incident, idx) => {
        const display = displayMap[incident.type] ?? displayMap.supply_shortfall;
        const Icon = display.icon;
        return (
          <div key={`${incident.ref}-${idx}`} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={`rounded-full p-2 ${display.bg}`}><Icon className={`h-4 w-4 ${display.color}`} /></div>
              {idx < incidents.length - 1 && <div className="w-0.5 flex-1 bg-border my-1 min-h-4" />}
            </div>
            <div className="flex-1 pb-3">
              <div className="font-medium text-sm">{display.label}</div>
              <div className="text-sm text-muted-foreground">{incident.ref}</div>
              <div className="text-sm mt-1">{incident.cause}</div>
              {incident.recommendedAction && (
                <div className="text-xs mt-1.5 px-2 py-1 rounded bg-primary/5 border border-primary/10 text-primary">
                  <span className="font-medium">Action:</span> {incident.recommendedAction}
                </div>
              )}
              <div className="text-xs text-muted-foreground mt-1">{formatDate(incident.timestamp)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
