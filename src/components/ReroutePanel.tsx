import { useEffect, useState } from "react";
import { ArrowRight, Clock, DollarSign, Package, PartyPopper, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDuration } from "@/lib/format";
import { getEnergyIncidents, getEnergyMitigationOptions, getEnergyUrgentSupplyTickets } from "@/lib/energyApi";
import { setMitigationOverride, type MitigationOverride } from "@/lib/sessionState";
import type { Incident, RerouteSuggestion, Shipment } from "@/types/domain";

interface Props {
  laneId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (laneId: string, override: MitigationOverride) => void;
}

export default function ReroutePanel({ laneId, open, onOpenChange, onComplete }: Props) {
  const [options, setOptions] = useState<RerouteSuggestion[]>([]);
  const [tickets, setTickets] = useState<Shipment[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<RerouteSuggestion | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelected(null);
    Promise.all([getEnergyMitigationOptions(laneId), getEnergyUrgentSupplyTickets(laneId), getEnergyIncidents(laneId)]).then(
      ([mitigations, supplyTickets, laneIncidents]) => {
        setOptions(mitigations);
        setTickets(supplyTickets);
        setIncidents(laneIncidents);
        setLoading(false);
      }
    );
  }, [laneId, open]);

  const totalVolume = tickets.reduce((sum, ticket) => sum + (ticket.requestedVolumeTons ?? 0), 0);

  if (!open) return null;

  const handleApply = (option: RerouteSuggestion) => {
    setSelected(option);
    const override: MitigationOverride = {
      strategy: option.strategy,
      securedVolumeTpd: totalVolume,
      addedCostUsd: option.addedCostUSD,
    };
    setMitigationOverride(laneId, override);
  };

  const handleDone = () => {
    if (selected) {
      const override: MitigationOverride = {
        strategy: selected.strategy,
        securedVolumeTpd: totalVolume,
        addedCostUsd: selected.addedCostUSD,
      };
      onComplete?.(laneId, override);
    }
    onOpenChange(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex justify-end">
      <div className="w-[520px] h-full bg-background border-l shadow-xl overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{selected ? "Mitigation Applied" : "Supply Replenishment"}</h3>
          <button onClick={() => onOpenChange(false)} className="p-1 rounded hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        {selected ? (
          <div className="space-y-5">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <PartyPopper className="h-5 w-5 text-green-600 mt-0.5" />
                <div>
                  <div className="font-semibold text-green-900 mb-1">Secured {totalVolume.toLocaleString()} tons of critical supply</div>
                  <div className="text-sm text-green-700">
                    {incidents.length > 0 ? `Mitigation applied for ${incidents[0].cause.slice(0, 80).toLowerCase()}...` : "Mitigation plan applied successfully."}
                  </div>
                  <div className="text-xs text-green-600 mt-1">Lane status will be updated to Stable.</div>
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4 space-y-3">
              <div className="font-semibold">Plan Summary</div>
              <div className="text-sm">{selected.strategy}</div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><ArrowRight className="h-4 w-4" />Lane {laneId}</div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground"><Clock className="h-4 w-4" />Time Impact</div>
                <div className="text-xl font-bold text-orange-600">+{formatDuration(selected.deltaETAminutes)}</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground"><DollarSign className="h-4 w-4" />Added Cost</div>
                <div className="text-xl font-bold">{formatCurrency(selected.addedCostUSD)}</div>
              </div>
            </div>

            <Button className="w-full" size="lg" onClick={handleDone}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2"><Package className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-medium">At-Risk Contract Volume</span></div>
              <div className="text-2xl font-bold">{totalVolume.toLocaleString()} tons/day</div>
              <div className="text-xs text-muted-foreground">Across {tickets.length} critical demand tickets</div>
            </div>

            {loading ? (
              <div className="text-center py-8 text-muted-foreground">Loading options...</div>
            ) : (
              <div className="space-y-3">
                {options.map((option) => (
                  <div key={option.strategy} className="border rounded-lg p-4 space-y-3">
                    <div className="font-semibold">{option.strategy}</div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div><div className="text-xs text-muted-foreground">ETA Change</div><div className="font-medium">+{formatDuration(option.deltaETAminutes)}</div></div>
                      <div><div className="text-xs text-muted-foreground">Added Cost</div><div className="font-medium">{formatCurrency(option.addedCostUSD)}</div></div>
                    </div>
                    <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">{option.notes}</div>
                    <Button className="w-full" onClick={() => handleApply(option)}>Apply this mitigation<ArrowRight className="ml-2 h-4 w-4" /></Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
