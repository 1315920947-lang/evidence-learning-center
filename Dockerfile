FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.lock.txt ./requirements.lock.txt
RUN pip install --no-cache-dir -r requirements.lock.txt \
    && useradd --create-home --uid 10001 evidence
COPY --chown=evidence:evidence app.py durable_sqlite.py ./
COPY --chown=evidence:evidence static ./static
RUN date -u +'%Y-%m-%dT%H:%M:%SZ' > /app/.site-build-time \
    && mkdir -p /app/data && chown evidence:evidence /app /app/data
USER evidence
EXPOSE 3000
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-3000}"]
