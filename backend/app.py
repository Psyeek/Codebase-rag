import os
import re
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from groq import Groq

from retrieval import retrieve_chunks, get_embedding_model
from ingest import ingest as run_ingest, extract_repo_name
from db import get_repo_metadata, init_db

load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable Cross-Origin Resource Sharing for React frontend

# Auto-initialize database schema if database is reachable on startup
try:
    init_db()
except Exception as _e:
    print(f"[WARN] Automatic database initialization deferred: {_e}")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")


def format_context_for_prompt(chunks: list) -> str:
    """Formats retrieved code chunks into a clear prompt context with file citations."""
    context_blocks = []
    for idx, chunk in enumerate(chunks, 1):
        block = f"--- [Snippet {idx}] File: {chunk['file_path']} (Chunk #{chunk['chunk_index']}, Similarity: {chunk['similarity']}) ---\n{chunk['content']}"
        context_blocks.append(block)
    return "\n\n".join(context_blocks)


@app.route("/health", methods=["GET"])
def health():
    """Healthcheck endpoint."""
    return jsonify({"status": "ok", "service": "codebase-rag-backend"})


@app.route("/repo-info", methods=["GET"])
def repo_info():
    """Returns metadata for the currently ingested repository."""
    try:
        metadata = get_repo_metadata()
        return jsonify(metadata)
    except Exception as e:
        return jsonify({
            "repo_url": "https://github.com/pallets/flask",
            "repo_name": "pallets/flask",
            "total_chunks": 0,
            "total_files": 0,
            "error": str(e)
        })


# Global in-memory ingestion progress state
ingest_state = {
    "is_ingesting": False,
    "stage": "idle",
    "percent": 0,
    "message": "",
    "repo_name": "",
    "repo_url": "",
    "error": None,
    "stats": None
}


def update_ingest_progress(stage: str, percent: int, message: str):
    """Callback passed to ingest.py to update real-time progress."""
    global ingest_state
    ingest_state["stage"] = stage
    ingest_state["percent"] = percent
    ingest_state["message"] = message


def async_ingest_worker(clean_url: str):
    """Background worker thread for cloning, chunking, and embedding."""
    global ingest_state
    try:
        model = get_embedding_model()
        stats = run_ingest(clean_url, model=model, progress_cb=update_ingest_progress)
        ingest_state["is_ingesting"] = False
        ingest_state["stage"] = "completed"
        ingest_state["percent"] = 100
        ingest_state["message"] = f"Successfully ingested {stats['repo_name']} ({stats['total_chunks']} chunks)!"
        ingest_state["stats"] = stats
        ingest_state["error"] = None
    except Exception as e:
        ingest_state["is_ingesting"] = False
        ingest_state["stage"] = "error"
        ingest_state["percent"] = 0
        ingest_state["error"] = str(e)
        ingest_state["message"] = f"Ingestion failed: {str(e)}"


@app.route("/ingest/progress", methods=["GET"])
def ingest_progress():
    """Returns current real-time ingestion progress."""
    return jsonify(ingest_state)


@app.route("/ingest", methods=["POST"])
def ingest_endpoint():
    """
    POST /ingest
    Request Body:
      {
        "repo_url": "https://github.com/owner/repo"
      }
    Starts background ingestion job and returns immediately.
    """
    global ingest_state
    try:
        data = request.get_json(silent=True) or {}
        repo_url = data.get("repo_url", "").strip()

        if not repo_url:
            return jsonify({"error": "Missing 'repo_url' in request body."}), 400

        if ingest_state["is_ingesting"]:
            return jsonify({
                "error": f"Another repository is currently being ingested ({ingest_state['repo_name']}). Please wait for it to complete."
            }), 409

        # Normalize and validate GitHub URL
        if not repo_url.startswith("http://") and not repo_url.startswith("https://"):
            repo_url = "https://" + repo_url

        github_pattern = r"^https?://(www\.)?github\.com/[\w.-]+/[\w.-]+/?.*$"
        if not re.match(github_pattern, repo_url):
            return jsonify({
                "error": "Invalid GitHub repository URL. Must be like https://github.com/owner/repository"
            }), 400

        # Clean repository URL
        clean_url = repo_url.rstrip("/")
        if clean_url.endswith(".git"):
            clean_url = clean_url[:-4]

        repo_name = extract_repo_name(clean_url)

        # Set initial progress state
        ingest_state["is_ingesting"] = True
        ingest_state["stage"] = "starting"
        ingest_state["percent"] = 5
        ingest_state["message"] = f"Starting ingestion for {repo_name}..."
        ingest_state["repo_name"] = repo_name
        ingest_state["repo_url"] = clean_url
        ingest_state["error"] = None
        ingest_state["stats"] = None

        # Launch background worker thread
        import threading
        thread = threading.Thread(target=async_ingest_worker, args=(clean_url,), daemon=True)
        thread.start()

        return jsonify({
            "status": "started",
            "message": f"Ingestion started for {repo_name}",
            "repo_name": repo_name,
            "repo_url": clean_url
        }), 202

    except Exception as e:
        ingest_state["is_ingesting"] = False
        return jsonify({
            "status": "error",
            "error": f"Failed to start ingestion: {str(e)}"
        }), 500


