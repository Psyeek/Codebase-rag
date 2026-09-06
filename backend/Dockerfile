FROM python:3.10-slim

WORKDIR /app

# Install git for shallow cloning
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir "numpy<2" && \
    pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Run production WSGI server: 1 worker + 4 threads preserves RAM while handling concurrent queries.
# Timeout of 180s supports repo cloning & batch embedding operations.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "4", "--timeout", "180", "app:app"]
