import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { X, Send, User, FileText, Maximize2, Minimize2 } from "lucide-react";
import type { ChatMessage } from "../types";

// Public API exposed to parent via ref
export interface ChatbotWidgetHandle {
  openAndSubmit: (query: string) => void;
}

// ---------------------------------------------------------------------------
// Lightweight markdown → HTML renderer (no external deps)
// Supports: headings (###, ##, #), **bold**, *italic*, `code`,
//           ```code blocks```, ordered & unordered lists, blank-line paragraphs
// ---------------------------------------------------------------------------
function renderMarkdown(md: string): string {
  if (!md) return "";

  let html = md.replace(/\r/g, "");

  // Fenced code blocks  ```lang\n...\n```
  html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, (_m, code) => {
    const escaped = code.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<pre style="background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px 12px;overflow-x:auto;font-size:12px;line-height:1.6;margin:8px 0;"><code>${escaped.trimEnd()}</code></pre>`;
  });

  // Headings (must come before inline bold/italic so ** inside headings works)
  html = html.replace(/^[ \t]*### (.+)/gm, '<h3 style="font-size:13px;font-weight:700;color:#c4b5fd;margin:10px 0 4px;">$1</h3>');
  html = html.replace(/^[ \t]*## (.+)/gm,  '<h2 style="font-size:14px;font-weight:700;color:#c4b5fd;margin:10px 0 4px;">$1</h2>');
  html = html.replace(/^[ \t]*# (.+)/gm,   '<h1 style="font-size:15px;font-weight:700;color:#c4b5fd;margin:10px 0 4px;">$1</h1>');

  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#e2e8f0;font-weight:600;">$1</strong>');

  // Italic *text*
  html = html.replace(/\*(.+?)\*/g, '<em style="color:#cbd5e1;">$1</em>');

  // Inline code `code`
  html = html.replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:1px 5px;font-size:11.5px;color:#86efac;">$1</code>');

  // Unordered list items: lines starting with - or *
  // Group consecutive list items
  html = html.replace(/((?:^[ \t]*[-*] .+\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map((line) => {
      const text = line.replace(/^[ \t]*[-*] /, "");
      return `<li style="margin:3px 0;padding-left:4px;">${text}</li>`;
    }).join("");
    return `<ul style="margin:6px 0;padding-left:18px;list-style:disc;">${items}</ul>`;
  });

  // Ordered list items: lines starting with 1. 2. etc.
  html = html.replace(/((?:^[ \t]*\d+\. .+\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map((line) => {
      const text = line.replace(/^[ \t]*\d+\. /, "");
      return `<li style="margin:3px 0;padding-left:4px;">${text}</li>`;
    }).join("");
    return `<ol style="margin:6px 0;padding-left:18px;list-style:decimal;">${items}</ol>`;
  });

  // Paragraphs: wrap double-newline-separated blocks that aren't already HTML tags
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      // Already an HTML block (pre, ul, ol, h1-h3)?
      if (/^<(pre|ul|ol|h[1-3]|li)/.test(trimmed)) return trimmed;
      // Single newlines inside a paragraph → <br>
      return `<p style="margin:6px 0;line-height:1.65;">${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  return html;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const ChatbotWidget = forwardRef<ChatbotWidgetHandle>(function ChatbotWidget(_props, ref) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      sender: "bot",
      text: "Hey There ! I'm Kamalesh, a developer passionate about building smart, impactful software. Ask me about my projects, tech stack, work experience, or anything else you'd like to know!",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Direct send (bypasses the form / controlled input) ──────────────────
  const sendDirectMessage = async (text: string) => {
    if (!text.trim() || isTyping) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      sender: "user",
      text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsTyping(true);

    try {
      const historyData = messages
        .filter((msg) => msg.id !== "welcome")
        .map((msg) => ({ sender: msg.sender, text: msg.text, namespace: msg.namespace }));

      const response = await fetch("http://localhost:8000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: historyData }),
      });

      if (!response.ok) throw new Error("Failed to communicate with chatbot server.");

      const data = await response.json();

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "bot",
          text: data.answer,
          timestamp: new Date(),
          namespace: data.namespace,
          sources: data.sources,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "bot",
          text: "Sorry, I had trouble connecting to my knowledge base. Please check if the backend server is running.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  // ── Imperative API for parent (App.tsx) ─────────────────────────────────
  // Sets pendingQuery + opens panel; the useEffect below fires the send once mounted
  useImperativeHandle(ref, () => ({
    openAndSubmit: (query: string) => {
      setPendingQuery(query);
      setIsOpen(true);
    },
  }));

  // ── Fire pending query as soon as panel is open and not already typing ───
  useEffect(() => {
    if (!pendingQuery || !isOpen || isTyping) return;
    const queryToSend = pendingQuery;
    setPendingQuery(null); // clear immediately so it only fires once
    sendDirectMessage(queryToSend);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuery, isOpen]);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isTyping) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      sender: "user",
      text: inputValue,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsTyping(true);

    try {
      const historyData = messages
        .filter((msg) => msg.id !== "welcome")
        .map((msg) => ({ 
          sender: msg.sender, 
          text: msg.text,
          namespace: msg.namespace 
        }));

      const response = await fetch("http://localhost:8000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage.text, history: historyData }),
      });

      if (!response.ok) throw new Error("Failed to communicate with chatbot server.");

      const data = await response.json();

      const botMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: "bot",
        text: data.answer,
        timestamp: new Date(),
        namespace: data.namespace,
        sources: data.sources,
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "bot",
          text: "Sorry, I had trouble connecting to my knowledge base. Please check if the backend server is running.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  // Panel dimensions
  const panelWidth  = isExpanded ? "760px" : "390px";
  const bubbleMaxW  = isExpanded ? "82%" : "78%";

  return (
    <>
      {/* FAB wrapper - fixed bottom right */}
      <div
        className="font-sans"
        style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: 110,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "6px",
        }}
      >
      {/* FAB Toggle Button */}
      <button
        id="chatbot-toggle-btn"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "60px",
          height: "60px",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          background: "rgba(15, 12, 28, 0.85)",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.6)",
          cursor: "pointer",
          padding: 0,
          overflow: "hidden",
          position: "relative",
          outline: "none",
          transition: "transform 0.2s",
        }}
        className="hover:scale-105 active:scale-95"
      >
        {isOpen ? (
          <X style={{ width: "22px", height: "22px", color: "#ffffff" }} />
        ) : (
          <>
            <img
              src="http://localhost:8000/static/images/vk_monogram.jpg"
              alt="Ask Kamal"
              style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
            />
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-cyan-400 rounded-full animate-ping opacity-75" />
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-cyan-400 rounded-full border border-black/50" />
          </>
        )}
      </button>

      {/* Ask Kamal label */}
      {!isOpen && (
        <span
          className="select-none animate-float"
          style={{
            fontSize: "9px",
            color: "#d8b4fe",
            fontWeight: "bold",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            background: "rgba(10, 8, 20, 0.85)",
            padding: "4px 10px",
            borderRadius: "9999px",
            border: "1px solid rgba(168, 85, 247, 0.25)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            textAlign: "center",
            display: "inline-block",
            whiteSpace: "nowrap",
          }}
        >
          Ask Kamal
        </span>
      )}
      </div>

      {/* Chat Panel - anchored independently */}
      {isOpen && (
        <div
          className="glass-panel flex flex-col overflow-hidden"
          style={{
            position: "fixed",
            top: "50%",
            right: "24px",
            transform: "translateY(-50%)",
            width: panelWidth,
            height: "560px",
            boxShadow: "0 10px 50px rgba(0,0,0,0.6)",
            border: "1px solid var(--border-glass)",
            borderRadius: "var(--radius-lg)",
            background: "rgba(15, 12, 28, 0.97)",
            transition: "width 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
            zIndex: 99,
          }}
        >
          {/* Header */}
          <div
            className="px-5 py-2.5 flex items-center justify-between"
            style={{ borderBottom: "1px solid var(--border-glass)", background: "rgba(255,255,255,0.01)" }}
          >
            {/* Bot avatar + name */}
            <div className="flex items-center gap-2.5">
              <div
                style={{
                  width: "30px",
                  height: "30px",
                  borderRadius: "50%",
                  overflow: "hidden",
                  border: "1px solid rgba(168,85,247,0.3)",
                  flexShrink: 0,
                }}
              >
                <img
                  src="http://localhost:8000/static/images/vk_bot_icon.png"
                  alt="AI Assistant"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>
              <div>
                <p style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0", margin: 0, lineHeight: 1.3 }}>
                  Portfolio Assistant
                </p>
                <p style={{ fontSize: "10px", color: "#a78bfa", margin: 0, lineHeight: 1.3 }}>
                  • Online
                </p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1.5 rounded hover:bg-white/5 text-text-muted hover:text-white transition-colors flex items-center justify-center"
                title={isExpanded ? "Collapse panel" : "Expand panel"}
                style={{ border: "none", background: "transparent", cursor: "pointer", outline: "none" }}
              >
                {isExpanded ? (
                  <Minimize2 style={{ width: "15px", height: "15px" }} />
                ) : (
                  <Maximize2 style={{ width: "15px", height: "15px" }} />
                )}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded hover:bg-white/5 text-text-muted hover:text-white transition-colors flex items-center justify-center"
                style={{ border: "none", background: "transparent", cursor: "pointer", outline: "none" }}
              >
                <X style={{ width: "15px", height: "15px" }} />
              </button>
            </div>
          </div>

          {/* Scroll container — flex-1 fills panel, min-height:0 prevents overflow blowout */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            {/* Inner content wrapper — min-height:100% + justify-end anchors messages to bottom */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                minHeight: "100%",
                padding: "20px",
                gap: "14px",
                boxSizing: "border-box",
              }}
            >
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    display: "flex",
                    gap: "10px",
                    alignSelf: msg.sender === "user" ? "flex-end" : "flex-start",
                    flexDirection: msg.sender === "user" ? "row-reverse" : "row",
                    maxWidth: bubbleMaxW,
                    width: "auto",
                  }}
                >
                  {/* Avatar */}
                  <div
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "50%",
                      overflow: "hidden",
                      flexShrink: 0,
                      border: msg.sender === "user" ? "1px solid rgba(6,182,212,0.25)" : "1px solid rgba(168,85,247,0.2)",
                      background: msg.sender === "user" ? "rgba(6,182,212,0.1)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: "2px",
                    }}
                  >
                    {msg.sender === "user" ? (
                      <User style={{ width: "13px", height: "13px", color: "#22d3ee" }} />
                    ) : (
                      <img
                        src="http://localhost:8000/static/images/vk_bot_icon.png"
                        alt="Bot"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    )}
                  </div>

                  {/* Bubble */}
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        padding: "10px 14px",
                        borderRadius: msg.sender === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                        fontSize: "13px",
                        lineHeight: "1.6",
                        wordBreak: "break-word",
                        overflowWrap: "anywhere",
                        ...(msg.sender === "user"
                          ? {
                              background: "rgba(6,182,212,0.12)",
                              color: "#cffafe",
                              border: "1px solid rgba(6,182,212,0.2)",
                            }
                          : {
                              background: "rgba(255,255,255,0.04)",
                              color: "#ede9fe",
                              border: "1px solid rgba(255,255,255,0.06)",
                            }),
                      }}
                    >
                      {msg.sender === "user" ? (
                        <span style={{ whiteSpace: "pre-wrap" }}>{msg.text}</span>
                      ) : (
                        <div
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
                          style={{ minWidth: 0 }}
                        />
                      )}
                    </div>

                    {/* Sources */}
                    {msg.sender === "bot" && (msg.namespace || msg.sources) && (
                      <div style={{ marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                        {msg.namespace && (
                          <span
                            style={{
                              fontSize: "10px",
                              color: "#a78bfa",
                              fontFamily: "monospace",
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              padding: "2px 8px",
                              borderRadius: "9999px",
                              background: "rgba(139,92,246,0.1)",
                              border: "1px solid rgba(139,92,246,0.15)",
                            }}
                          >
                            {msg.namespace}
                          </span>
                        )}
                        {msg.sources?.map((src, i) => (
                          <span
                            key={i}
                            style={{
                              fontSize: "10px",
                              color: "#22d3ee",
                              fontFamily: "monospace",
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              padding: "2px 8px",
                              borderRadius: "9999px",
                              background: "rgba(6,182,212,0.05)",
                              border: "1px solid rgba(6,182,212,0.1)",
                            }}
                          >
                            <FileText style={{ width: "10px", height: "10px" }} />
                            {src}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {isTyping && (
                <div style={{ display: "flex", gap: "10px", alignSelf: "flex-start" }}>
                  <div
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "50%",
                      overflow: "hidden",
                      flexShrink: 0,
                      border: "1px solid rgba(168,85,247,0.2)",
                    }}
                  >
                    <img
                      src="http://localhost:8000/static/images/vk_bot_icon.png"
                      alt="Bot"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </div>
                  <div
                    style={{
                      padding: "10px 16px",
                      borderRadius: "18px 18px 18px 4px",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      display: "flex",
                      gap: "6px",
                      alignItems: "center",
                    }}
                  >
                    <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input Form */}
          <form
            onSubmit={handleSendMessage}
            style={{
              padding: "12px 14px",
              borderTop: "1px solid var(--border-glass)",
              background: "rgba(0,0,0,0.18)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask me something..."
              className="glass-input"
              style={{
                flex: 1,
                padding: "10px 14px",
                borderRadius: "12px",
                fontSize: "13px",
                outline: "none",
                minWidth: 0,
              }}
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isTyping}
              style={{
                flexShrink: 0,
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background:
                  inputValue.trim() && !isTyping
                    ? "linear-gradient(135deg, var(--primary) 0%, hsl(263, 90%, 55%) 100%)"
                    : "rgba(255,255,255,0.06)",
                color: inputValue.trim() && !isTyping ? "#fff" : "rgba(255,255,255,0.25)",
                cursor: inputValue.trim() && !isTyping ? "pointer" : "not-allowed",
                transition: "all 0.2s",
                outline: "none",
              }}
              className={inputValue.trim() && !isTyping ? "hover:scale-105 active:scale-95" : ""}
            >
              <Send style={{ width: "14px", height: "14px" }} />
            </button>
          </form>
        </div>
      )}
    </>
  );
});


export default ChatbotWidget;
