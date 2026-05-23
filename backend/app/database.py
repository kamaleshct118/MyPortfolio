import sqlite3
import json
import os
from datetime import datetime
import app.config as config

def get_db_connection():
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Create single resume table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS resume (
        id INTEGER PRIMARY KEY DEFAULT 1,
        summary TEXT NOT NULL,
        file_path TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CONSTRAINT one_row CHECK (id = 1)
    )
    """)
    
    # Create projects table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        readme_path TEXT NOT NULL,
        image_path TEXT NOT NULL,
        tags TEXT, -- Comma-separated list of tags
        links TEXT, -- JSON string of links
        namespace TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """)
    
    conn.commit()
    conn.close()

# --- Resume Database Operations ---

def save_resume(summary: str, file_path: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    now_str = datetime.utcnow().isoformat()
    
    # Overwrite the single row with id = 1
    cursor.execute("""
    INSERT OR REPLACE INTO resume (id, summary, file_path, updated_at)
    VALUES (1, ?, ?, ?)
    """, (summary, file_path, now_str))
    
    conn.commit()
    conn.close()

def get_resume():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM resume WHERE id = 1")
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None

def delete_resume_metadata():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM resume WHERE id = 1")
    conn.commit()
    conn.close()

# --- Project Database Operations ---

def create_project(title: str, summary: str, readme_path: str, image_path: str, tags: list, links: dict, namespace: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    now_str = datetime.utcnow().isoformat()
    
    tags_str = ",".join(tags) if tags else ""
    links_str = json.dumps(links) if links else "{}"
    
    cursor.execute("""
    INSERT INTO projects (title, summary, readme_path, image_path, tags, links, namespace, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (title, summary, readme_path, image_path, tags_str, links_str, namespace, now_str, now_str))
    
    project_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return project_id

def update_project(project_id: int, title: str, summary: str, readme_path: str, image_path: str, tags: list, links: dict):
    conn = get_db_connection()
    cursor = conn.cursor()
    now_str = datetime.utcnow().isoformat()
    
    tags_str = ",".join(tags) if tags else ""
    links_str = json.dumps(links) if links else "{}"
    
    cursor.execute("""
    UPDATE projects
    SET title = ?, summary = ?, readme_path = ?, image_path = ?, tags = ?, links = ?, updated_at = ?
    WHERE id = ?
    """, (title, summary, readme_path, image_path, tags_str, links_str, now_str, project_id))
    
    conn.commit()
    conn.close()

def get_project(project_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        proj = dict(row)
        proj["tags"] = [t.strip() for t in proj["tags"].split(",") if t.strip()] if proj["tags"] else []
        proj["links"] = json.loads(proj["links"]) if proj["links"] else {}
        return proj
    return None

def get_project_by_namespace(namespace: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE namespace = ?", (namespace,))
    row = cursor.fetchone()
    conn.close()
    if row:
        proj = dict(row)
        proj["tags"] = [t.strip() for t in proj["tags"].split(",") if t.strip()] if proj["tags"] else []
        proj["links"] = json.loads(proj["links"]) if proj["links"] else {}
        return proj
    return None

def list_projects():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    
    projects_list = []
    for row in rows:
        proj = dict(row)
        proj["tags"] = [t.strip() for t in proj["tags"].split(",") if t.strip()] if proj["tags"] else []
        proj["links"] = json.loads(proj["links"]) if proj["links"] else {}
        projects_list.append(proj)
    return projects_list

def delete_project_metadata(project_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()
