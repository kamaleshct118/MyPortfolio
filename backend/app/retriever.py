import os
import re
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import SupabaseVectorStore
from langchain_openai import ChatOpenAI
from langchain_core.documents import Document
import app.config as config
import app.database as database

# Global memory caches for performance
_embeddings_cache = None
_llm_cache = None
_loaded_dbs = {}

_query_cache = []  # List of dicts: {"query": str, "namespace": str, "answer": str, "sources": list}

def check_cache(query: str, namespace: str):
    global _query_cache
    q_norm = query.strip().lower()
    for item in _query_cache:
        if item["query"] == q_norm and item["namespace"] == namespace:
            print(f"[*] Cache Hit! query: '{query}' in namespace: '{namespace}'")
            # Move hit to the end (MRU)
            _query_cache.remove(item)
            _query_cache.append(item)
            return item["answer"], item["sources"]
    return None

def add_to_cache(query: str, namespace: str, answer: str, sources: list):
    global _query_cache
    q_norm = query.strip().lower()
    # If already exists, remove it first
    for item in list(_query_cache):
        if item["query"] == q_norm and item["namespace"] == namespace:
            _query_cache.remove(item)
            
    # Add new item
    _query_cache.append({
        "query": q_norm,
        "namespace": namespace,
        "answer": answer,
        "sources": sources
    })
    
    # Cap size at 5
    if len(_query_cache) > 5:
        removed = _query_cache.pop(0)
        print(f"[*] Cache evicted oldest query: '{removed['query']}'")


def get_embeddings():
    """Returns the globally cached HuggingFace embeddings model with offline-first loading."""
    global _embeddings_cache
    if _embeddings_cache is None:
        print(f"[*] Loading Embedding Model ({config.EMBED_MODEL})...")
        try:
            # 1. Attempt strict offline loading from the baked-in container cache (critical for Hugging Face Spaces)
            _embeddings_cache = HuggingFaceEmbeddings(
                model_name=config.EMBED_MODEL,
                model_kwargs={
                    'trust_remote_code': True,
                    'local_files_only': True
                }
            )
            print("[+] Successfully loaded embedding model from offline cache.")
        except Exception as offline_err:
            print(f"[*] Offline loading skipped or failed: {offline_err}. Attempting online download...")
            # 2. Fall back to standard online loading (for initial local development)
            _embeddings_cache = HuggingFaceEmbeddings(
                model_name=config.EMBED_MODEL,
                model_kwargs={'trust_remote_code': True}
            )
    return _embeddings_cache

def get_llm():
    """Returns the globally cached Groq/OpenAI client."""
    global _llm_cache
    if _llm_cache is None:
        if not config.GROQ_API_KEY:
            print("[!] Warning: GROQ_API_KEY is not set.")
            return None
        _llm_cache = ChatOpenAI(
            model=config.MODEL_NAME,
            api_key=config.GROQ_API_KEY,
            base_url=config.GROQ_BASE_URL,
        )
    return _llm_cache

def load_db(namespace: str):
    """Instantiates and returns the globally cached SupabaseVectorStore wrapper."""
    global _loaded_dbs
    
    # We cache a single connection under "supabase" key for all namespaces
    if "supabase" in _loaded_dbs:
        return _loaded_dbs["supabase"]
        
    print("[*] Instantiating Supabase Vector Store connection...")
    try:
        from app.database import get_supabase_client
        client = get_supabase_client()
        db = SupabaseVectorStore(
            client=client,
            embedding=get_embeddings(),
            table_name="documents",
            query_name="match_documents"
        )
        _loaded_dbs["supabase"] = db
        return db
    except Exception as e:
        print(f"[!] Error instantiating Supabase Vector Store: {e}")
        return None

