import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { KpiMode, Lane } from "@/types/domain";
import { getTlcPartnerPurchaseOptions } from "@/lib/energyApi";

export type AgentChatMessage = {
  role: "user" | "assistant";
  content: string;
  action?: string;
  aiInitiated?: boolean;
};

export type AgentChatState = {
  messages: AgentChatMessage[];
  minimized: boolean;
  loading: boolean;
  lastAction: { id: string; label: string; timestamp: number } | null;
  suggestedFollowups: string[];
};

type ActionHandlers = {
  assignWorkOrder: () => void;
  partnerPurchase: () => void;
  orderXTpd: (tpd: number) => void;
  analyzeRootCause: () => void;
  selectLane: (laneId: string) => void;
  selectKpi: (kpi: KpiMode) => void;
};

type LaneCandidate = {
  id: string;
  destName?: string;
  dest?: string;
  totalLandedCostPerTon?: number;
  forecastDiscrepancyPct?: number;
  daysToZero?: number;
  profitabilityPct?: number;
  technicalStatus?: string;
};

type ReferenceMemory = {
  lastLaneIds: string[];
  lastKpi: KpiMode | null;
};

type AgentContextValue = {
  state: AgentChatState;
  setMinimized: (v: boolean) => void;
  sendMessage: (text: string) => Promise<void>;
  clearChat: () => void;
  selectedLane: Lane | null;
  setSelectedLane: (lane: Lane | null) => void;
  activeKpi: KpiMode;
  setActiveKpi: (kpi: KpiMode) => void;
  actionHandlers: ActionHandlers;
  setActionHandlers: (handlers: Partial<ActionHandlers>) => void;
  setVisibleLanes: (lanes: LaneCandidate[]) => void;
  rcaStarted: boolean;
  setRcaStarted: (v: boolean) => void;
  workOrderSubmitted: boolean;
  setWorkOrderSubmitted: (v: boolean) => void;
};

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8001/api";

const noop = () => {};
const defaultHandlers: ActionHandlers = {
  assignWorkOrder: noop,
  partnerPurchase: noop,
  orderXTpd: noop,
  analyzeRootCause: noop,
  selectLane: noop,
  selectKpi: noop,
};

const AgentChatCtx = createContext<AgentContextValue>({
  state: { messages: [], minimized: true, loading: false, lastAction: null, suggestedFollowups: [] },
  setMinimized: noop,
  sendMessage: async () => {},
  clearChat: noop,
  selectedLane: null,
  setSelectedLane: noop,
  activeKpi: "profitability",
  setActiveKpi: noop,
  actionHandlers: defaultHandlers,
  setActionHandlers: noop,
  setVisibleLanes: noop,
  rcaStarted: false,
  setRcaStarted: noop,
  workOrderSubmitted: false,
  setWorkOrderSubmitted: noop,
});

function buildAvailableActions(
  activeKpi: KpiMode,
  selectedLane: Lane | null,
  rcaStarted: boolean,
  workOrderSubmitted: boolean,
): string[] {
  const actions: string[] = ["ask_genie"];
  actions.push("select_lane");
  actions.push("select_kpi");

  if (activeKpi === "forecastDiscrepancy" && selectedLane) {
    actions.push("show_demand_opportunities");
    actions.push("partner_purchase");
  }

  if (activeKpi === "risk" && selectedLane) {
    if (!rcaStarted) actions.push("analyze_root_cause");
    if (rcaStarted && !workOrderSubmitted) actions.push("assign_work_order");
  }

  if (activeKpi === "totalLandedCost" && selectedLane) {
    actions.push("order_x_tpd");
    actions.push("partner_purchase");
  }

  return actions;
}

