import sys
import os
# Add backend root to sys.path so 'import app.xxx' resolves correctly
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import re
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, status
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List

import json
import time
import shutil

import app.config as config
import app.database as database
import app.auth as auth
import app.loader as loader
import app.indexer as indexer
import app.retriever as retriever
import app.summarizer as summarizer

app = FastAPI(
    title="AI Portfolio Knowledge Assistant API",
    description="Backend services for project CRUD, resume CRUD, SSE streaming, and chatbot retrieval",
    version="1.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False, # Set to False to allow wildcard '*' origins under Bearer token authorization
    allow_methods=["*"],
    allow_headers=["*"],
)


# Mount uploads and static directories to serve files (Resume, Images)
app.mount("/uploads", StaticFiles(directory=config.UPLOAD_DIR), name="uploads")
app.mount("/static", StaticFiles(directory=config.STATIC_DIR), name="static")

@app.on_event("startup")
def startup_event():
    """Initializes the database on application startup."""
    database.init_db()
    print("[*] SQLite database initialized successfully.")

# --- Models ---

class LoginRequest(BaseModel):
    secret_key: str

class ChatHistoryItem(BaseModel):
    sender: str  # "user" or "bot"
    text: str
    namespace: str = None

class ChatRequest(BaseModel):
    message: str
    history: List[ChatHistoryItem] = []

# --- Authentication Endpoints ---

@app.post("/api/auth/login", tags=["Authentication"])
def login(payload: LoginRequest):
    """Authenticates the administrator using the secret key."""
    token = auth.validate_key(payload.secret_key)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid administrative secret key"
        )
    return {"token": token, "message": "Authenticated successfully"}

@app.get("/api/auth/status", tags=["Authentication"])
def check_auth(is_admin: bool = Depends(auth.require_admin)):
    """Validates if the current session token is active."""
    return {"authenticated": True}

@app.post("/api/auth/logout", tags=["Authentication"])
def logout(authorization: str = Form(...)):
    """Logs the admin out and terminates their session."""
    token = authorization.replace("Bearer ", "")
    auth.invalidate_token(token)
    return {"message": "Logged out successfully"}

# --- Resume Endpoints ---

@app.get("/api/resume", tags=["Resume"])
def get_resume():
    """Retrieves the single resume display summary and download path."""
    resume_data = database.get_resume()
    if not resume_data:
        return {"exists": False}
    
    # Generate direct download URL
    filename = os.path.basename(resume_data["file_path"])
    download_url = f"/uploads/{filename}"
    
    return {
        "exists": True,
        "summary": resume_data["summary"],
        "download_url": download_url,
        "updated_at": resume_data["updated_at"]
    }