def direct_similarity_search(query: str, namespace: str, k: int = 5) -> list:
    """
    Directly queries the Supabase 'match_documents' RPC to avoid the buggy 
    LangChain community vector store client implementation.
    """
    try:
        from app.database import get_supabase_client
        # Get query vector embedding
        embeddings = get_embeddings()
        query_vector = embeddings.embed_query(query)
        
        # Query Supabase match_documents RPC directly
        client = get_supabase_client()
        response = client.rpc(
            "match_documents",
            {
                "query_embedding": query_vector,
                "match_count": k,
                "filter": {"namespace": namespace}
            }
        ).execute()
        
        # Convert response records into LangChain Document objects
        docs = []
        for record in response.data:
            doc = Document(
                page_content=record.get("content", ""),
                metadata=record.get("metadata", {})
            )
            docs.append(doc)
        return docs
    except Exception as e:
        print(f"[!] Direct Supabase similarity search failed: {e}")
        return []

def unload_db(namespace: str):
    """Evicts a namespace and deletes all document vectors belonging to it from Supabase."""
    global _loaded_dbs
    
    # Purge from Supabase vector index
    try:
        import app.indexer as indexer
        indexer.delete_index(namespace)
    except Exception as e:
        print(f"[!] Error during unload_db index deletion: {e}")

def contextualize_query(query: str, history: list = None) -> str:
    """
    Uses dialogue history and the user's latest follow-up question to write 
    a standalone, self-contained search query. If history is empty, returns original.
    """
    if not history or len(history) == 0:
        return query
        
    llm = get_llm()
    if not llm:
        return query
        
    # Compile dialogue history (last 4 turns) to keep context compact and fast
    history_str = ""
    for turn in history[-4:]:
        role = "User" if turn.get("sender") == "user" else "Assistant"
        history_str += f"{role}: {turn.get('text')}\n"
        
    prompt = f"""You are a query-rewrite engine. Given the following chat history and a follow-up user question, rephrase the follow-up question into a standalone, self-contained search query that can be understood without the conversation history.
    
    Rules:
    1. Do NOT answer the question.
    2. Only output the standalone query, nothing else. No conversational preambles.
    3. Preserve the core semantic request of the latest follow-up question.
    4. Ensure any implicit pronouns (like "it", "this project", "their", "they") are resolved to the correct noun from the history (e.g. the specific project title like "StudyMate" or the person "Kamal").
    
    Chat History:
    {history_str}
    
    Follow-up Question: {query}
    
    Standalone Query:"""
    
    try:
        response = llm.invoke(prompt)
        standalone = response.content if hasattr(response, 'content') else response
        standalone = standalone.strip().replace('"', '')
        print(f"[*] Context-Aware Contextualization: '{query}' -> '{standalone}'")
        return standalone
    except Exception as e:
        print(f"[!] Query contextualization failed: {e}. Using original query.")
        return query

def detect_namespace(query: str, history: list = None) -> str:
    """
    Scans the contextualized query against active project titles and namespaces
    to determine which vector store to query. Handles single-project, multi-project,
    and general all-project queries. Falls back to 'resume'.
    """
    # 1. Resolve query pronouns to clear nouns using history
    contextualized = contextualize_query(query, history)
    normalized_query = contextualized.lower()
    print(f"[*] detect_namespace: normalized_query='{normalized_query}'")
    
    projects = database.list_projects()
    print(f"[*] detect_namespace: active projects={[p['namespace'] for p in projects]}")
    matched_namespaces = []
    
    for proj in projects:
        title = proj["title"].lower()
        namespace = proj["namespace"].lower()
        # Normalize underscores to spaces to ensure space-separated user queries match perfectly
        title_space = title.replace("_", " ").strip()
        ns_space = namespace.replace("_", " ").strip()
        
        print(f"[*] detect_namespace: testing title='{title}', namespace='{namespace}', title_space='{title_space}', ns_space='{ns_space}'")
        
        if (namespace in normalized_query or 
            title in normalized_query or 
            ns_space in normalized_query or 
            title_space in normalized_query):
            print(f"[*] detect_namespace: Match found! namespace='{namespace}'")
            matched_namespaces.append(namespace)
            
    if len(matched_namespaces) > 1:
        ns_str = ",".join(matched_namespaces)
        print(f"[*] Chat Routing: Query matched multiple projects: {matched_namespaces}. Selecting namespace 'multi_project:{ns_str}'.")
        return f"multi_project:{ns_str}"
    elif len(matched_namespaces) == 1:
        print(f"[*] Chat Routing: Query matched project. Selecting namespace '{matched_namespaces[0]}'.")
        return matched_namespaces[0]
        
    # Check if it's asking about projects in general
    general_indicators = [
        "projects", "developed", "built", "engineered", "portfolio", "work", 
        "what did you build", "what have you built", "list of project", "your projects", "explain all projects"
    ]
    if any(indicator in normalized_query for indicator in general_indicators):
        print("[*] Chat Routing: Query matched all projects intent. Selecting namespace 'all_projects'.")
        return "all_projects"
        
    # Check if there is continuity in history
    if history:
        for turn in reversed(history):
            if turn.get("namespace"):
                last_ns = turn.get("namespace")
                print(f"[*] Chat Routing: Continuity hit! Reusing last active namespace '{last_ns}'.")
                return last_ns
                
    print("[*] Chat Routing: No specific project title matched. Selecting fallback namespace 'resume'.")
    return "resume"

