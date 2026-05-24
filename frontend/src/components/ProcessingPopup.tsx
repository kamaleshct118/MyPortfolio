import { Loader2, Check, AlertTriangle, Cpu } from "lucide-react";
import type { ProcessingState } from "../types";


interface ProcessingPopupProps {
  state: ProcessingState;
  isOpen: boolean;
  onClose: () => void;
}

export default function ProcessingPopup({ state, isOpen, onClose }: ProcessingPopupProps) {
  if (!isOpen) return null;

  // List of standard sequential states
  const stages: { label: string; key: ProcessingState }[] = [
    { label: "Uploading File to Storage", key: "Uploading File" },
    { label: "AI Summary Generation (Pipeline 1)", key: "Generating Summary" },
    { label: "Chunking Original Text (Pipeline 2)", key: "Chunking Content" },
    { label: "Generating Vector Embeddings", key: "Generating Embeddings" },
    { label: "Saving Isolated Vector DB (FAISS)", key: "Saving to Vector DB" },
    { label: "RAG Pipeline Setup Complete", key: "RAG Processing Complete" },
  ];

  // Helper to determine the status of each stage
  const getStageStatus = (stageKey: ProcessingState, currentIndex: number) => {
    if (!state) return "pending";
    if (state === "Error") return "error";
    if (state === "RAG Processing Complete") return "completed";

    // Handle skip RAG state for project edit
    if (state === "Skipping RAG (Using cached index)") {
      if (stageKey === "Uploading File") return "completed";
      if (stageKey === "Generating Summary") return "completed";
      if (stageKey === "Chunking Content" || stageKey === "Generating Embeddings" || stageKey === "Saving to Vector DB") {
        return "skipped";
      }
      if (stageKey === "RAG Processing Complete") return "completed";
    }

    const stateOrder = [
      "Uploading File",
      "Generating Summary",
      "Chunking Content",
      "Generating Embeddings",
      "Saving to Vector DB",
      "RAG Processing Complete",
    ];

    const activeIndex = stateOrder.indexOf(state);
    
    if (activeIndex === -1) return "pending";
    if (currentIndex < activeIndex) return "completed";
    if (currentIndex === activeIndex) return "active";
    return "pending";
  };

  const isFailed = state === "Error";
  const isFinished = state === "RAG Processing Complete" || state === "Error";

  return (
    <div className="fixed inset-0 flex items-center justify-center font-sans bg-black/75 backdrop-blur-md" style={{ zIndex: 100 }}>
      {/* Container Card */}
      <div
        className="w-[440px] p-8 glass-panel text-left flex flex-col relative animate-float"
        style={{
          background: "rgba(18, 14, 34, 0.94)",
          border: "1px solid var(--border-glass)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
        }}
      >
        {/* Title & Decorative Icon */}
        <div className="flex items-center gap-3.5 mb-6">
          <div
            className={`p-3 rounded-2xl shrink-0 ${
              isFailed
                ? "bg-red-500/10 text-red-400 border border-red-500/20"
                : isFinished
                ? "bg-green-500/10 text-green-400 border border-green-500/20"
                : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
            }`}
          >
            {isFailed ? (
              <AlertTriangle className="w-6 h-6 animate-pulse" />
            ) : isFinished ? (
              <Check className="w-6 h-6" />
            ) : (
              <Cpu className="w-6 h-6 animate-spin" style={{ animationDuration: "3s" }} />
            )}
          </div>
          <div>
            <h3 className="text-lg font-bold text-white tracking-wide">
              {isFailed ? "RAG Engine Interrupted" : "AI Processing Pipeline"}
            </h3>
            <p className="text-xs text-text-secondary mt-0.5">
              {isFinished ? "Pipeline sequence finished" : "Executing parallel display & vector pipelines"}
            </p>
          </div>
        </div>

        {/* Stages Checklist */}
        <div className="space-y-4 mb-8">
          {stages.map((stage, idx) => {
            const status = getStageStatus(stage.key, idx);
            
            return (
              <div
                key={stage.key}
                className={`flex items-center gap-3.5 transition-opacity duration-300 ${
                  status === "pending" ? "opacity-35" : "opacity-100"
                }`}
              >
                {/* Status indicator icon/bullet */}
                <div className="shrink-0 flex items-center justify-center">
                  {status === "completed" && (
                    <div className="w-5 h-5 rounded-full bg-green-500/25 border border-green-500/35 text-green-400 flex items-center justify-center">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  )}
                  {status === "skipped" && (
                    <div className="w-5 h-5 rounded-full bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 flex items-center justify-center text-[10px] font-mono font-bold">
                      SKIP
                    </div>
                  )}
                  {status === "active" && (
                    <div className="w-5 h-5 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-400 flex items-center justify-center">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    </div>
                  )}
                  {status === "pending" && (
                    <div className="w-5 h-5 rounded-full bg-white/5 border border-white/10 text-text-muted flex items-center justify-center text-xs font-semibold">
                      {idx + 1}
                    </div>
                  )}
                  {status === "error" && (
                    <div className="w-5 h-5 rounded-full bg-red-500/25 border border-red-500/35 text-red-400 flex items-center justify-center">
                      <AlertTriangle className="w-3 h-3" />
                    </div>
                  )}
                </div>

                {/* Stage description text */}
                <div className="flex flex-col">
                  <span
                    className={`text-sm ${
                      status === "active"
                        ? "text-purple-300 font-semibold tracking-wide"
                        : status === "completed"
                        ? "text-white/90"
                        : "text-text-muted"
                    }`}
                  >
                    {stage.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Error Detail Display */}
        {isFailed && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/5 border border-red-500/25 text-red-300 text-xs leading-relaxed max-h-24 overflow-y-auto font-mono">
            {state === "Error" ? "Database constraint error or failed connection to Groq API." : "Unknown pipeline error occurred."}
          </div>
        )}

        {/* Finish Close Button */}
        {isFinished && (
          <button
            onClick={onClose}
            className={`w-full py-3 rounded-xl btn-primary text-sm`}
            style={{
              background: isFailed
                ? "linear-gradient(135deg, var(--danger) 0%, hsl(346, 84%, 50%) 100%)"
                : "linear-gradient(135deg, var(--primary) 0%, hsl(263, 90%, 55%) 100%)",
              boxShadow: isFailed ? "0 4px 15px rgba(239, 68, 68, 0.25)" : "0 4px 20px var(--primary-glow)",
            }}
          >
            {isFailed ? "Dismiss Alert" : "Unlock Workspace"}
          </button>
        )}
      </div>
    </div>
  );
}
