import sys
import os

# Add backend root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.database as database
import app.summarizer as summarizer

def main():
    resume = database.get_resume()
    if not resume:
        print("[!] No active resume found in SQLite. Nothing to regenerate.")
        return
        
    file_path = resume["file_path"]
    print(f"[*] Found active resume file: {file_path}")
    
    if not os.path.exists(file_path):
        print(f"[!] Resume file does not exist at local path: {file_path}")
        return
        
    # Extract text from file
    file_text = ""
    if file_path.lower().endswith(".pdf"):
        import fitz # PyMuPDF
        doc = fitz.open(file_path)
        file_text = " ".join([page.get_text() for page in doc])
    else:
        with open(file_path, "r", encoding="utf-8") as f:
            file_text = f.read()
            
    print("[*] Generating new summary in first-person using updated prompt...")
    new_summary = summarizer.generate_summary(file_text, mode="resume")
    print(f"[+] New generated summary:\n{new_summary}\n")
    
    # Save back to database
    database.save_resume(new_summary, file_path)
    print("[+] Successfully updated resume summary in SQLite database!")

if __name__ == "__main__":
    main()