def generate_queries(original_query: str) -> list:
    """Uses LLM query expansion to get 3 alternative search views. Falls back to original query on error."""
    llm = get_llm()
    if not llm:
        print("[!] No LLM client available. Skipping query expansion.")
        return [original_query]
        
    prompt = f"""You are an expert search strategist. 
    Your task is to analyze the user's question and generate exactly 3 highly effective search queries to retrieve the most relevant information from a vector database of documents.
    
    Instructions:
    1. Identify the core semantic intent of the question.
    2. Correct any spelling or grammatical errors.
    3. Use synonyms and alternative phrasing the document author might have used.
    4. Output EXACTLY 3 queries. Output them one per line. Do NOT use bullet points, numbering, or introductory text.
    
    User Question: {original_query}
    """
    try:
        response = llm.invoke(prompt)
        response_text = response.content if hasattr(response, 'content') else response
        
        # Clean results (remove bullets, numbers)
        raw_lines = response_text.split('\n')
        clean_queries = []
        for line in raw_lines:
            q = re.sub(r'^\d+[\.\)]\s*', '', line.strip()) # Remove '1.' or '1)'
            q = re.sub(r'^[\-\*•]\s*', '', q)            # Remove bullets
            if q and len(q) > 5:
                clean_queries.append(q)
                
        print(f"[*] Expanded search terms: {clean_queries[:3]}")
        clean_queries.append(original_query)
        return list(set(clean_queries[:4]))
    except Exception as e:
        print(f"[!] Query expansion failed: {e}. Utilizing original query.")
        return [original_query]

