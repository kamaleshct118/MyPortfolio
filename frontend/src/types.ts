export interface ResumeData {
  exists: boolean;
  summary?: string;
  download_url?: string;
  updated_at?: string;
}

export interface ProjectData {
  id: number;
  title: string;
  summary: string;
  readme_path: string;
  readme_url: string;
  image_path: string;
  tags: string[];
  links: {
    github?: string;
    demo?: string;
    [key: string]: string | undefined;
  };
  namespace: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  sender: "user" | "bot";
  text: string;
  timestamp: Date;
  namespace?: string;
  sources?: string[];
  isTyping?: boolean;
}

export type ProcessingState =
  | "Uploading File"
  | "Generating Summary"
  | "Chunking Content"
  | "Generating Embeddings"
  | "Saving to Vector DB"
  | "RAG Processing Complete"
  | "Skipping RAG (Using cached index)"
  | "Error"
  | null;
