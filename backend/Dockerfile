# Use Python 3.11 slim image
FROM python:3.11-slim-bookworm

# Set working directory
WORKDIR /app

# Install system dependencies including Playwright browser deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    ffmpeg \
    # Playwright Chromium dependencies
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY backend/requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright and Chromium browser (with-deps for container compatibility)
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN pip install playwright && playwright install --with-deps chromium

# Copy application code
COPY backend/ .

# Create uploads directory
RUN mkdir -p uploads

# Run as non-root user
RUN useradd -m -u 1000 appuser \
    && chown -R appuser:appuser /app /app/uploads \
    && chmod -R o+rx /opt/playwright-browsers
USER appuser

# Expose port (Railway uses dynamic $PORT)
EXPOSE 8000

# Start the application (migrations managed separately)
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 4"]
