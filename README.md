# Codebase RAG Q&A Tool (Flask & pgvector)

An end-to-end Retrieval-Augmented Generation (RAG) assistant that allows asking questions about any GitHub codebase (default target: [`pallets/flask`](https://github.com/pallets/flask)).

---

## Architecture Overview

1. **Ingestion (`ingest.py`)**:
   - Shallow clones target repo (`--depth 1`).
   - Recursively walks files, whitelisting `.py`, `.js`, `.ts`, `.jsx`, `.tsx`, `.java`, `.go`, `.md`, `.sql`, `.yaml`, `.yml`, `.json` while excluding `.git`, `venv`, `node_modules`, etc.
   - Fixed-size chunking (~1200 chars, 200 char sliding overlap).
   - Generates 384-dimensional dense embeddings locally via `sentence-transformers` (`all-MiniLM-L6-v2`) without external embedding API costs.
   - Stores chunks into PostgreSQL 16 `pgvector` table `code_chunks` with HNSW cosine indexing.

2. **Backend API (`app.py`)**:
   - Flask server exposing `POST /query`.
   - Embeds query and retrieves top-5 matching chunks using pgvector cosine distance (`<=>`).
   - Calls Groq's `llama-3.3-70b-versatile` API to generate answers grounded strictly in retrieved context.
   - Returns answer, unique source files cited, and raw chunk previews.

3. **Frontend UI (`frontend/`)**:
   - Clean, minimalist React chat interface built with Vite.
   - Grounded source file path badges for every answer to show provenance and eliminate hallucinations.
   - Expandable "Inspect Snippets" card displaying cosine similarity scores and code snippets.
   - Pre-loaded suggested questions.

---

## Quick Start (Local Run)

### Prerequisites
- Docker Desktop
- Python 3.10+
- Node.js 18+

### Step 1: Start Vector Database
```powershell
docker compose up -d db
```
*Postgres is mapped to port `5433` (to avoid conflicts with any local host Postgres instances).*

### Step 2: Ingest the Codebase
```powershell
cd backend
python ingest.py https://github.com/pallets/flask
```
*Output: Scans files, generates 650 chunks, computes embeddings, and stores in `code_chunks`.*

### Step 3: Configure Environment
Copy `.env.example` to `backend/.env`:
```env
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5433
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=rag_db
GROQ_API_KEY=gsk_your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```

### Step 4: Run Flask Backend
```powershell
cd backend
python app.py
```
*Server starts on `http://localhost:5000`.*

### Step 5: Run React Frontend
```powershell
cd frontend
npm install
npm run dev
```
*Open your browser at `http://localhost:5173`.*

---

## Verification & Sanity Checks

### 1. SQL Query to Confirm Chunks Exist
Run the built-in database verification script:
```powershell
python backend/verify_db.py
```
Or execute SQL directly via Docker:
```powershell
docker exec -it codebase_rag_db psql -U postgres -d rag_db -c "SELECT count(*) AS total_chunks, count(DISTINCT file_path) AS total_files FROM code_chunks;"
```
**Expected Result**:
```text
 total_chunks | total_files 
--------------+-------------
          650 |          98
```

### 2. Standalone Vector Retrieval Test
Sanity-check cosine similarity retrieval without needing Groq:
```powershell
python backend/test_retrieval.py "How does Flask handle routing and URL rules?"
```

### 3. API Query via cURL
Test the live Flask endpoint:
```bash
curl -X POST http://localhost:5000/query \
  -H "Content-Type: application/json" \
  -d "{\"question\": \"How does Flask handle routing?\"}"
```
**Sample JSON Response**:
```json
{
  "question": "How does Flask handle routing?",
  "answer": "In Flask, routing is configured through the URL map and the `@app.route` decorator...",
  "sources": [
    "tests/test_apps/helloworld/hello.py",
    "src/flask/app.py",
    "tests/test_reqctx.py",
    "src/flask/helpers.py"
  ],
  "chunks": [
    {
      "id": 643,
      "file_path": "tests/test_apps/helloworld/hello.py",
      "chunk_index": 0,
      "similarity": 0.6941,
      "content": "@app.route(\"/\")\ndef hello():\n    return \"Hello World!\""
    }
  ]
}
```

### 4. Interactive Web UI
1. Navigate to `http://localhost:5173`.
2. Click any of the pre-loaded questions or type your own question about the repository.
3. Observe the generated answer and verify the **"Grounded in Source Files"** chips below the message.
4. Click **"Inspect Snippets"** to review the exact cosine similarity scores and code chunk content used by the model.

---

## Full Docker Stack (Production)

You can run the entire stack (Database, Backend, and Frontend) via Docker Compose:
```powershell
# Set your Groq API key in the environment or .env
$env:GROQ_API_KEY="gsk_..."

# Build and start all services
docker compose up --build -d
```
- **React Frontend**: `http://localhost:3000` (reverse-proxies API requests to backend automatically)
- **Flask Backend API**: `http://localhost:5000` (served with production Gunicorn WSGI)
- **PostgreSQL Vector DB**: `localhost:5433`

---

## Production Deployment Guide

### Option 1: Cloud VPS (DigitalOcean / Hetzner / AWS / Lightsail) — *Recommended*
1. **Launch an Ubuntu VPS** with at least 1–2 GB RAM.
2. **Install Docker**:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. **Clone and run**:
   ```bash
   git clone <YOUR_REPOSITORY_URL>
   cd codebase-rag
   cp .env.example .env
   # Add your GROQ_API_KEY inside .env
   docker compose up --build -d
   ```
4. **Set up HTTPS Domain with Caddy (2 minutes)**:
   ```bash
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update && sudo apt install caddy
   ```
   Edit `/etc/caddy/Caddyfile`:
   ```caddyfile
   yourdomain.com {
       reverse_proxy localhost:3000
   }
   ```
   Reload Caddy: `sudo systemctl reload caddy`. Free SSL certificates are issued automatically!

---

### Option 2: Managed Cloud (Vercel + Render + Supabase) — *Zero Server Maintenance*
1. **Database (Supabase / Neon)**:
   - Create a free project on [Supabase](https://supabase.com).
   - In SQL Editor, run: `CREATE EXTENSION IF NOT EXISTS vector;`
   - Copy your `DATABASE_URL` (Connection String with pooler or direct).
2. **Backend (Render / Railway)**:
   - Create a **Web Service** on [Render](https://render.com) connected to your GitHub repo.
   - Root Directory: `backend` (or build with `backend/Dockerfile`).
   - Add Environment Variables:
     - `DATABASE_URL`: *(Your Supabase connection string)*
     - `GROQ_API_KEY`: *(Your Groq API key)*
     - `GROQ_MODEL`: `openai/gpt-oss-120b`
   - Copy your Render backend URL (e.g. `https://my-rag-backend.onrender.com`).
3. **Frontend (Vercel / Cloudflare Pages)**:
   - Import your repo on [Vercel](https://vercel.com).
   - Set **Root Directory** to `frontend`.
   - Add Environment Variable:
     - `VITE_API_BASE_URL`: `https://my-rag-backend.onrender.com`
   - Deploy!

---

### Option 3: Instant 2-Minute Public Demo (Cloudflare Tunnel)
Expose your local running instance to anyone in the world without deploying to the cloud:
```bash
npx untun tunnel --port 3000
# Or using official cloudflared:
cloudflared tunnel --url http://localhost:3000
```
This prints an instant, secure public HTTPS URL (e.g. `https://random-words.trycloudflare.com`).
