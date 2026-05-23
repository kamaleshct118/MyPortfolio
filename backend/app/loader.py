import re
import os
import shutil
from langchain_community.document_loaders import PyMuPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
import app.config as config

def clean_text(text: str) -> str:
    """
    Cleans raw text by stripping leading/trailing whitespace and 
    replacing multiple whitespace characters with single spaces.
    """
    return re.sub(r'\s+', ' ', text).strip()

def process_file(file_path: str, custom_id: str = None):
    """
    Loads, cleans, and chunks a file (PDF, Markdown, or Text).
    Copies the file to the backend upload directory for persistence.
    Returns:
        chunks: List[Document] - The text chunks
        doc_id: str - The safe namespace identifier
    """
    base_name = os.path.basename(file_path)
    file_ext = os.path.splitext(base_name)[1].lower()
    
    # Generate a safe namespace identifier
    if custom_id:
        doc_id = re.sub(r'[^a-zA-Z0-9_-]', '_', custom_id.lower())
    else:
        doc_id = re.sub(r'[^a-zA-Z0-9_-]', '_', os.path.splitext(base_name)[0].lower())
    
    # Save the file copy in the upload directory
    os.makedirs(config.UPLOAD_DIR, exist_ok=True)
    dest_path = os.path.join(config.UPLOAD_DIR, base_name)
    if os.path.abspath(file_path) != os.path.abspath(dest_path):
        shutil.copy2(file_path, dest_path)
        
    print(f"[*] Extracting text from {base_name} ({file_ext})...")
    docs = []
    
    if file_ext == ".pdf":
        loader = PyMuPDFLoader(dest_path)
        docs = loader.load()
        # Clean extracted text page by page
        for d in docs:
            d.page_content = clean_text(d.page_content)
            d.metadata["source"] = os.path.abspath(dest_path)
    else:
        # Standard text/markdown reading
        try:
            with open(dest_path, "r", encoding="utf-8") as f:
                content = f.read()
            cleaned_content = clean_text(content)
            # Create a single document object for text
            docs = [Document(page_content=cleaned_content, metadata={"source": os.path.abspath(dest_path), "page": 0})]
        except Exception as e:
            print(f"[!] Error reading text file: {e}")
            raise ValueError(f"Could not read text/markdown file: {str(e)}")
            
    print(f"[*] Splitting text into recursive chunks...")
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=400, 
        chunk_overlap=50,
        separators=["\n\n", "\n", ".", " ", ""]
    )
    chunks = splitter.split_documents(docs)
    
    # Inject chunk metadata for safety and traceability
    for idx, chunk in enumerate(chunks):
        chunk.metadata["namespace"] = doc_id
        chunk.metadata["chunk_id"] = f"{doc_id}_{idx}"
        if "page" not in chunk.metadata:
            chunk.metadata["page"] = 0
            
    print(f"[+] Document split successfully into {len(chunks)} chunks.")
    return chunks, doc_id

def process_text(text: str, custom_id: str, source_name: str):
    """
    Cleans and chunks raw text content directly without needing a file path.
    Returns:
        chunks: List[Document] - The text chunks
        doc_id: str - The safe namespace identifier
    """
    # Generate a safe namespace identifier
    doc_id = re.sub(r'[^a-zA-Z0-9_-]', '_', custom_id.lower())
    
    print(f"[*] Processing text for {source_name}...")
    cleaned_content = clean_text(text)
    abs_source = os.path.abspath(os.path.join(config.UPLOAD_DIR, source_name))
    docs = [Document(page_content=cleaned_content, metadata={"source": abs_source, "page": 0})]
            
    print(f"[*] Splitting text into recursive chunks...")
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=400, 
        chunk_overlap=50,
        separators=["\n\n", "\n", ".", " ", ""]
    )
    chunks = splitter.split_documents(docs)
    
    # Inject chunk metadata for safety and traceability
    for idx, chunk in enumerate(chunks):
        chunk.metadata["namespace"] = doc_id
        chunk.metadata["chunk_id"] = f"{doc_id}_{idx}"
        chunk.metadata["page"] = 0
            
    print(f"[+] Text split successfully into {len(chunks)} chunks.")
    return chunks, doc_id

