import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
import numpy as np
from sentence_transformers import SentenceTransformer
from pgvector.psycopg2 import register_vector
import psycopg2
from psycopg2.extras import execute_batch

# Import database initialization and connection helper
from db import init_db, get_db_connection, save_repo_metadata

# Extensions to include
ALLOWED_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx",
    ".java", ".go", ".rs", ".cs", ".md", ".sql", ".yaml",
    ".yml", ".json"
}

# Directories to skip
IGNORED_DIRECTORIES = {
    ".git", "node_modules", "__pycache__", "venv",
    ".venv", "dist", "build", "target", "vendor",
    ".github", ".vscode", ".idea", "bin", "obj",
    "packages", "assets", "static", "public",
    "gradle", ".gradle"
}

# Ignored filename patterns
IGNORED_FILE_PATTERNS = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "cargo.lock", "poetry.lock", "composer.lock"
}

# Safety caps for responsive ingestion
MAX_FILES = 500
MAX_CHUNKS = 1500
MAX_FILE_SIZE = 250 * 1024  # 250 KB

# Chunking parameters
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200
STEP_SIZE = CHUNK_SIZE - CHUNK_OVERLAP  # 1000 chars step

MODEL_NAME = "all-MiniLM-L6-v2"


def extract_repo_name(repo_url: str) -> str:
    """Extracts owner/repo from GitHub URL, e.g. https://github.com/pallets/flask -> pallets/flask."""
    clean_url = repo_url.strip().rstrip("/")
    if clean_url.endswith(".git"):
        clean_url = clean_url[:-4]
    parts = clean_url.split("/")
    if len(parts) >= 2:
        return f"{parts[-2]}/{parts[-1]}"
    return clean_url


def clone_repository(repo_url: str, target_dir: str):
    """Shallow clones a git repository into the specified directory."""
    print(f"--> Cloning repository (shallow): {repo_url}")
    cmd = ["git", "clone", "--depth", "1", repo_url, target_dir]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Git clone failed:\n{result.stderr}")
    print(f"--> Successfully cloned into {target_dir}")


def should_skip_dir(dir_path: Path) -> bool:
    """Check if any parent or current directory name is in IGNORED_DIRECTORIES."""
    for part in dir_path.parts:
        if part in IGNORED_DIRECTORIES:
            return True
    return False


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP):
    """Chunks text into fixed size slices with overlap."""
    chunks = []
    text_len = len(text)
    if text_len == 0:
        return chunks
    if text_len <= chunk_size:
        return [text]
    
    start = 0
    step = max(1, chunk_size - overlap)
    while start < text_len:
        end = min(start + chunk_size, text_len)
        chunk = text[start:end]
        if chunk.strip():
            chunks.append(chunk)
        if end >= text_len:
            break
        start += step
    return chunks


def scan_and_chunk_repo(repo_dir: str, max_files: int = MAX_FILES, max_chunks: int = MAX_CHUNKS):
    """Traverses repository files, filters by extension, and chunks contents."""
    repo_path = Path(repo_dir).resolve()
    chunks_data = []  # List of tuples: (relative_file_path, chunk_index, content)
    
    total_files_scanned = 0
    total_files_included = 0

    for root, dirs, files in os.walk(repo_path):
        # Filter directories in-place to avoid descending into ignored dirs
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRECTORIES]
        
        current_dir_path = Path(root)
        if should_skip_dir(current_dir_path):
            continue

        for file in files:
            total_files_scanned += 1
            if file.lower() in IGNORED_FILE_PATTERNS or file.endswith(".min.js") or file.endswith(".min.css"):
                continue

            file_path = current_dir_path / file
            
            if file_path.suffix.lower() in ALLOWED_EXTENSIONS:
                try:
                    # Skip massive data files
                    if file_path.stat().st_size > MAX_FILE_SIZE:
                        continue

                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()
                    
                    # Compute relative path for clean citation
                    rel_path = file_path.relative_to(repo_path).as_posix()
                    file_chunks = chunk_text(content)
                    
                    for idx, chunk in enumerate(file_chunks):
                        chunks_data.append({
                            "file_path": rel_path,
                            "chunk_index": idx,
                            "content": chunk
                        })
                        if len(chunks_data) >= max_chunks:
                            break
                    
                    total_files_included += 1
                    if len(chunks_data) >= max_chunks or total_files_included >= max_files:
                        break
                except Exception as e:
                    print(f"Warning: Failed to read {file_path}: {e}")

        if len(chunks_data) >= max_chunks or total_files_included >= max_files:
            print(f"--> Reached safety limit: {len(chunks_data)} chunks across {total_files_included} files.")
            break

    print(f"--> Scanned {total_files_scanned} files. Included {total_files_included} code files.")
    print(f"--> Generated {len(chunks_data)} total chunks (~{CHUNK_SIZE} chars, {CHUNK_OVERLAP} overlap).")
    return chunks_data, total_files_included


