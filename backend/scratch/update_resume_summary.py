import sys
import os

# Add backend directory to path so imports work correctly
backend_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_path)

import app.database as database
import app.summarizer as summarizer
import fitz  # PyMuPDF

def main():
    print("[*] Accessing database to find existing resume...")
    resume_data = database.get_resume()
    if not resume_data:
        print("[!] No resume found in database to update.")
        return
    
    file_path = resume_data["file_path"]
    print(f"[+] Found resume file: {file_path}")
    
    if not os.path.exists(file_path):
        print(f"[!] Resume file does not exist at path: {file_path}")
        return
        
    print("[*] Extracting text from PDF resume...")
    doc = fitz.open(file_path)
    file_text = " ".join([page.get_text() for page in doc])
    
    print("[*] Generating new recruiter-optimized, first-person summary using updated prompt...")
    new_summary = summarizer.generate_summary(file_text, mode="resume")
    
    print(f"[+] New Summary:\n{new_summary}\n")
    
    print("[*] Saving new summary to SQLite database...")
    # SQLite schema expects: id, summary, file_path, updated_at
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    # Let's update both the summary and updated_at
    from datetime import datetime
    now_str = datetime.now().isoformat()
    
    cursor.execute("""
        INSERT OR REPLACE INTO resume (id, summary, file_path, updated_at)
        VALUES (1, ?, ?, ?)
    """, (new_summary, file_path, now_str))
    conn.commit()
    conn.close()
    
    print("[+] Database successfully updated!")

if __name__ == "__main__":
    main()
