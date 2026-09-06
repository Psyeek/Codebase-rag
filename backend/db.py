
import os
import time
import psycopg2
from pgvector.psycopg2 import register_vector
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
DB_HOST = os.getenv("POSTGRES_HOST", "localhost")
DB_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
DB_USER = os.getenv("POSTGRES_USER", "postgres")
DB_PASSWORD = os.getenv("POSTGRES_PASSWORD", "postgres")
DB_NAME = os.getenv("POSTGRES_DB", "rag_db")


def get_db_connection(max_retries=5, retry_delay=2):
    """Establish and return a connection to PostgreSQL."""
    for attempt in range(max_retries):
        try:
            if DATABASE_URL:
                # Support standard cloud connection strings (Supabase, Neon, Railway, Render)
                # Normalize postgres:// -> postgresql:// for psycopg2
                conn_url = DATABASE_URL
                if conn_url.startswith("postgres://"):
                    conn_url = "postgresql://" + conn_url[len("postgres://"):]
                conn = psycopg2.connect(conn_url)
            else:
                conn = psycopg2.connect(
                    host=DB_HOST,
                    port=DB_PORT,
                    user=DB_USER,
                    password=DB_PASSWORD,
                    dbname=DB_NAME,
                )
            return conn
        except psycopg2.OperationalError as e:
            if attempt < max_retries - 1:
                time.sleep(retry_delay)
            else:
                raise e


def init_db():
    """Initialize pgvector extension and create code_chunks table."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Enable pgvector extension
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            
            # Create code_chunks table matching exact user requirement:
            # code_chunks(id, file_path, chunk_index, content, embedding)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS code_chunks (
                    id SERIAL PRIMARY KEY,
                    file_path TEXT NOT NULL,
                    chunk_index INT NOT NULL,
                    content TEXT NOT NULL,
                    embedding vector(384)
                );
            """)
            
            # Create HNSW index for fast approximate nearest neighbor cosine search
            cur.execute("""
                CREATE INDEX IF NOT EXISTS code_chunks_embedding_idx 
                ON code_chunks USING hnsw (embedding vector_cosine_ops);
            """)

            # Create repo_metadata table for tracking currently ingested repository
            cur.execute("""
                CREATE TABLE IF NOT EXISTS repo_metadata (
                    id SERIAL PRIMARY KEY,
                    repo_url TEXT NOT NULL,
                    repo_name TEXT NOT NULL,
                    total_chunks INT NOT NULL,
                    total_files INT NOT NULL,
                    ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            
        conn.commit()
        # Register vector type for psycopg2
        register_vector(conn)
    finally:
        conn.close()


def save_repo_metadata(repo_url: str, repo_name: str, total_chunks: int, total_files: int):
    """Saves or updates repository metadata."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE repo_metadata RESTART IDENTITY;")
            cur.execute("""
                INSERT INTO repo_metadata (repo_url, repo_name, total_chunks, total_files)
                VALUES (%s, %s, %s, %s);
            """, (repo_url, repo_name, total_chunks, total_files))
        conn.commit()
    finally:
        conn.close()


def get_repo_metadata():
    """Returns the latest ingested repository metadata, or defaults to current code_chunks stats."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT repo_url, repo_name, total_chunks, total_files, ingested_at
                FROM repo_metadata
                ORDER BY id DESC
                LIMIT 1;
            """)
            row = cur.fetchone()
            if row:
                return {
                    "repo_url": row[0],
                    "repo_name": row[1],
                    "total_chunks": row[2],
                    "total_files": row[3],
                    "ingested_at": str(row[4]) if row[4] else None
                }
            
            # Fallback if table is empty: query code_chunks directly
            cur.execute("SELECT count(*), count(DISTINCT file_path) FROM code_chunks;")
            stats = cur.fetchone()
            total_chunks = stats[0] if stats else 0
            total_files = stats[1] if stats else 0
            return {
                "repo_url": "https://github.com/pallets/flask",
                "repo_name": "pallets/flask",
                "total_chunks": total_chunks,
                "total_files": total_files,
                "ingested_at": None
            }
    finally:
        conn.close()


if __name__ == "__main__":
    init_db()
    print("Database initialized successfully with pgvector and code_chunks table.")
