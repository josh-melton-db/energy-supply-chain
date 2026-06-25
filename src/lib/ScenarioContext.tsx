import { createContext, useContext, useState, type ReactNode } from "react";
import type { ScenarioParams } from "@/types/domain";
import { DEFAULT_SCENARIO } from "@/types/domain";

type ScenarioContextValue = {
  scenario: ScenarioParams;
  setScenario: (params: ScenarioParams) => void;
  resetScenario: () => void;
};

const ScenarioContext = createContext<ScenarioContextValue>({
  scenario: DEFAULT_SCENARIO,
  setScenario: () => {},
  resetScenario: () => {},
});

export function ScenarioProvider({ children }: { children: ReactNode }) {
  const [scenario, setScenario] = useState<ScenarioParams>(DEFAULT_SCENARIO);
  const resetScenario = () => setScenario(DEFAULT_SCENARIO);
  return (
    <ScenarioContext.Provider value={{ scenario, setScenario, resetScenario }}>
      {children}
    </ScenarioContext.Provider>
  );
}

export function useScenario() {
  return useContext(ScenarioContext);
}