function buildVisibleContext(
  activeKpi: KpiMode,
  selectedLane: Lane | null,
  visibleLanes: LaneCandidate[],
): Record<string, unknown> {
  const ctx: Record<string, unknown> = { activeKpi };
  ctx.genie = {
    metricViews: [
      "demos.industrials_optimization.production_metrics",
      "demos.industrials_optimization.consumption_metrics",
      "demos.industrials_optimization.contract_metrics",
      "demos.industrials_optimization.financial_metrics",
      "demos.industrials_optimization.forecast_metrics",
      "demos.industrials_optimization.profitability_metrics",
    ],
  };
  ctx.visibleLanes = visibleLanes.slice(0, 200);

  if (selectedLane) {
    const tlcPartnerOptions = activeKpi === "totalLandedCost"
      ? getTlcPartnerPurchaseOptions(selectedLane).map((o) => ({
          vendorName: o.vendorName,
          pricePerTonUsd: o.pricePerTonUsd,
          availableCapacityTpd: o.availableCapacityTpd,
          etaHours: o.etaHours,
          cheaperThanLane: (o.pricePerTonUsd < (selectedLane.totalLandedCostPerTon ?? 150)),
        }))
      : [];
    ctx.selectedLane = {
      id: selectedLane.id,
      origin: selectedLane.origin,
      dest: selectedLane.dest,
      destName: selectedLane.destName,
      product: selectedLane.product,
      mode: selectedLane.mode,
      totalLandedCostPerTon: selectedLane.totalLandedCostPerTon,
      forecastDiscrepancyPct: selectedLane.forecastDiscrepancyPct,
      supplyTpd: selectedLane.supplyTpd,
      demandTpd: selectedLane.demandTpd,
      profitabilityPct: selectedLane.profitabilityPct,
      avgDailyVolume: selectedLane.avgDailyVolume,
      technicalStatus: selectedLane.technicalStatus,
      onTimePct: selectedLane.onTimePct,
      slaRiskPct: selectedLane.slaRiskPct,
      contractId: selectedLane.contractId,
      tlcPartnerOptions,
    };
  }

  return ctx;
}

const ACTION_LABELS: Record<string, string> = {
  ask_genie: "Ask Genie",
  select_lane: "Select Lane",
  select_kpi: "Select KPI",
  assign_work_order: "Create Mitigation Lane",
  partner_purchase: "Partner Purchase",
  show_demand_opportunities: "Show Demand Opportunities",
  order_x_tpd: "Order X TPD",
  analyze_root_cause: "Analyze Root Cause",
};

const ACTION_KEY_MAP: Record<string, keyof ActionHandlers> = {
  select_lane: "selectLane",
  select_kpi: "selectKpi",
  assign_work_order: "assignWorkOrder",
  partner_purchase: "partnerPurchase",
  show_demand_opportunities: "partnerPurchase",
  order_x_tpd: "orderXTpd",
  analyze_root_cause: "analyzeRootCause",
};

