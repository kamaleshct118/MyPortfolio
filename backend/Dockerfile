FROM python:3.11-slim

# Set working directory
WORKDIR /code

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Set up Hugging Face global cache directory inside the container
ENV HF_HOME=/code/hf_cache
RUN mkdir -p /code/hf_cache && chmod -R 777 /code/hf_cache

# Pre-download the embedding model during the build phase (baked into the Docker image)
RUN python -c "from langchain_huggingface import HuggingFaceEmbeddings; HuggingFaceEmbeddings(model_name='nomic-ai/nomic-embed-text-v1.5', model_kwargs={'trust_remote_code': True})"

# Copy app source code
COPY . .

# Create persistent data directories (fallback if /data is not mounted)
RUN mkdir -p /data/uploads /data/vectorstore /data/static/images

# Expose port 7860 (HF Spaces default)
EXPOSE 7860

# Start FastAPI
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
