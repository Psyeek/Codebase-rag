import torch
import numpy as np
from sentence_transformers import SentenceTransformer
from pgvector.psycopg2 import register_vector
from db import get_db_connection

# Constrain PyTorch thread pool to prevent memory amplification in constrained containers
try:
    torch.set_num_threads(1)
except Exception:
    pass

MODEL_NAME = "all-MiniLM-L6-v2"
_model = None

def get_embedding_model() -> SentenceTransformer:
    """Lazy load embedding model as singleton."""
    global _model
    if _model is None:
        _model = SentenceTransformer(MODEL_NAME)
    return _model


def retrieve_chunks(question: str, top_k: int = 5):
    """
    Embeds the user question and retrieves top-k most similar code chunks
    from PostgreSQL using pgvector cosine distance (<=>).
    """
    if not question or not question.strip():
        return [], []

    model = get_embedding_model()
    with torch.no_grad():
        query_emb = model.encode(question.strip(), normalize_embeddings=True)
    query_vec = np.array(query_emb, dtype=np.float32)

    conn = get_db_connection()
    register_vector(conn)
    
    chunks = []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, file_path, chunk_index, content, 
                       1 - (embedding <=> %s) AS similarity
                FROM code_chunks
                ORDER BY embedding <=> %s
                LIMIT %s;
            """, (query_vec, query_vec, top_k))
            
            rows = cur.fetchall()
            for r in rows:
                chunks.append({
                    "id": r[0],
                    "file_path": r[1],
                    "chunk_index": r[2],
                    "content": r[3],
                    "similarity": round(float(r[4]), 4)
                })
    finally:
        conn.close()

    # Extract unique source files preserving order
    sources = list(dict.fromkeys(c["file_path"] for c in chunks))
    return chunks, sources
