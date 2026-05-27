---
title: Myportfolio_backend
emoji: 🚀
colorFrom: purple
colorTo: indigo
sdk: docker
pinned: false
---

# 🚀 AI Portfolio Knowledge Assistant API

Welcome to the stateless, serverless, cloud-native backend of my portfolio. This service handles all dynamic project CRUD operations, resume processing, and vector-similarity RAG chatbot queries.

## 🛠️ Technology Stack
* **Web Framework**: FastAPI (Python)
* **Database**: Supabase PostgreSQL (Stateless REST SDK)
* **Vector Store**: Supabase `pgvector` with local RAG indexing
* **AI Embeddings Model**: `nomic-ai/nomic-embed-text-v1.5` (Cached natively in Docker)
* **LLM Core**: Groq API (LLaMA-70B model)

## 📡 Live API Documentation
You can access the interactive Swagger UI and test endpoints directly by visiting:
* **Swagger UI**: `/docs`
* **JSON Schema**: `/openapi.json`