export function AgentChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [minimized, setMinimized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastAction, setLastAction] = useState<AgentChatState["lastAction"]>(null);
  const [suggestedFollowups, setSuggestedFollowups] = useState<string[]>([]);
  const [selectedLane, setSelectedLane] = useState<Lane | null>(null);
  const [activeKpi, setActiveKpi] = useState<KpiMode>("profitability");
  const [handlers, setHandlers] = useState<ActionHandlers>(defaultHandlers);
  const [rcaStarted, setRcaStarted] = useState(false);
  const [workOrderSubmitted, setWorkOrderSubmitted] = useState(false);
  const [genieConversationId, setGenieConversationId] = useState<string | null>(null);
  const [visibleLanes, setVisibleLanes] = useState<LaneCandidate[]>([]);
  const [referenceMemory, setReferenceMemory] = useState<ReferenceMemory>({
    lastLaneIds: [],
    lastKpi: null,
  });

  const setActionHandlers = useCallback((partial: Partial<ActionHandlers>) => {
    setHandlers((prev) => ({ ...prev, ...partial }));
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setLastAction(null);
    setGenieConversationId(null);
    setReferenceMemory({ lastLaneIds: [], lastKpi: null });
    setSuggestedFollowups([]);
  }, []);

  const extractLaneIds = useCallback((text: string): string[] => {
    const matches = text.match(/HUB-\d{3}-CUST-\d{4}-(?:CRD|NGL|LNG)/g) ?? [];
    return Array.from(new Set(matches));
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const userMsg: AgentChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const availableActions = buildAvailableActions(
        activeKpi, selectedLane, rcaStarted, workOrderSubmitted,
      );
      const context = buildVisibleContext(activeKpi, selectedLane, visibleLanes);
      const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch(`${BACKEND_URL}/agent/orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          available_actions: availableActions,
          context,
          history,
          genie_conversation_id: genieConversationId,
          reference_memory: referenceMemory,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const action: string = data.action ?? "no_action";
      const actionArgs = (data.action_args ?? {}) as Record<string, unknown>;
      const nextGenieConversationId: string | null = data.genie_conversation_id ?? null;
      if (nextGenieConversationId) {
        setGenieConversationId(nextGenieConversationId);
      }

      if (action === "ask_genie") {
        const laneIds = extractLaneIds(data.text ?? "");
        if (laneIds.length > 0) {
          setReferenceMemory((prev) => ({ ...prev, lastLaneIds: laneIds }));
        }
        const followups = Array.isArray(data.suggested_followups)
          ? data.suggested_followups.filter((q: unknown) => typeof q === "string").slice(0, 4)
          : [];
        setSuggestedFollowups(followups);
        const assistantMsg: AgentChatMessage = {
          role: "assistant",
          content: data.text || "Genie did not return a response.",
        };
        setMessages((prev) => [...prev, assistantMsg]);
        return;
      }

      if (action !== "no_action" && availableActions.includes(action)) {
        setSuggestedFollowups([]);
        const handlerKey = ACTION_KEY_MAP[action];
        if (handlerKey && handlers[handlerKey]) {
          if (action === "select_lane") {
            const laneId = typeof actionArgs.lane_id === "string" ? actionArgs.lane_id : "";
            const laneExists = visibleLanes.some((l) => l.id === laneId);
            if (laneId && laneExists) {
              handlers.selectLane(laneId);
              setReferenceMemory((prev) => ({ ...prev, lastLaneIds: [laneId] }));
            } else {
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: "I couldn't find that lane in the current view. Please name the lane explicitly." },
              ]);
              return;
            }
          } else if (action === "select_kpi") {
            const validKpis: KpiMode[] = ["risk", "forecastDiscrepancy", "totalLandedCost", "profitability"];
            const kpiArg = actionArgs.kpi;
            if (typeof kpiArg === "string" && (validKpis as string[]).includes(kpiArg)) {
              const kpi = kpiArg as KpiMode;
              handlers.selectKpi(kpi);
              setReferenceMemory((prev) => ({ ...prev, lastKpi: kpi }));
            } else {
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: "I need a valid KPI to select (risk, forecast discrepancy, total landed cost, or profitability)." },
              ]);
              return;
            }
          } else if (action === "assign_work_order") {
            handlers.assignWorkOrder();
          } else if (action === "partner_purchase" || action === "show_demand_opportunities") {
            handlers.partnerPurchase();
          } else if (action === "order_x_tpd") {
            const tpdArg = actionArgs.tpd;
            const tpd = typeof tpdArg === "number" ? tpdArg : (typeof tpdArg === "string" ? Number(tpdArg) : NaN);
            if (Number.isFinite(tpd) && tpd > 0) {
              handlers.orderXTpd(tpd);
            } else {
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: "I need a positive TPD amount to place the order." },
              ]);
              return;
            }
          } else if (action === "analyze_root_cause") {
            handlers.analyzeRootCause();
          }
        }

        const label = ACTION_LABELS[action] ?? action;
        setLastAction({ id: action, label, timestamp: Date.now() });

        const assistantMsg: AgentChatMessage = {
          role: "assistant",
          content: data.reason || `Executing: ${label}`,
          action,
          aiInitiated: true,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        setSuggestedFollowups([]);
        const laneIds = extractLaneIds(data.text ?? "");
        if (laneIds.length > 0) {
          setReferenceMemory((prev) => ({ ...prev, lastLaneIds: laneIds }));
        }
        const assistantMsg: AgentChatMessage = {
          role: "assistant",
          content: data.text || "I couldn't process that request.",
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I had trouble reaching the AI service. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }, [activeKpi, selectedLane, rcaStarted, workOrderSubmitted, messages, handlers, genieConversationId, visibleLanes, referenceMemory, extractLaneIds]);

  return (
    <AgentChatCtx.Provider
      value={{
        state: { messages, minimized, loading, lastAction, suggestedFollowups },
        setMinimized,
        sendMessage,
        clearChat,
        selectedLane,
        setSelectedLane,
        activeKpi,
        setActiveKpi,
        actionHandlers: handlers,
        setActionHandlers,
        setVisibleLanes,
        rcaStarted,
        setRcaStarted,
        workOrderSubmitted,
        setWorkOrderSubmitted,
      }}
    >
      {children}
    </AgentChatCtx.Provider>
  );
}

export function useAgentChat() {
  return useContext(AgentChatCtx);
}