def ask_question(question: str, namespace: str, history: list = None):
    """
    Queries the vector database for a specific namespace, aggregates 
    relevant chunks, and generates a grounded, first-person response.
    Supports in-memory query caching and advanced all-projects / multi-project retrieval.
    """
    # 0. Check cache first for instantaneous performance
    cached = check_cache(question, namespace)
    if cached:
        return cached[0], cached[1]

    # 1. Expand contextualized search query
    search_query = contextualize_query(question, history)
    search_queries = generate_queries(search_query)

    docs = []
    if namespace == "all_projects":
        # Dynamic query across SQL and resume
        projects = database.list_projects()
        proj_details = []
        for idx, p in enumerate(projects):
            proj_details.append(
                f"Project #{idx+1}: {p['title']}\n"
                f"Overview/Summary: {p['summary']}\n"
                f"Technologies/Tags: {', '.join(p['tags']) if p['tags'] else 'None'}\n"
                f"Codebase Repository: {p['links'].get('github', 'N/A')}\n"
                f"Live Demonstration: {p['links'].get('demo', 'N/A')}"
            )
        
        context = "### My Projects Overview:\n" + "\n---\n".join(proj_details)
        
        # Pull up to 3 chunks from resume
        resume_docs = direct_similarity_search(search_query, "resume", k=3)
        context += "\n---\n### General Developer Info & Experience:\n" + "\n---\n".join([d.page_content for d in resume_docs])
        docs.extend(resume_docs)
            
    elif namespace.startswith("multi_project:"):
        namespaces = namespace.replace("multi_project:", "").split(",")
        unique_docs = {}
        for ns in namespaces:
            results = direct_similarity_search(search_query, ns, k=3)
            for d in results:
                unique_docs[d.page_content] = d
        docs = list(unique_docs.values())[:6]
        context = "\n---\n".join([f"[CONTENT]: {d.page_content}" for d in docs])
        
    else:
        # Standard flow
        # 2. Similarity search against Supabase vector index
        unique_docs = {}
        is_summary_query = any(word in search_query.lower() for word in ["abstract", "summary", "summarise", "intro", "overview"])
        
        for q in search_queries:
            results = direct_similarity_search(q, namespace, k=5)
            for d in results:
                unique_docs[d.page_content] = d
                
                # Neighborhood expansion logic (for Chronological documents like Resumes)
                page_num = d.metadata.get('page', 999)
                if is_summary_query and page_num < 5:
                    # Retrieve surrounding text pages if we are near the document head
                    adj_results = direct_similarity_search(f"Page {page_num+1} content", namespace, k=2)
                    for adj in adj_results:
                        unique_docs[adj.page_content] = adj

        all_docs = list(unique_docs.values())
        
        # Sort chronologically if doing summaries
        if is_summary_query:
            all_docs.sort(key=lambda x: x.metadata.get('page', 999))
            
        # Take a larger context size of up to 6 chunks
        docs = all_docs[:6]
        context = "\n---\n".join([f"[CONTENT]: {d.page_content}" for d in docs])

    # Compile dialogue history into string format
    history_str = ""
    if history and len(history) > 0:
        for turn in history[-4:]:
            role = "User" if turn.get("sender") == "user" else "Me"
            history_str += f"{role}: {turn.get('text')}\n"
    
    llm = get_llm()
    if not llm:
        return f"[Debug mode - Chunks only]\n\n" + "\n\n".join([d.page_content for d in docs]), docs
        
    # FIRST-PERSON SYSTEM PROMPT: Acting directly as you explaining your works
    prompt = f"""You are Kamal, the software developer presenting your portfolio website.
    Answer the user's question directly in the first person ("I", "my", "me") based strictly and only on the provided document context.

    ### Rules:
    1. **Strict Context Adherence**: Rely ONLY on the provided document context. If the provided context does NOT contain enough details to fully answer the question, respond EXACTLY with: "Information not found in the provided documents." - do NOT extrapolate, guess, or suggest potential outcomes that are not written in the context.
    2. **First-Person Professional Voice**: Speak in a highly professional, confident, and direct developer tone. Speak in the first person (e.g. "I built this project to...", "In my previous role, I engineered..."). Do NOT refer to "Kamal" in the third person.
    3. **Extreme Conciseness & Directness**: Do NOT include conversational filler, preambles, or fluff (like "I'm excited to share...", "As I reflect on...", "In my journey..."). Answer the question directly and professionally in 2-3 short paragraphs or clean bullet points.
    4. **Polished Markdown Formatting**: Use standard markdown headers, bold text, and lists to structure your response. Ensure all markdown headings are formatted cleanly with a single blank line preceding them.
    
    ### Chat History:
    {history_str}
    
    ### Document Context (Source of Truth):
    {context}
    
    ### User Question:
    {question}
    
    Provide your concise, professional first-person response below:
    """
    
    try:
        response = llm.invoke(prompt)
        response_text = response.content if hasattr(response, 'content') else response
        ans = response_text.strip()
        # Add completion to the cache
        add_to_cache(question, namespace, ans, docs)
        return ans, docs
    except Exception as e:
        print(f"[!] Answer generation failed: {e}")
        return f"Failed to generate answer due to an upstream model error: {str(e)}", []
