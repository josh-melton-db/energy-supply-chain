// ---------------------------------------------------------------------------
// Session-storage key constants (grouped at top so all functions can reference)
// ---------------------------------------------------------------------------

const LD_OVERRIDE_KEY = "ld-override-";
const MITIGATION_KEY = "mitigated-";
const DEMO_ACTION_KEY = "demo-actions";
const QUOTE_KEY = "submitted-quotes";
const TLC_PURCHASE_KEY = "tlc-purchase-";

export function clearAllSessionState(): void {
  try {
    sessionStorage.clear();
    localStorage.removeItem("gulf-coast-operations-state");
  } catch (error) {
    console.warn("Unable to clear session state", error);
  }
}

// ---------------------------------------------------------------------------
// LD Override
// ---------------------------------------------------------------------------

export type LdOverride = {
  orderedCapacityTpd: number;
  vendorName: string;
  reducedLdExposureUsd: number;
  reducedGapTpd: number;
};

export function setLdOverride(laneId: string, override: LdOverride): void {
  try {
    sessionStorage.setItem(LD_OVERRIDE_KEY + laneId, JSON.stringify(override));
  } catch { /* noop */ }
}

export function getLdOverride(laneId: string): LdOverride | null {
  try {
    const raw = sessionStorage.getItem(LD_OVERRIDE_KEY + laneId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearLdOverride(laneId: string): void {
  try {
    sessionStorage.removeItem(LD_OVERRIDE_KEY + laneId);
  } catch { /* noop */ }
}

export function clearAllLdOverrides(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(LD_OVERRIDE_KEY)) keys.push(key);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// TLC Partner Purchase Override
// ---------------------------------------------------------------------------

export type TlcPurchaseOverride = {
  vendorName: string;
  pricePerTonUsd: number;
  availableCapacityTpd: number;
  etaHours: number;
  securedVolumeTpd: number;
  originalTlcPerTon: number;
  adjustedTlcPerTon: number;
};

export function setTlcPurchaseOverride(laneId: string, override: TlcPurchaseOverride): void {
  try {
    sessionStorage.setItem(TLC_PURCHASE_KEY + laneId, JSON.stringify(override));
  } catch { /* noop */ }
}

export function getTlcPurchaseOverride(laneId: string): TlcPurchaseOverride | null {
  try {
    const raw = sessionStorage.getItem(TLC_PURCHASE_KEY + laneId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearTlcPurchaseOverride(laneId: string): void {
  try {
    sessionStorage.removeItem(TLC_PURCHASE_KEY + laneId);
  } catch { /* noop */ }
}

export function clearAllTlcPurchaseOverrides(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(TLC_PURCHASE_KEY)) keys.push(key);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Mitigation Override
// ---------------------------------------------------------------------------

export type MitigationOverride = {
  strategy: string;
  securedVolumeTpd: number;
  addedCostUsd: number;
};

export function setMitigationOverride(laneId: string, override: MitigationOverride): void {
  try {
    sessionStorage.setItem(MITIGATION_KEY + laneId, JSON.stringify(override));
  } catch { /* noop */ }
}

export function getMitigationOverride(laneId: string): MitigationOverride | null {
  try {
    const raw = sessionStorage.getItem(MITIGATION_KEY + laneId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearMitigationOverride(laneId: string): void {
  try {
    sessionStorage.removeItem(MITIGATION_KEY + laneId);
  } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Aggregate helpers
// ---------------------------------------------------------------------------

export function countSessionOverrides(): number {
  let count = 0;
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (
        key?.startsWith(LD_OVERRIDE_KEY)
        || key?.startsWith(MITIGATION_KEY)
        || key?.startsWith(TLC_PURCHASE_KEY)
        || key === SESSION_LANES_KEY
      ) count++;
    }
  } catch { /* noop */ }
  return count;
}

export function clearAllOverrides(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (
        key?.startsWith(LD_OVERRIDE_KEY)
        || key?.startsWith(MITIGATION_KEY)
        || key?.startsWith(TLC_PURCHASE_KEY)
        || key === SESSION_LANES_KEY
      ) keys.push(key);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
    sessionStorage.removeItem(DEMO_ACTION_KEY);
    sessionStorage.removeItem(QUOTE_KEY);
  } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Session action tracking — fixed margin uplifts per completed action (reference UI state)
// ---------------------------------------------------------------------------

export type DemoActionType = "quoteSubmitted" | "workOrderAssigned" | "supplyReplenishment" | "partnerPurchase";

const MARGIN_UPLIFT: Record<DemoActionType, number> = {
  quoteSubmitted: 0.3,
  workOrderAssigned: 0.2,
  supplyReplenishment: 0.4,
  partnerPurchase: 0.3,
};

function loadDemoActions(): DemoActionType[] {
  try {
    const raw = sessionStorage.getItem(DEMO_ACTION_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveDemoActions(actions: DemoActionType[]): void {
  try { sessionStorage.setItem(DEMO_ACTION_KEY, JSON.stringify(actions)); } catch { /* noop */ }
}

export function recordDemoAction(action: DemoActionType): void {
  const actions = loadDemoActions();
  actions.push(action);
  saveDemoActions(actions);
}

export function getDemoActions(): DemoActionType[] {
  return loadDemoActions();
}

export function getTotalMarginUplift(): number {
  return loadDemoActions().reduce((sum, a) => sum + MARGIN_UPLIFT[a], 0);
}

export function clearDemoActions(): void {
  try { sessionStorage.removeItem(DEMO_ACTION_KEY); } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Quote Submission Tracking — persists across lane navigation
// ---------------------------------------------------------------------------

export function recordSubmittedQuote(opportunityId: string): void {
  try {
    const ids = getSubmittedQuotes();
    ids.add(opportunityId);
    sessionStorage.setItem(QUOTE_KEY, JSON.stringify([...ids]));
  } catch { /* noop */ }
}

export function getSubmittedQuotes(): Set<string> {
  try {
    const raw = sessionStorage.getItem(QUOTE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

export function clearSubmittedQuotes(): void {
  try { sessionStorage.removeItem(QUOTE_KEY); } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Session Lanes — new arcs added interactively (demand opportunities, partner purchases)
// ---------------------------------------------------------------------------

const SESSION_LANES_KEY = "session-lanes";

export type SessionLane = {
  id: string;
  origin: string;
  originLat: number;
  originLng: number;
  dest: string;
  destLat: number;
  destLng: number;
  mode: "truck";
  product: string;
  avgDailyVolume: number;
  totalLandedCostPerTon: number;
  forecastDiscrepancyPct: number;
  sourceLabel: string;
};

export function addSessionLane(lane: SessionLane): void {
  try {
    const existing = getSessionLanes();
    if (existing.some((l) => l.id === lane.id)) return;
    existing.push(lane);
    sessionStorage.setItem(SESSION_LANES_KEY, JSON.stringify(existing));
  } catch { /* noop */ }
}

export function getSessionLanes(): SessionLane[] {
  try {
    const raw = sessionStorage.getItem(SESSION_LANES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function clearSessionLanes(): void {
  try { sessionStorage.removeItem(SESSION_LANES_KEY); } catch { /* noop */ }
}
