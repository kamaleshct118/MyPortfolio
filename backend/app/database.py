from supabase import create_client, Client
import app.config as config
from datetime import datetime
import json

# Global client cache
supabase_client = None

def get_supabase_client() -> Client:
    """Returns the globally cached Supabase client, instantiating it if necessary."""
    global supabase_client
    if supabase_client is None:
        if not config.SUPABASE_URL or not config.SUPABASE_KEY:
            raise ValueError(
                "SUPABASE_URL and SUPABASE_KEY must be set in environment variables/config."
            )
        supabase_client = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)
    return supabase_client

def init_db():
    """Validates database connectivity to Supabase and checks if tables exist."""
    try:
        client = get_supabase_client()
        # Test queries to verify tables exist
        client.table("resume").select("id").limit(1).execute()
        client.table("projects").select("id").limit(1).execute()
        print("[*] Successfully connected to Supabase and verified tables exist.")
    except Exception as e:
        print(f"[!] Supabase connectivity check failed: {e}")
        print("[!] Make sure to run the Supabase schema setup SQL script in your dashboard SQL Editor.")

# --- Resume Database Operations ---

def save_resume(summary: str, file_path: str):
    """Saves or updates the single resume record (id = 1) in the Supabase DB."""
    client = get_supabase_client()
    now_str = datetime.utcnow().isoformat()
    
    client.table("resume").upsert({
        "id": 1,
        "summary": summary,
        "file_path": file_path,
        "updated_at": now_str
    }).execute()

def get_resume():
    """Retrieves the single resume record (id = 1) from the Supabase DB."""
    client = get_supabase_client()
    try:
        response = client.table("resume").select("*").eq("id", 1).execute()
        if response.data and len(response.data) > 0:
            return response.data[0]
    except Exception as e:
        print(f"[!] Error fetching resume from Supabase: {e}")
    return None

def delete_resume_metadata():
    """Deletes the single resume record from the Supabase DB."""
    client = get_supabase_client()
    client.table("resume").delete().eq("id", 1).execute()

# --- Project Database Operations ---

def create_project(title: str, summary: str, readme_path: str, image_path: str, tags: list, links: dict, namespace: str):
    """Inserts a new project record into the Supabase projects table."""
    client = get_supabase_client()
    now_str = datetime.utcnow().isoformat()
    
    tags_str = ",".join(tags) if tags else ""
    links_data = links if links else {}
    
    response = client.table("projects").insert({
        "title": title,
        "summary": summary,
        "readme_path": readme_path,
        "image_path": image_path,
        "tags": tags_str,
        "links": links_data,
        "namespace": namespace,
        "created_at": now_str,
        "updated_at": now_str
    }).execute()
    
    if response.data and len(response.data) > 0:
        return response.data[0]["id"]
    raise RuntimeError("Failed to create project in Supabase")

def update_project(project_id: int, title: str, summary: str, readme_path: str, image_path: str, tags: list, links: dict):
    """Updates an existing project record in the Supabase projects table."""
    client = get_supabase_client()
    now_str = datetime.utcnow().isoformat()
    
    tags_str = ",".join(tags) if tags else ""
    links_data = links if links else {}
    
    client.table("projects").update({
        "title": title,
        "summary": summary,
        "readme_path": readme_path,
        "image_path": image_path,
        "tags": tags_str,
        "links": links_data,
        "updated_at": now_str
    }).eq("id", project_id).execute()

def get_project(project_id: int):
    """Retrieves a single project by ID and parses fields (tags, links)."""
    client = get_supabase_client()
    response = client.table("projects").select("*").eq("id", project_id).execute()
    if response.data and len(response.data) > 0:
        proj = response.data[0]
        proj["tags"] = [t.strip() for t in proj["tags"].split(",") if t.strip()] if proj["tags"] else []
        if isinstance(proj["links"], str):
            proj["links"] = json.loads(proj["links"])
        return proj
    return None

def get_project_by_namespace(namespace: str):
    """Retrieves a single project by namespace and parses fields (tags, links)."""
    client = get_supabase_client()
    response = client.table("projects").select("*").eq("namespace", namespace).execute()
    if response.data and len(response.data) > 0:
        proj = response.data[0]
        proj["tags"] = [t.strip() for t in proj["tags"].split(",") if t.strip()] if proj["tags"] else []
        if isinstance(proj["links"], str):
            proj["links"] = json.loads(proj["links"])
        return proj
    return None

def list_projects():
    """Lists all projects ordered by creation date, parsing tags and links for each."""
    client = get_supabase_client()
    try:
        response = client.table("projects").select("*").order("created_at", desc=True).execute()
        projects_list = []
        for row in response.data:
            proj = dict(row)
            proj["tags"] = [t.strip() for t in proj["tags"].split(",") if t.strip()] if proj["tags"] else []
            if isinstance(proj["links"], str):
                proj["links"] = json.loads(proj["links"])
            projects_list.append(proj)
        return projects_list
    except Exception as e:
        print(f"[!] Error listing projects from Supabase: {e}")
        return []

def delete_project_metadata(project_id: int):
    """Deletes a project's metadata from the Supabase database."""
    client = get_supabase_client()
    client.table("projects").delete().eq("id", project_id).execute()

def upload_file_to_storage(bucket: str, path: str, file_data: bytes, content_type: str = None) -> str:
    """
    Uploads a file to a Supabase Storage bucket and returns its public URL.
    Automatically creates the bucket as public if it does not exist.
    """
    client = get_supabase_client()
    try:
        # Check and create public bucket if missing
        buckets = client.storage.list_buckets()
        bucket_names = [b.name for b in buckets]
        if bucket not in bucket_names:
            client.storage.create_bucket(bucket, options={"public": True})
            print(f"[*] Created new public bucket: '{bucket}'")
    except Exception as e:
        print(f"[!] Error checking/creating bucket: {e}")

    try:
        # Clean path and upload file (using upsert=true)
        clean_path = path.lstrip("/")
        options = {"content-type": content_type} if content_type else {}
        
        client.storage.from_(bucket).upload(
            path=clean_path,
            file=file_data,
            file_options={"upsert": "true", **options}
        )
        
        # Retrieve public URL
        url = client.storage.from_(bucket).get_public_url(clean_path)
        print(f"[+] File uploaded successfully. Public URL: {url}")
        return url
    except Exception as e:
        print(f"[!] Error uploading file to Supabase: {e}")
        # Try returning public URL anyway as fallback
        try:
            return client.storage.from_(bucket).get_public_url(path.lstrip("/"))
        except Exception:
            raise e

