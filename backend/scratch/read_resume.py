import sys
import os

# Add backend root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.database as database

def main():
    resume = database.get_resume()
    if resume:
        out_path = os.path.join(os.path.dirname(__file__), "resume_content.txt")
        print(f"Writing to absolute path: {out_path}")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(summary)
    else:
        print("No resume found.")
        out_path = os.path.join(os.path.dirname(__file__), "resume_content.txt")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write("No resume found.")

if __name__ == "__main__":
    main()