def store_chunks(chunks_data: list, model: SentenceTransformer, batch_size: int = 128, progress_cb=None):
    """Generates embeddings locally and stores chunks into PostgreSQL via pgvector."""
    if not chunks_data:
        print("No chunks to store.")
        return

    total_chunks = len(chunks_data)
    batch_records = []

    print(f"--> Computing embeddings with {MODEL_NAME} for {total_chunks} chunks in batches of {batch_size}...")
    for i in range(0, total_chunks, batch_size):
        batch = chunks_data[i:i + batch_size]
        texts = [item["content"] for item in batch]
        
        # Compute embeddings locally in memory first (without holding DB locks)
        embeddings = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
        
        for item, emb in zip(batch, embeddings):
            batch_records.append((
                item["file_path"],
                item["chunk_index"],
                item["content"],
                np.array(emb, dtype=np.float32)
            ))
            
        processed = min(i + batch_size, total_chunks)
        print(f"    Computed embeddings {processed} / {total_chunks}")
        if progress_cb:
            pct = 30 + int(60 * (processed / total_chunks))
            progress_cb("embedding", pct, f"Computing embeddings ({processed}/{total_chunks} chunks)...")

    # Fast insertion into PostgreSQL
    if progress_cb:
        progress_cb("saving", 92, "Storing chunks in PostgreSQL vector index...")

    print("--> Connecting to database and committing chunks...")
    init_db()
    conn = get_db_connection()
    register_vector(conn)

    try:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE code_chunks RESTART IDENTITY;")
            insert_sql = """
                INSERT INTO code_chunks (file_path, chunk_index, content, embedding)
                VALUES (%s, %s, %s, %s)
            """
            execute_batch(cur, insert_sql, batch_records)
            conn.commit()
            print("--> All chunks successfully committed to PostgreSQL!")
    finally:
        conn.close()


def ingest(repo_url: str, model: SentenceTransformer = None, progress_cb=None):
    """Main ingestion orchestrator."""
    repo_name = extract_repo_name(repo_url)
    print(f"\n=======================================================")
    print(f"Starting Ingestion for: {repo_name} ({repo_url})")
    print(f"=======================================================\n")
    
    if progress_cb:
        progress_cb("cloning", 10, f"Cloning {repo_name} (shallow --depth 1)...")

    # Load sentence transformer model locally if not provided
    if model is None:
        print(f"--> Loading embedding model: {MODEL_NAME}...")
        model = SentenceTransformer(MODEL_NAME)
    
    # Create temp directory for shallow clone
    temp_dir = tempfile.mkdtemp(prefix="repo_clone_")
    try:
        clone_repository(repo_url, temp_dir)
        
        if progress_cb:
            progress_cb("scanning", 25, "Scanning code files and generating chunks...")

        chunks_data, total_files = scan_and_chunk_repo(temp_dir)
        store_chunks(chunks_data, model, progress_cb=progress_cb)
        
        # Save repo metadata to database
        save_repo_metadata(repo_url, repo_name, len(chunks_data), total_files)
        
        if progress_cb:
            progress_cb("completed", 100, f"Successfully ingested {repo_name} ({len(chunks_data)} chunks)!")

        print("\n=======================================================")
        print(f"Ingestion of {repo_name} completed successfully!")
        print("=======================================================\n")
        
        return {
            "status": "success",
            "repo_url": repo_url,
            "repo_name": repo_name,
            "total_chunks": len(chunks_data),
            "total_files": total_files
        }
    finally:
        print(f"--> Cleaning up temporary clone directory: {temp_dir}")
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest a GitHub repository into pgvector.")
    parser.add_argument(
        "repo_url",
        nargs="?",
        default="https://github.com/pallets/flask",
        help="GitHub repository URL to clone and ingest (default: https://github.com/pallets/flask)"
    )
    args = parser.parse_args()
    ingest(args.repo_url)
