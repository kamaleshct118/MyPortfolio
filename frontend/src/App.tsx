import React, { useState, useEffect, useRef } from "react";
import { 
  Briefcase, 
  FolderGit, 
  Terminal, 
  Key, 
  Plus, 
  Trash2, 
  Edit3, 
  Globe, 
  Download, 
  Upload, 
  ArrowRight,
  LogOut,
  ChevronRight,
  Sparkles,
  FolderOpen,
  X,
  Loader2,
  Mail,
  MapPin
} from "lucide-react";
import type { ProjectData, ResumeData, ProcessingState } from "./types";
import ChatbotWidget, { type ChatbotWidgetHandle } from "./components/ChatbotWidget";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || "http://localhost:8000";

export default function App() {
  const [currentPage, setCurrentPage] = useState<"home" | "admin">("home");
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [resume, setResume] = useState<ResumeData>({ exists: false });
  const chatbotRef = useRef<ChatbotWidgetHandle>(null);
  
  // Admin Authentication State — in-memory only (resets on refresh/back/forward)
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [secretKeyInput, setSecretKeyInput] = useState("");
  const [authError, setAuthError] = useState("");

  // RAG Progress Streaming State
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingState, setProcessingState] = useState<ProcessingState>(null);

  // Project Form State
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectData | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formTags, setFormTags] = useState("");
  const [formGithub, setFormGithub] = useState("");
  const [formDemo, setFormDemo] = useState("");
  const [formImageUrl, setFormImageUrl] = useState("");
  const [formImageFile, setFormImageFile] = useState<File | null>(null);
  const [formReadmeText, setFormReadmeText] = useState("");

  // Resume Form State
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [showOriginalResume, setShowOriginalResume] = useState(false);

  // Clear any stale admin session on every mount (refresh / new tab)
  useEffect(() => {
    sessionStorage.removeItem("admin_token");
  }, []);

  // Fetch initial data on mount
  useEffect(() => {
    fetchProjects();
    fetchResume();
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/projects`);
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects);
      }
    } catch (e) {
      console.error("Failed to load projects: ", e);
    }
  };

  const fetchResume = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/resume`);
      if (res.ok) {
        const data = await res.json();
        setResume(data);
      }
    } catch (e) {
      console.error("Failed to load resume: ", e);
    }
  };

  // --- Auth Methods ---

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret_key: secretKeyInput }),
      });

      if (!res.ok) {
        throw new Error("Invalid admin key");
      }

      const data = await res.json();
      // Token stored in memory only — lost on refresh (intentional security)
      setAdminToken(data.token);
      setSecretKeyInput("");
      setShowAuthModal(false);
      setCurrentPage("admin");
    } catch (err: any) {
      if (err.message === "Invalid admin key") {
        setAuthError("Invalid administrative secret key.");
      } else {
        setAuthError("Unable to connect to the backend server. Please ensure the backend is running (run start.bat).");
      }
    }
  };

  const handleLogout = () => {
    setAdminToken(null);
    setCurrentPage("home");
  };

  // --- Project CRUD Operations ---

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) return;

    setIsProcessing(true);
    setProcessingState("Uploading File");

    const formData = new FormData();
    formData.append("title", formTitle);
    
    // Convert tags array to comma-separated list
    formData.append("tags", formTags);
    
    // Convert links
    formData.append("links", JSON.stringify({
      github: formGithub,
      demo: formDemo
    }));

    if (editingProject) {
      formData.append("project_id", editingProject.id.toString());
    } else {
      formData.append("project_id", "none");
    }

    if (formReadmeText.trim()) {
      formData.append("readme_text", formReadmeText);
    }
    if (formImageFile) {
      formData.append("image_file", formImageFile);
    } else if (formImageUrl) {
      formData.append("image_url", formImageUrl);
    }

    try {
      // Connect to the streaming save endpoint
      const response = await fetch(`${API_BASE_URL}/api/projects/save`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${adminToken}`
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error("Save request rejected by server.");
      }

      // Read SSE stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const text = decoder.decode(value);
          // Parse lines in SSE format "data: <state>\n\n"
          const lines = text.split("\n\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const state = line.replace("data: ", "").trim() as ProcessingState;
              setProcessingState(state);
              
              if (state === "RAG Processing Complete") {
                fetchProjects();
                setShowProjectModal(false);
                resetProjectForm();
              }
            }
          }
        }
      }

      // Fallback fallback close
      fetchProjects();
      setShowProjectModal(false);
      resetProjectForm();
    } catch (err: any) {
      setProcessingState("Error");
    }
  };

  const handleDeleteProject = async (id: number) => {
    if (!confirm("Are you sure you want to delete this project and its vector knowledge namespace?")) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/projects/${id}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${adminToken}`
        }
      });
      if (res.ok) {
        fetchProjects();
      }
    } catch (e) {
      alert("Failed to delete project: " + e);
    }
  };

  const openEditProject = async (proj: ProjectData) => {
    setEditingProject(proj);
    setFormTitle(proj.title);
    setFormTags(proj.tags.join(", "));
    setFormGithub(proj.links.github || "");
    setFormDemo(proj.links.demo || "");
    setFormImageUrl(proj.image_path.startsWith("http") ? proj.image_path : "");
    setFormReadmeText(""); // Clear first
    
    // Fetch readme content from URL
    try {
      const res = await fetch(`${API_BASE_URL}${proj.readme_url}`);
      if (res.ok) {
        const text = await res.text();
        setFormReadmeText(text);
      }
    } catch (e) {
      console.error("Failed to fetch README content for edit: ", e);
    }
    
    setShowProjectModal(true);
  };

  const resetProjectForm = () => {
    setEditingProject(null);
    setFormTitle("");
    setFormTags("");
    setFormGithub("");
    setFormDemo("");
    setFormImageUrl("");
    setFormImageFile(null);
    setFormReadmeText("");
  };

  // --- Resume CRUD Operations ---

  const handleSaveResume = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resumeFile) return;

    setIsProcessing(true);
    setProcessingState("Uploading File");

    const formData = new FormData();
    formData.append("file", resumeFile);

    try {
      const response = await fetch(`${API_BASE_URL}/api/resume/save`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${adminToken}`
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error("Failed to save resume");
      }

      // Read SSE stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const text = decoder.decode(value);
          const lines = text.split("\n\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const state = line.replace("data: ", "").trim() as ProcessingState;
              setProcessingState(state);
            }
          }
        }
      }

      fetchResume();
      setResumeFile(null);
    } catch (e) {
      setProcessingState("Error");
    }
  };

  const handleDeleteResume = async () => {
    if (!confirm("Are you sure you want to delete your resume and evict its vectors?")) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/resume`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${adminToken}`
        }
      });
      if (res.ok) {
        fetchResume();
      }
    } catch (e) {
      alert("Failed to delete resume: " + e);
    }
  };



  // UI micro-interaction: directly opens chatbot and fires the query
  const handleAskAIAboutProject = (projectTitle: string) => {
    chatbotRef.current?.openAndSubmit(`explain about the "${projectTitle}" project`);
  };

  const renderProjectCard = (proj: ProjectData, key: string, isMarquee = false) => {
    const isExpanded = !!expandedProjects[proj.id];
    const toggleExpand = (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpandedProjects(prev => ({
        ...prev,
        [proj.id]: !prev[proj.id]
      }));
    };

    return (
      <div 
        key={key}
        className="project-card group"
        style={{ 
          width: isMarquee ? "320px" : "100%",
          maxWidth: isMarquee ? "320px" : "360px",
          flexShrink: isMarquee ? 0 : 1,
        }}
      >
        <div className="space-y-4">
          {/* Project Visual Image */}
          {proj.image_path ? (
            <div className="project-card-image-wrapper">
              <img 
                src={proj.image_path.startsWith("http") ? proj.image_path : `${API_BASE_URL}${proj.image_path}`}
                alt={proj.title}
                className="project-card-image"
              />
            </div>
          ) : (
            <div className="project-card-image-wrapper project-card-image-placeholder">
              <FolderOpen className="w-10 h-10 opacity-30" />
            </div>
          )}

          {/* Tags */}
          <div className="project-card-tags">
            {proj.tags.map((t, i) => (
              <span key={i} className="project-card-tag">
                {t}
              </span>
            ))}
          </div>

          {/* Title & Display Summary */}
          <div className="project-card-text-container" style={{ height: isExpanded ? "auto" : "110px" }}>
            <h4 className="project-card-title truncate">
              {proj.title}
            </h4>
            {/* Description paragraph — clamped or full */}
            <p style={{
              fontSize: "12px",
              color: "var(--text-secondary)",
              lineHeight: "1.6",
              display: isExpanded ? "block" : "-webkit-box",
              WebkitLineClamp: isExpanded ? undefined : 3,
              WebkitBoxOrient: isExpanded ? undefined : "vertical",
              overflow: isExpanded ? "visible" : "hidden",
              margin: 0,
            }}>
              {proj.summary}
            </p>
            {/* Toggle button — always rendered OUTSIDE the clamped p so it's never clipped */}
            {proj.summary.length > 150 && (
              <button
                onClick={toggleExpand}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  marginTop: "1px",
                  cursor: "pointer",
                  fontSize: "11px",
                  color: "var(--text-muted)",
                  fontFamily: "inherit",
                  display: "block",
                  letterSpacing: "0.01em",
                  opacity: 0.75,
                }}
              >
                {isExpanded ? "show less" : "more"}
              </button>
            )}
          </div>
        </div>


        {/* Links & AI Chat Call-to-action */}
        <div className="project-card-footer">
          <div className="project-card-footer-top">
            <div className="flex gap-3">
              {proj.links.github && (
                <a 
                  href={proj.links.github} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="transition-colors flex items-center justify-center"
                  style={{ 
                    color: "rgba(255, 255, 255, 0.75)", 
                    transition: "color 0.2s" 
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = "var(--violet-bright)"}
                  onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255, 255, 255, 0.75)"}
                >
                  <svg className="w-4.5 h-4.5 transition-colors" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
                  </svg>
                </a>
              )}
              {proj.links.demo && (
                <a 
                  href={proj.links.demo} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="transition-colors flex items-center justify-center"
                  style={{ 
                    color: "rgba(255, 255, 255, 0.75)", 
                    transition: "color 0.2s" 
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = "var(--secondary-soft)"}
                  onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255, 255, 255, 0.75)"}
                >
                  <Globe className="w-4.5 h-4.5" style={{ stroke: "currentColor" }} />
                </a>
              )}
            </div>
            <span className="text-[9px] text-text-muted font-mono">
              NS: {proj.namespace}
            </span>
          </div>

          {/* MICRO-INTERACTION BUTTON: Wire to chatbot */}
          <button 
            onClick={() => handleAskAIAboutProject(proj.title)}
            className="w-full py-2.5 rounded-lg btn-secondary text-xs font-semibold flex items-center justify-center gap-1.5 group-hover:bg-purple-500/10 group-hover:border-purple-500/20 group-hover:text-purple-300"
            style={{ border: "1px solid var(--border-glass)" }}
          >
            Ask AI About This Project
            <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen relative flex flex-col justify-between font-sans">
      <div className="ambient-glow-1" />
      <div className="ambient-glow-2" />
      <div 
        className="ambient-glow-3"
        style={{
          position: "absolute",
          top: "20%",
          right: "15%",
          width: "300px",
          height: "300px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(124,58,237,0.05), transparent 50%)",
          zIndex: -1,
          filter: "blur(70px)",
          pointerEvents: "none"
        }}
      />

      {/* RAG Processing Popup overlay */}
      <ProcessingPopup 
        state={processingState} 
        isOpen={isProcessing} 
        onClose={() => {
          setIsProcessing(false);
          setProcessingState(null);
        }} 
      />

      {/* --- PREMIUM NAVIGATION HEADER --- */}
      <header className="w-full py-5 sticky top-0 z-40 backdrop-blur-md border-b border-white/5 bg-black/20">
        <div className="container flex justify-between items-center">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentPage("home")}>
            <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  overflow: "hidden",
                  border: "1px solid rgba(124,58,237,0.15)",
                  flexShrink: 0,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.3)"
                }}
              >
                <img
                  src="/kamal_icon.png"
                  alt="Kamalesh V"
                  style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                />
              </div>
            <div>
              <h1 className="text-md font-bold tracking-wide text-white uppercase">Kamalesh V</h1>
              <span className="text-[10px] text-cyan-400 font-semibold tracking-wider font-mono uppercase">AI-Developer</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {currentPage === "admin" ? (
              <>
                <button 
                  onClick={() => setCurrentPage("home")} 
                  className="px-4 py-2 text-xs font-semibold rounded-lg btn-secondary"
                >
                  View Portfolio
                </button>
                <button 
                  onClick={handleLogout} 
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-500/15 border border-red-500/20 text-red-300 hover:bg-red-500/25 flex items-center gap-2"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Logout
                </button>
              </>
            ) : (
              adminToken && (
                <button 
                  onClick={() => setCurrentPage("admin")} 
                  className="px-4 py-2 text-xs font-semibold rounded-lg btn-primary"
                >
                  Admin Console
                </button>
              )
            )}
          </div>
        </div>
      </header>

      {/* --- VISITOR PAGE (HOME) --- */}
      {currentPage === "home" && (
        <main className="flex-1 container py-14 space-y-24">
          
          {/* HERO SECTION */}
          <section className="hero-grid py-8 relative">
            {/* Left Column (Content) */}
            <div className="hero-left">
              <h1 className="hero-title">
                AI-Powered <br />
                <span className="text-gradient">Portfolio Workspace</span>
              </h1>
              
              <p className="hero-description">
                Welcome to my AI and software engineering portfolio. Explore projects, system architectures, technical research, and development workflows through an interactive assistant experience.
              </p>

              {/* Skills/Tech Pills */}
              <div className="hero-tags-wrapper">
                {["PYTHON", "FASTAPI", "REACT", "TYPESCRIPT", "N8N", "CREW AI", "HUGGING FACE", "POSTGRESQL"].map((tech) => (
                  <span key={tech} className="hero-tag-pill">
                    {tech}
                  </span>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="hero-actions">
                <button 
                  onClick={() => {
                    const chatBtn = document.getElementById("chatbot-toggle-btn") as HTMLButtonElement;
                    if (chatBtn) chatBtn.click();
                  }}
                  className="px-6 py-3.5 rounded-xl btn-primary text-sm flex items-center gap-2"
                >
                  Chat with my AI
                  <ArrowRight className="w-4 h-4" />
                </button>
                <a 
                  href="#projects" 
                  className="px-6 py-3.5 rounded-xl btn-secondary text-sm flex items-center gap-2"
                >
                  Explore Projects
                </a>
              </div>

              {/* Stats Counters */}
              <div className="hero-stats-grid">
                <div className="hero-stat-card">
                  <span className="hero-stat-value">{projects.length}</span>
                  <span className="hero-stat-label">Projects Indexed</span>
                </div>
                <div className="hero-stat-card">
                  <span className="hero-stat-value">N8N</span>
                  <span className="hero-stat-label">RAG Engine</span>
                </div>
                <div className="hero-stat-card">
                  <span className="hero-stat-value">Crew AI</span>
                  <span className="hero-stat-label">LLM Orchestrator</span>
                </div>
                <div className="hero-stat-card">
                  <span className="hero-stat-value">Hugging Face</span>
                  <span className="hero-stat-label">AI Tools</span>
                </div>
              </div>

              {/* Social links */}
              <div className="hero-socials">
                <a 
                  href="https://github.com" 
                  target="_blank" 
                  rel="noreferrer" 
                  className="hero-social-link"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
                  </svg>
                  GitHub
                </a>
                <a 
                  href="https://linkedin.com" 
                  target="_blank" 
                  rel="noreferrer" 
                  className="hero-social-link"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                  LinkedIn
                </a>
                <a 
                  href="mailto:contact@example.com" 
                  className="hero-social-link"
                >
                  <Mail className="w-4 h-4" />
                  Email
                </a>
              </div>
            </div>

            {/* Right Column (Profile Avatar Card) */}
            <div className="hero-right">
              <div className="hero-avatar-container">
                {/* Glowing effect background */}
                <div className="hero-avatar-glow" />
                {/* Inner circle */}
                <div className="hero-avatar-circle">
                  <img
                    src="/kamal_icon.png"
                    alt="Kamalesh V"
                  />
                </div>
              </div>
              <h3 className="hero-right-name">Kamalesh V</h3>
              <p className="hero-right-title">AI · Software Engineer</p>
              <div className="hero-right-location">
                <MapPin className="w-4 h-4 text-cyan-400" />
                <span>Tamil Nadu, India</span>
              </div>
            </div>
          </section>

          {/* RESUME DISPLAY OVERVIEW (Pipeline 1 Output) */}
          <section className="space-y-6">
            <div className="flex items-center gap-3.5">
              <div className="p-2.5 rounded-xl text-cyan-400 border border-cyan-500/15" style={{ background: "rgba(6,182,212,0.12)" }}>
                <Briefcase className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold tracking-wide text-white">Professional Profile</h3>
            </div>

            {resume.exists ? (
              <div 
                className="p-8 glass-panel flex flex-col gap-6 profile-card-content"
                style={{ background: "linear-gradient(145deg, rgba(11,23,48,0.88), rgba(7,18,38,0.95))" }}
              >
                <div className="flex flex-col md:flex-row items-start md:items-start justify-between gap-6">
                  <div className="space-y-3 max-w-3xl">
                    <h4 className="text-md font-semibold text-white tracking-wide">Developer Overview</h4>
                    <p className="text-sm text-text-secondary leading-relaxed">
                      {resume.summary}
                    </p>
                    <span className="text-[10px] text-text-muted font-mono uppercase block">
                      Last Index Update: {resume.updated_at ? new Date(resume.updated_at).toLocaleDateString() : ""}
                    </span>
                  </div>

                  <div className="flex flex-col sm:flex-row md:flex-col lg:flex-row gap-3 shrink-0 self-start md:self-auto">
                    <a 
                      href={`${API_BASE_URL}${resume.download_url}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-5 py-3 rounded-xl btn-primary text-xs font-semibold flex items-center gap-2.5 justify-center"
                    >
                      <Download className="w-4 h-4 text-white" />
                      Download CV
                    </a>
                  </div>
                </div>

                {/* Collapsible dropdown accordion to view original resume */}
                <div className="pt-4 border-t border-white/5">
                  <button 
                    onClick={() => setShowOriginalResume(!showOriginalResume)}
                    className="flex items-center gap-2 text-xs text-cyan-400 hover:text-cyan-300 font-semibold transition-colors bg-transparent border-none cursor-pointer p-0"
                  >
                    <ChevronRight className={`w-4 h-4 transition-transform duration-300 ${showOriginalResume ? "rotate-90" : ""}`} />
                    {showOriginalResume ? "Hide Original Document" : "View Original Document inline"}
                  </button>
                  
                  {showOriginalResume && (
                    <div className="mt-4 rounded-xl overflow-hidden border border-white/5 bg-black/30 w-full">
                      {resume.download_url?.toLowerCase().endsWith(".pdf") ? (
                        <iframe 
                          src={`${API_BASE_URL}${resume.download_url}#toolbar=0&navpanes=0`}
                          title="Original PDF Resume"
                          className="w-full border-none"
                          style={{ height: "1200px" }}
                        />
                      ) : (
                        <iframe 
                          src={`${API_BASE_URL}${resume.download_url}`}
                          title="Original Resume File"
                          className="w-full border-none p-6 text-text-secondary"
                          style={{ height: "600px" }}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-8 rounded-xl border border-white/5 bg-white/2.5 text-center">
                <p className="text-sm text-text-muted mb-4">No professional resume uploaded yet.</p>
                {adminToken ? (
                  <form onSubmit={handleSaveResume} className="max-w-xs mx-auto space-y-4">
                    <div className="p-6 rounded-xl border border-dashed border-purple-500/20 bg-purple-500/5 cursor-pointer relative overflow-hidden hover:border-purple-500/35 transition-colors">
                      <input 
                        type="file" 
                        onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
                        accept=".pdf,.txt,.md"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />
                      <Upload className="w-6 h-6 text-purple-400 mx-auto mb-2" />
                      <span className="text-xs text-white/80 block font-semibold truncate px-2">
                        {resumeFile ? resumeFile.name : "Select PDF / TXT Resume"}
                      </span>
                    </div>
                    <button 
                      type="submit" 
                      disabled={!resumeFile}
                      className={`w-full py-2.5 rounded-xl text-xs font-semibold ${
                        resumeFile ? "btn-primary" : "text-text-muted bg-white/5 cursor-not-allowed border border-white/5"
                      }`}
                    >
                      Upload & Index Resume
                    </button>
                  </form>
                ) : (
                  <span className="text-xs text-text-muted">Check back later or access developer tools below.</span>
                )}
              </div>
            )}

          </section>

          {/* PROJECTS GRID LIST SECTION (Pipeline 1 Output) */}
          <section id="projects" className="space-y-8 scroll-mt-24">
            <div className="flex items-center gap-3.5">
              <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/15">
                <FolderGit className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold tracking-wide text-white">Featured Engineering Work</h3>
            </div>

            {projects.length > 0 ? (
              projects.length >= 3 ? (
                <div className="marquee-container">
                  <div className="marquee-track">
                    {projects.map((proj) => renderProjectCard(proj, `orig-${proj.id}`, true))}
                    {projects.map((proj) => renderProjectCard(proj, `dup-${proj.id}`, true))}
                  </div>
                </div>
              ) : (
                <div className="grid-cards" style={{ display: "flex", justifyContent: "flex-start", flexWrap: "wrap", gap: "32px" }}>
                  {projects.map((proj) => renderProjectCard(proj, `single-${proj.id}`, false))}
                </div>
              )
            ) : (
              <div className="p-12 rounded-2xl border border-white/5 bg-white/2.5 text-center text-sm text-text-muted">
                No active projects indexed in the workspace. Upload READMEs in developer tools below.
              </div>
            )}
          </section>
        </main>
      )}

      {/* --- DEVELOPER MANAGEMENT DASHBOARD (ADMIN) --- */}
      {currentPage === "admin" && adminToken && (
        <main className="flex-1 container py-14 space-y-12">
          
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold text-white tracking-wide">Developer Access Center</h2>
              <p className="text-xs text-text-secondary mt-0.5">Vector database knowledge lifecycle operations</p>
            </div>
            <button 
              onClick={() => {
                resetProjectForm();
                setEditingProject(null);
                setShowProjectModal(true);
              }}
              className="px-4 py-2.5 rounded-lg btn-primary text-xs font-semibold flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Project
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* LEFT COLUMN: RESUME METADATA MANAGEMENT (ONE RESUME RULE) */}
            <div className="space-y-6">
              <div className="p-6 glass-panel space-y-6">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Single Resume Management</h3>
                
                {resume.exists ? (
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/15 text-xs text-purple-200 leading-relaxed font-mono">
                      <span className="font-sans font-bold text-white block mb-1">Active Index Summary:</span>
                      {resume.summary}
                    </div>
                    
                    <button 
                      onClick={handleDeleteResume}
                      className="w-full py-2.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs font-semibold flex items-center justify-center gap-2 border border-red-500/20"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete Resume
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSaveResume} className="space-y-4">
                    <div className="p-6 rounded-xl border border-dashed border-white/15 bg-white/2.5 text-center cursor-pointer hover:border-purple-500/35 transition-colors relative overflow-hidden">
                      <input 
                        type="file" 
                        onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
                        accept=".pdf,.txt,.md"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />
                      <Upload className="w-6 h-6 text-text-muted mx-auto mb-2" />
                      <span className="text-xs text-white/80 block font-semibold truncate px-2">
                        {resumeFile ? resumeFile.name : "Select PDF / TXT Resume"}
                      </span>
                      <span className="text-[10px] text-text-muted block mt-1">Maximum size 10MB</span>
                    </div>

                    <button 
                      type="submit" 
                      disabled={!resumeFile || isProcessing}
                      className={`w-full py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 ${
                        resumeFile && !isProcessing ? "btn-primary" : "text-text-muted bg-white/5 cursor-not-allowed border border-white/5"
                      }`}
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Processing RAG...
                        </>
                      ) : (
                        "Upload & Vectorize"
                      )}
                    </button>
                  </form>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN (SPAN 2): PROJECT GRID CRUD TABLE */}
            <div className="lg:col-span-2 space-y-6">
              <div className="p-6 glass-panel space-y-6">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Project Knowledge Base</h3>
                
                {projects.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-white/5 text-xs text-text-muted tracking-wide uppercase">
                          <th className="py-3 px-2">Title</th>
                          <th className="py-3 px-2">Vector Namespace</th>
                          <th className="py-3 px-2">Tags</th>
                          <th className="py-3 px-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-white/90">
                        {projects.map((proj) => (
                          <tr key={proj.id} className="hover:bg-white/2.5 transition-colors">
                            <td className="py-4 px-2 font-bold">{proj.title}</td>
                            <td className="py-4 px-2 font-mono text-xs text-cyan-400">{proj.namespace}</td>
                            <td className="py-4 px-2">
                              <div className="flex flex-wrap gap-1">
                                {proj.tags.map((t, i) => (
                                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/5 text-text-secondary">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="py-4 px-2 text-right">
                              <div className="flex gap-2 justify-end">
                                <button 
                                  onClick={() => openEditProject(proj)}
                                  className="p-2 rounded hover:bg-white/5 text-cyan-400"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={() => handleDeleteProject(proj.id)}
                                  className="p-2 rounded hover:bg-white/5 text-red-400"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-12 text-center text-xs text-text-muted border border-dashed border-white/10 rounded-2xl">
                    No projects uploaded. Click "Add Project" to begin indexing README files.
                  </div>
                )}
              </div>
            </div>

          </div>
        </main>
      )}

      {/* --- FOOTER & HIDDEN DEVELOPER ENTRANCE --- */}
      <footer className="w-full py-8 border-t border-white/5 bg-black/10">
        <div className="container flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-xs text-text-muted">
            &copy; {new Date().getFullYear()} Powered and Developed by Kamalesh V
          </p>
          
          {currentPage === "home" && (
            <button 
              onClick={() => {
                if (adminToken) {
                  setCurrentPage("admin");
                } else {
                  setShowAuthModal(true);
                }
              }}
              className="text-xs text-text-muted hover:text-cyan-400 flex items-center gap-1.5 transition-colors bg-transparent border-none cursor-pointer"
            >
              <Key className="w-3.5 h-3.5" />
              Developer Access
            </button>
          )}
        </div>
      </footer>

      {/* --- MODAL: ADMIN ACCESS KEY PROMPT --- */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div 
            className="w-[360px] p-6 glass-panel space-y-4 text-left relative"
            style={{ 
              background: "linear-gradient(145deg, rgba(10,14,35,0.96), rgba(17,24,39,0.96))",
              backdropFilter: "blur(18px)"
            }}
          >
            <div className="flex justify-between items-center">
              <h3 className="text-md font-bold text-white">Developer Keys Access</h3>
              <button onClick={() => setShowAuthModal(false)} className="text-text-muted hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-text-secondary font-semibold">Enter Secret Authentication Key</label>
                <input 
                  type="password"
                  value={secretKeyInput}
                  onChange={(e) => setSecretKeyInput(e.target.value)}
                  placeholder="Secret admin key"
                  className="w-full px-4 py-2.5 rounded-xl glass-input text-sm"
                  autoFocus
                />
                {authError && <p className="text-[10px] text-red-400 font-semibold">{authError}</p>}
              </div>

              <button type="submit" className="w-full py-2.5 rounded-xl btn-primary text-xs font-semibold">
                Unlock System
              </button>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL: CREATE / EDIT PROJECT FORM --- */}
      {showProjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm overflow-y-auto py-8">
          <div 
            className="w-[500px] p-8 glass-panel space-y-6 text-left relative my-auto"
            style={{ 
              background: "linear-gradient(145deg, rgba(10,14,35,0.96), rgba(17,24,39,0.96))",
              backdropFilter: "blur(18px)"
            }}
          >
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">
                {editingProject ? `Edit Project: ${editingProject.title}` : "Index New Portfolio Project"}
              </h3>
              <button 
                onClick={() => {
                  setShowProjectModal(false);
                  resetProjectForm();
                }} 
                className="text-text-muted hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProject} className="space-y-5">
              
              {/* Project Title */}
              <div className="space-y-1.5">
                <label className="text-xs text-text-secondary font-semibold">Project Title (Required)</label>
                <input 
                  type="text"
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g. StudyMate"
                  className="w-full px-4 py-2.5 rounded-xl glass-input text-sm"
                />
              </div>

              {/* Tags */}
              <div className="space-y-1.5">
                <label className="text-xs text-text-secondary font-semibold">Tags (Comma-separated)</label>
                <input 
                  type="text"
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                  placeholder="e.g. React, FastAPI, FAISS, LLM"
                  className="w-full px-4 py-2.5 rounded-xl glass-input text-sm"
                />
              </div>

              {/* Links */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-text-secondary font-semibold">GitHub Repository URL</label>
                  <input 
                    type="url"
                    value={formGithub}
                    onChange={(e) => setFormGithub(e.target.value)}
                    placeholder="https://github.com/..."
                    className="w-full px-4 py-2.5 rounded-xl glass-input text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-text-secondary font-semibold">Live Project Demo URL</label>
                  <input 
                    type="url"
                    value={formDemo}
                    onChange={(e) => setFormDemo(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-4 py-2.5 rounded-xl glass-input text-sm"
                  />
                </div>
              </div>

              {/* Image Input Options */}
              <div className="space-y-2">
                <label className="text-xs text-text-secondary font-semibold block">Project Display Card Visual Image</label>
                <div className="grid grid-cols-2 gap-4">
                  {/* File Upload */}
                  <div className="p-3 rounded-xl border border-dashed border-white/10 bg-white/2.5 text-center cursor-pointer hover:border-purple-500/25 transition-colors relative overflow-hidden flex flex-col justify-center items-center min-h-[50px]">
                    <input 
                      type="file" 
                      accept="image/*"
                      onChange={(e) => {
                        setFormImageFile(e.target.files?.[0] || null);
                        setFormImageUrl(""); // clear url if file selected
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <Upload className="w-4 h-4 text-text-muted mb-1" />
                    <span className="text-[10px] text-white/80 block font-semibold truncate max-w-full px-2">
                      {formImageFile ? formImageFile.name : "Upload Image file"}
                    </span>
                  </div>
                  
                  {/* URL Path */}
                  <input 
                    type="url"
                    disabled={!!formImageFile}
                    value={formImageUrl}
                    onChange={(e) => setFormImageUrl(e.target.value)}
                    placeholder="Or paste external image URL..."
                    className={`w-full px-4 py-3 rounded-xl glass-input text-xs ${
                      formImageFile ? "opacity-30 cursor-not-allowed" : ""
                    }`}
                  />
                </div>
              </div>

              {/* README Text Area */}
              <div className="space-y-1.5 flex flex-col">
                <label className="text-xs text-text-secondary font-semibold block">
                  Original README Document (Markdown Text)
                  {!editingProject && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                <textarea
                  required={!editingProject}
                  value={formReadmeText}
                  onChange={(e) => setFormReadmeText(e.target.value)}
                  placeholder="Paste markdown README text content here..."
                  className="w-full h-40 px-4 py-3 rounded-xl glass-input text-xs font-mono resize-y"
                  style={{
                    background: "rgba(0, 0, 0, 0.2)",
                    border: "1px solid var(--border-glass)",
                    color: "#ede9fe",
                    lineHeight: "1.6",
                    outline: "none",
                  }}
                />
                <span className="text-[9.5px] text-text-muted block mt-0.5">
                  {editingProject ? "Only edit if updating original knowledge base. " : ""}This text content will be processed & embedded into the project's vector DB namespace.
                </span>
              </div>

              {/* Submit Buttons */}
              <button 
                type="submit" 
                disabled={isProcessing}
                className="w-full py-3 rounded-xl btn-primary text-sm font-semibold mt-3 flex items-center justify-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Executing RAG Pipeline...
                  </>
                ) : (
                  editingProject ? "Save Changes & Stream Update" : "Index Project & Save"
                )}
              </button>

            </form>
          </div>
        </div>
      )}

      {/* Floating interactive chatbot assistant */}
      <ChatbotWidget ref={chatbotRef} />
    </div>
  );
}
