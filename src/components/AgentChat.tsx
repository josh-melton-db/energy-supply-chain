import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useLocation } from "react-router-dom";
import { Bot, Minimize2, Plus, Send, Sparkles, Zap } from "lucide-react";
import { useAgentChat } from "@/lib/AgentChatContext";
import { useScenario } from "@/lib/ScenarioContext";
import { isScenarioActive } from "@/lib/scenarioEngine";
import { cn } from "@/lib/utils";

export default function AgentChat() {
  const {
    state: { messages, minimized, loading, lastAction, suggestedFollowups },
    setMinimized,
    sendMessage,
    clearChat,
    activeKpi,
    selectedLane,
    rcaStarted,
    workOrderSubmitted,
  } = useAgentChat();

  const location = useLocation();
  const { scenario } = useScenario();
  const scenarioActive = isScenarioActive(scenario);
  const topClass = scenarioActive && location.pathname === "/" ? "top-[112px]" : "top-[72px]";
  const maxHClass = scenarioActive && location.pathname === "/" ? "max-h-[calc(100vh-130px)]" : "max-h-[calc(100vh-90px)]";

  // Auto-minimize on simulator tab, re-expand on home
  useEffect(() => {
    if (location.pathname === "/simulator") setMinimized(true);
    else if (location.pathname === "/") setMinimized(false);
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestedPrompts = useMemo(() => {
    if (suggestedFollowups.length > 0) {
      return suggestedFollowups.slice(0, 4);
    }

    const prompts: string[] = [];
    const laneName = selectedLane?.destName ?? selectedLane?.dest;
    const hasLane = !!selectedLane;

    if (activeKpi === "risk") {
      if (hasLane) {
        prompts.push(`What's the biggest risk on ${laneName}'s lane?`);
        if (!rcaStarted) prompts.push("Analyze root cause of disruptions");
        if (rcaStarted && !workOrderSubmitted) prompts.push("Assign a work order for this lane");
      }
      prompts.push("Which lanes have critical technical status?");
    } else if (activeKpi === "forecastDiscrepancy") {
      prompts.push("Top lane for excess supply");
      prompts.push("Top lane for supply shortage");
      if (hasLane) {
        prompts.push("Show demand opportunities for this lane");
        prompts.push("Purchase spot barrels for this lane");
      }
      prompts.push("Which lanes need partner purchase?");
    } else if (activeKpi === "totalLandedCost") {
      if (hasLane) {
        prompts.push(`What's driving landed cost on ${laneName}'s lane?`);
        prompts.push("Compare pipeline vs bulk trip costs");
      } else {
        prompts.push("Which lanes have the highest landed cost?");
      }
      prompts.push("What is the projected cost impact if demand drops 20%?");
    } else {
      prompts.push("What are the top opportunities to improve margin?");
      prompts.push("What is driving the forecast variance this month?");
      if (hasLane) prompts.push(`What's the margin breakdown for ${laneName}?`);
      prompts.push("Which products are under the most margin pressure?");
    }

    return prompts.slice(0, 4);
  }, [suggestedFollowups, activeKpi, selectedLane, rcaStarted, workOrderSubmitted]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!minimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [minimized]);

  useEffect(() => {
    if (!minimized && !loading) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [selectedLane, activeKpi, messages, loading, minimized]);

  useEffect(() => {
    if (minimized) return;
    const refocus = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const isNativeSelect = !!target.closest("select");
      const isDropdownTrigger = !!target.closest("[aria-haspopup='listbox'], [role='combobox']");
      const isDropdownContent = !!target.closest("[role='listbox'], [data-radix-select-content], [data-radix-popper-content-wrapper]");
      const isDropdownOption = !!target.closest("[role='option']");

      // Avoid stealing focus while user opens/interacts with dropdown filters.
      // Refocus only once an option is actually clicked.
      if (isNativeSelect || ((isDropdownTrigger || isDropdownContent) && !isDropdownOption)) return;

      setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener("mouseup", refocus);
    return () => window.removeEventListener("mouseup", refocus);
  }, [minimized]);

  useEffect(() => {
    if (minimized) return;
    const refocusOnSelection = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.closest("select, [role='option']")) return;
      setTimeout(() => inputRef.current?.focus(), 0);
    };
    // Capture phase so we catch selections even if inner handlers stop propagation.
    window.addEventListener("change", refocusOnSelection, true);
    return () => window.removeEventListener("change", refocusOnSelection, true);
  }, [minimized]);

  const handleSend = (text: string) => {
    if (!text.trim() || loading) return;
    setInput("");
    sendMessage(text.trim());
  };

  // Minimized floating icon
  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className={cn(
          `fixed ${topClass} left-4 z-40 flex items-center gap-2 rounded-full shadow-lg`,
          "bg-gradient-to-r from-blue-600 to-indigo-600 text-white",
          "px-3 py-2.5 hover:shadow-xl transition-all hover:scale-105",
          "group",
        )}
      >
        <Bot className="h-5 w-5" />
        <span className="text-sm font-medium max-w-0 overflow-hidden group-hover:max-w-[120px] transition-all duration-300 whitespace-nowrap">
          AI Agent
        </span>
      </button>
    );
  }

  return (
    <div className={`fixed ${topClass} left-4 z-40 w-[380px] ${maxHClass} flex flex-col rounded-xl shadow-2xl border bg-card overflow-hidden animate-in slide-in-from-left-2 duration-200`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
        <Bot className="h-5 w-5" />
        <span className="font-semibold text-sm flex-1">SupplyOps AI Agent</span>
        <button onClick={clearChat} className="p-1 rounded hover:bg-white/20 transition-colors" title="New chat">
          <Plus className="h-4 w-4" />
        </button>
        <button onClick={() => setMinimized(true)} className="p-1 rounded hover:bg-white/20 transition-colors" title="Minimize">
          <Minimize2 className="h-4 w-4" />
        </button>
      </div>

      {/* Action toast */}
      {lastAction && Date.now() - lastAction.timestamp < 4000 && (
        <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs animate-in fade-in duration-300">
          <Zap className="h-3.5 w-3.5 text-emerald-600 animate-pulse" />
          <span className="font-medium">AI executed: {lastAction.label}</span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 max-h-[400px]">
        {messages.length === 0 && (
          <div className="text-center py-6">
            <Sparkles className="h-8 w-8 mx-auto mb-2 text-primary/30" />
            <p className="text-sm text-muted-foreground mb-3">
              Ask me anything about your lanes, or tell me to take an action.
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {suggestedPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSend(prompt)}
                  className="text-xs px-2.5 py-1.5 rounded-full border bg-card hover:bg-accent transition-colors text-left"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : msg.aiInitiated
                    ? "bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800"
                    : "bg-muted",
              )}
            >
              {msg.aiInitiated && (
                <div className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mb-1">
                  <Zap className="h-3 w-3" />
                  Action Taken
                </div>
              )}
              {msg.role === "assistant" ? (
                <div className="agent-markdown prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                <div className="whitespace-pre-wrap">{msg.content}</div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-3 py-2 text-sm">
              <span className="inline-flex gap-1">
                <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </span>
            </div>
          </div>
        )}

        {messages.length > 0 && !loading && (
          <div className="flex flex-wrap gap-1.5">
            {suggestedPrompts
              .filter((p) => !messages.some((m) => m.content === p))
              .slice(0, 2)
              .map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSend(prompt)}
                  className="text-xs px-2 py-1 rounded-full border bg-card hover:bg-accent transition-colors"
                >
                  {prompt}
                </button>
              ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t p-2">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend(input)}
            placeholder="Ask a question or request an action..."
            className="flex-1 text-sm px-3 py-1.5 rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={() => handleSend(input)}
            disabled={!input.trim() || loading}
            className="p-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <div className="text-[10px] text-muted-foreground/60 text-center mt-1">
          Powered by Databricks AI
        </div>
      </div>
    </div>
  );
}
