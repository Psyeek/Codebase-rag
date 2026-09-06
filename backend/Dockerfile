FROM python:3.10-slim

WORKDIR /app

# Install git for shallow cloning
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install lightweight CPU-only PyTorch first (saves ~1GB download and cuts RAM usage)
RUN pip install --no-cache-dir "numpy<2" && \
    pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Install remaining python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download and cache embedding model inside Docker image during build
# This avoids runtime downloads, network timeouts, and HuggingFace rate limits
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# Copy source code
COPY . .

# Run production WSGI server: 1 worker + 2 threads fits within Render's 512MB RAM
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "2", "--timeout", "300", "app:app"]
