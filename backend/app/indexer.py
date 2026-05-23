import os
from langchain_community.vectorstores import FAISS
import app.config as config

def create_index(chunks, namespace: str):
    """
    Generates embeddings for document chunks and saves the FAISS index 
    locally in a folder isolated by namespace.
    """
    print(f"[*] Starting embedding process for namespace: {namespace}")
    import app.retriever as retriever
    
    # Grab the globally cached embedding model
    embeddings = retriever.get_embeddings()
    
    # Generate the FAISS vector index from documents
    vector_db = FAISS.from_documents(chunks, embeddings)
    
    # Define isolated directory path for this namespace
    save_path = os.path.join(config.VECTOR_DIR, namespace)
    os.makedirs(config.VECTOR_DIR, exist_ok=True)
    
    # Save index to local disk
    vector_db.save_local(save_path)
    
    print(f"[+] Success! FAISS index created for namespace '{namespace}'.")
    return namespace
