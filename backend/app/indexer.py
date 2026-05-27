from langchain_community.vectorstores import SupabaseVectorStore
import app.config as config
import app.retriever as retriever

def create_index(chunks, namespace: str):
    """
    Generates embeddings for document chunks and saves them in the remote Supabase
    vector store under the specified namespace metadata.
    """
    print(f"[*] Starting embedding process and uploading to Supabase namespace: {namespace}")
    
    # Grab the globally cached embedding model
    embeddings = retriever.get_embeddings()
    
    # Initialize the Supabase client
    from app.database import get_supabase_client
    supabase_client = get_supabase_client()
    
    # Save documents directly into Supabase (automatically uses pgvector match_documents function)
    SupabaseVectorStore.from_documents(
        documents=chunks,
        embedding=embeddings,
        client=supabase_client,
        table_name="documents",
        query_name="match_documents"
    )
    
    print(f"[+] Success! Chunks successfully embedded and uploaded to Supabase for namespace '{namespace}'.")
    return namespace

def delete_index(namespace: str):
    """
    Deletes all document vectors and texts under the specified namespace 
    from the Supabase database.
    """
    print(f"[*] Deleting all Supabase document embeddings for namespace: {namespace}")
    from app.database import get_supabase_client
    try:
        client = get_supabase_client()
        # Filter and delete where the JSONB metadata field 'namespace' equals target
        client.table("documents").delete().eq("metadata->>namespace", namespace).execute()
        print(f"[+] Successfully purged vector embeddings for namespace: {namespace}")
    except Exception as e:
        print(f"[!] Error purging vector embeddings for namespace {namespace}: {e}")