@app.post("/api/resume/save", tags=["Resume"])
async def save_resume(
    file: UploadFile = File(...),
    is_admin: bool = Depends(auth.require_admin)
):
    """
    Saves a new resume, generating its AI summary and vector index.
    Streams progress states via SSE for real-time frontend updates.
    """
    if not file.filename.lower().endswith((".pdf", ".txt", ".md")):
        raise HTTPException(status_code=400, detail="Unsupported file format. Upload PDF, TXT or MD.")

    def sse_generator():
        temp_path = None
        try:
            # 1. State: Uploading File
            yield "data: Uploading File\n\n"
            time.sleep(0.4)
            
            # Create a local copy
            os.makedirs(config.UPLOAD_DIR, exist_ok=True)
            save_path = os.path.join(config.UPLOAD_DIR, file.filename)
            with open(save_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            # Read file text for summary generation
            file_text = ""
            if file.filename.lower().endswith(".pdf"):
                # Fast extract for summary
                import fitz # PyMuPDF
                doc = fitz.open(save_path)
                file_text = " ".join([page.get_text() for page in doc])
            else:
                with open(save_path, "r", encoding="utf-8") as f:
                    file_text = f.read()

            # 2. State: Generating Summary
            yield "data: Generating Summary\n\n"
            time.sleep(0.4)
            ai_summary = summarizer.generate_summary(file_text, mode="resume")

            # 3. State: Chunking Content
            yield "data: Chunking Content\n\n"
            time.sleep(0.4)
            chunks, namespace = loader.process_file(save_path, custom_id="resume")

            # 4. State: Generating Embeddings
            yield "data: Generating Embeddings\n\n"
            time.sleep(0.4)

            # 5. State: Saving to Vector DB
            yield "data: Saving to Vector DB\n\n"
            time.sleep(0.4)
            
            # Evict old cached DB
            retriever.unload_db("resume")
            # Create new FAISS index
            indexer.create_index(chunks, "resume")

            # Write metadata to SQL
            database.save_resume(ai_summary, save_path)

            # 6. State: RAG Processing Complete
            yield "data: RAG Processing Complete\n\n"
            
        except Exception as e:
            yield f"data: Error: {str(e)}\n\n"

    return StreamingResponse(sse_generator(), media_type="text/event-stream")

@app.delete("/api/resume", tags=["Resume"])
def delete_resume(is_admin: bool = Depends(auth.require_admin)):
    """Deletes the single resume and its vector namespace from the system."""
    resume_data = database.get_resume()
    if not resume_data:
        raise HTTPException(status_code=404, detail="No resume found to delete.")
        
    try:
        # 1. Delete original file
        if os.path.exists(resume_data["file_path"]):
            os.remove(resume_data["file_path"])
            
        # 2. Delete FAISS directory
        vector_path = os.path.join(config.VECTOR_DIR, "resume")
        if os.path.exists(vector_path):
            shutil.rmtree(vector_path)
            
        # 3. Evict from retriever cache
        retriever.unload_db("resume")
        
        # 4. Delete SQLite record
        database.delete_resume_metadata()
        
        return {"message": "Resume and its vectorized knowledge successfully deleted."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete resume: {str(e)}")

# --- Project Endpoints ---

@app.get("/api/projects", tags=["Projects"])
def get_projects():
    """Retrieves all projects list with display summaries and detail links."""
    projects = database.list_projects()
    for proj in projects:
        # Prepend base urls for static assets
        if proj["image_path"] and not proj["image_path"].startswith(("http://", "https://")):
            proj["image_path"] = f"/static/images/{os.path.basename(proj['image_path'])}"
        
        filename = os.path.basename(proj["readme_path"])
        proj["readme_url"] = f"/uploads/{filename}"
        
    return {"projects": projects}

@app.get("/api/projects/{project_id}", tags=["Projects"])
def get_project(project_id: int):
    """Retrieves a single project's details."""
    proj = database.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
        
    if proj["image_path"] and not proj["image_path"].startswith(("http://", "https://")):
        proj["image_path"] = f"/static/images/{os.path.basename(proj['image_path'])}"
        
    filename = os.path.basename(proj["readme_path"])
    proj["readme_url"] = f"/uploads/{filename}"
    
    return proj

@app.post("/api/projects/save", tags=["Projects"])
async def save_project(
    project_id: str = Form(None), # "none" or integer as string
    title: str = Form(...),
    image_url: str = Form(None),
    tags: str = Form(None),
    links: str = Form(None),
    readme_text: str = Form(None),
    image_file: UploadFile = File(None),
    is_admin: bool = Depends(auth.require_admin)
):
    """
    Saves (Creates or Edits) a project.
    If a new README is supplied, runs Pipeline 1 and 2, updating summaries and vector stores.
    Streams SSE progress states to the frontend.
    """
    # Parse project tags and links
    parsed_tags = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    try:
        parsed_links = json.loads(links) if links else {}
    except ValueError:
        parsed_links = {}

    # Define unique namespace identifier based on title
    namespace = re.sub(r'[^a-zA-Z0-9_-]', '_', title.lower().replace(" ", "_"))

    # Determine if we are editing an existing project
    is_edit = False
    existing_proj = None
    if project_id and project_id.lower() != "none" and project_id.isdigit():
        existing_proj = database.get_project(int(project_id))
        if existing_proj:
            is_edit = True

    def sse_generator():
        try:
            # 1. State: Uploading File
            yield "data: Uploading File\n\n"
            time.sleep(0.4)

            # Handle Image path (either uploaded file or external url)
            final_image_path = ""
            if image_file:
                # Save uploaded image locally to static/images/
                image_ext = os.path.splitext(image_file.filename)[1].lower()
                safe_image_name = f"{namespace}{image_ext}"
                local_img_path = os.path.join(config.STATIC_DIR, "images", safe_image_name)
                with open(local_img_path, "wb") as buffer:
                    shutil.copyfileobj(image_file.file, buffer)
                final_image_path = local_img_path
            elif image_url:
                final_image_path = image_url
            elif is_edit:
                # Retain old image path if editing
                final_image_path = existing_proj["image_path"]

            # Check if README has changed when editing (strip \r to prevent Windows CRLF differences)
            readme_changed = True
            if is_edit and existing_proj and os.path.exists(existing_proj["readme_path"]):
                try:
                    with open(existing_proj["readme_path"], "r", encoding="utf-8") as f:
                        old_content = f.read()
                    clean_new = readme_text.replace("\r", "").strip() if readme_text else ""
                    clean_old = old_content.replace("\r", "").strip() if old_content else ""
                    if clean_new == clean_old or not readme_text:
                        readme_changed = False
                except Exception:
                    pass

            if not readme_text and not is_edit:
                raise ValueError("README markdown content is required when creating a new project.")

            # Process README text if provided and changed
            if readme_changed and readme_text:
                # Save README content to a markdown file locally (so database has the path and we can fetch/download it)
                readme_filename = f"{namespace}_README.md"
                save_readme_path = os.path.join(config.UPLOAD_DIR, readme_filename)
                with open(save_readme_path, "w", encoding="utf-8") as f:
                    f.write(readme_text)

                readme_content = readme_text

                # 2. State: Generating Summary
                yield "data: Generating Summary\n\n"
                time.sleep(0.4)
                ai_summary = summarizer.generate_summary(readme_content, mode="project")

                # 3. State: Chunking Content
                yield "data: Chunking Content\n\n"
                time.sleep(0.4)
                chunks, _ = loader.process_text(readme_content, custom_id=namespace, source_name=readme_filename)

                # 4. State: Generating Embeddings
                yield "data: Generating Embeddings\n\n"
                time.sleep(0.4)

                # 5. State: Saving to Vector DB
                yield "data: Saving to Vector DB\n\n"
                time.sleep(0.4)
                
                # Evict old cached DB index
                retriever.unload_db(namespace)
                # Save FAISS index
                indexer.create_index(chunks, namespace)
                
            else:
                # If editing without uploading a new README file
                if not is_edit:
                    raise ValueError("README text is required when creating a new project.")
                
                # Retain existing README details and summary
                save_readme_path = existing_proj["readme_path"]
                ai_summary = existing_proj["summary"]
                
                yield "data: Skipping RAG (Using cached index)\n\n"
                time.sleep(0.4)

            # 6. Save or update database record
            if is_edit:
                database.update_project(
                    project_id=existing_proj["id"],
                    title=title,
                    summary=ai_summary,
                    readme_path=save_readme_path,
                    image_path=final_image_path,
                    tags=parsed_tags,
                    links=parsed_links
                )
            else:
                database.create_project(
                    title=title,
                    summary=ai_summary,
                    readme_path=save_readme_path,
                    image_path=final_image_path,
                    tags=parsed_tags,
                    links=parsed_links,
                    namespace=namespace
                )

            yield "data: RAG Processing Complete\n\n"

        except Exception as e:
            yield f"data: Error: {str(e)}\n\n"

    return StreamingResponse(sse_generator(), media_type="text/event-stream")

@app.delete("/api/projects/{project_id}", tags=["Projects"])
def delete_project(project_id: int, is_admin: bool = Depends(auth.require_admin)):
    """Deletes a project, its stored files, and its isolated vector store namespace."""
    proj = database.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found.")
        
    try:
        # 1. Delete original README file
        if os.path.exists(proj["readme_path"]):
            os.remove(proj["readme_path"])
            
        # 2. Delete local image if uploaded
        if proj["image_path"] and not proj["image_path"].startswith(("http://", "https://")):
            # Convert served URL path back to absolute local path
            filename = os.path.basename(proj["image_path"])
            local_img_path = os.path.join(config.STATIC_DIR, "images", filename)
            if os.path.exists(local_img_path):
                os.remove(local_img_path)
                
        # 3. Delete FAISS directory
        vector_path = os.path.join(config.VECTOR_DIR, proj["namespace"])
        if os.path.exists(vector_path):
            shutil.rmtree(vector_path)
            
        # 4. Evict from retriever memory cache
        retriever.unload_db(proj["namespace"])
        
        # 5. Delete metadata
        database.delete_project_metadata(project_id)
        
        return {"message": f"Project '{proj['title']}' successfully deleted."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete project: {str(e)}")

# --- Chatbot Endpoint ---

@app.post("/api/chat", tags=["AI Chatbot"])
def chat(payload: ChatRequest):
    """
    Converses with the portfolio knowledge base.
    Automatically detects the target namespace and retrieves contextual chunks.
    """
    if not payload.message.strip():
        raise HTTPException(status_code=400, detail="Empty query not allowed.")
        
    try:
        # Parse history as standard dictionary list for RAG engine
        history_list = [
            {"sender": h.sender, "text": h.text, "namespace": h.namespace} 
            for h in payload.history
        ]
        
        # 1. Auto-detect namespace based on query keyword matching and chat history
        namespace = retriever.detect_namespace(payload.message, history_list)
        
        # 2. Query retrieval and grounded answer synthesis
        answer, sources = retriever.ask_question(payload.message, namespace, history_list)
        
        # 3. Compile sources pages / references
        source_files = list(set([doc.metadata.get('source', 'Document') for doc in sources]))
        
        return {
            "answer": answer,
            "namespace": namespace,
            "sources": source_files
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chatbot failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