@app.route("/query", methods=["POST"])
def query():
    """
    POST /query
    Request Body:
      {
        "question": "How does Flask handle routing?"
      }
    Returns:
      {
        "question": "...",
        "answer": "...",
        "sources": ["src/flask/app.py", ...],
        "chunks": [...]
      }
    """
    try:
        load_dotenv(override=True)
        data = request.get_json(silent=True) or {}
        question = data.get("question", "").strip()

        if not question:
            return jsonify({
                "error": "Missing or empty 'question' parameter in request body."
            }), 400

        # Step 1: Retrieve top-5 most similar chunks from pgvector
        chunks, sources = retrieve_chunks(question, top_k=5)

        # Basic error handling: empty retrieval results
        if not chunks:
            return jsonify({
                "question": question,
                "answer": "No relevant code snippets found in the codebase matching your question.",
                "sources": [],
                "chunks": []
            })

        # Step 2: Check for GROQ_API_KEY
        api_key = os.getenv("GROQ_API_KEY", "").strip() or GROQ_API_KEY
        if not api_key or api_key == "your_groq_api_key_here":
            formatted_chunks_preview = "\n\n".join(
                f"- **{c['file_path']}** (Similarity: {c['similarity']}):\n```\n{c['content'][:300]}...\n```"
                for c in chunks
            )
            return jsonify({
                "question": question,
                "answer": (
                    "**GROQ_API_KEY is not configured.**\n\n"
                    "Vector retrieval succeeded! Top-5 matching chunks from the codebase were retrieved below. "
                    "To enable LLM generation, set `GROQ_API_KEY` in your `.env` file.\n\n"
                    f"{formatted_chunks_preview}"
                ),
                "sources": sources,
                "chunks": chunks
            })

        # Step 3: Call Groq API
        context_text = format_context_for_prompt(chunks)
        repo_meta = get_repo_metadata()
        active_repo_name = repo_meta.get("repo_name", "the repository")
        
        system_prompt = (
            f"You are an expert codebase assistant analyzing the open-source {active_repo_name} repository.\n"
            "Your task is to answer the user's question accurately and thoroughly based ON THE PROVIDED CODE SNIPPETS.\n"
            "Guidelines:\n"
            "1. Ground your answer in the provided snippets. Cite the source file paths whenever referring to functions, classes, or patterns.\n"
            "2. If the snippets do not contain enough information to fully answer, state what is known from the snippets and what is missing.\n"
            "3. Format your response cleanly using Markdown, including code blocks with syntax highlighting where helpful."
        )

        user_prompt = (
            f"Codebase Context Snippets:\n"
            f"{context_text}\n\n"
            f"Question:\n{question}"
        )

        try:
            client = Groq(api_key=api_key)
            model_to_use = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b").strip()
            max_tokens_val = int(os.getenv("MAX_TOKENS", "1500"))
            
            # Prevent 429 OTPM limit on Qwen models (OTPM cap is 1000)
            if "qwen" in model_to_use.lower():
                max_tokens_val = min(max_tokens_val, 750)

            completion = client.chat.completions.create(
                model=model_to_use,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.2,
                max_tokens=max_tokens_val,
            )
            answer = completion.choices[0].message.content
        except Exception as groq_err:
            formatted_chunks_preview = "\n\n".join(
                f"- **{c['file_path']}** (Similarity: {c['similarity']}):\n```\n{c['content'][:300]}...\n```"
                for c in chunks
            )
            return jsonify({
                "question": question,
                "error": f"Groq API error: {str(groq_err)}",
                "answer": (
                    f"**Groq Generation Notice**: {str(groq_err)}\n\n"
                    "Vector retrieval was successful. Below are the top matching code snippets from the repository:\n\n"
                    f"{formatted_chunks_preview}"
                ),
                "sources": sources,
                "chunks": chunks
            }), 200

        return jsonify({
            "question": question,
            "answer": answer,
            "sources": sources,
            "chunks": chunks
        })

    except Exception as e:
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    print(f"--> Starting Flask RAG API on http://0.0.0.0:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
