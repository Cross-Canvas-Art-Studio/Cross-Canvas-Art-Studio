# syntax=docker/dockerfile:1
ARG PYTHON_BASE=python:3.12-slim

# ---------- builder ----------
# Build into a self-contained virtualenv so every transitive dependency is
# captured (a plain --prefix install can skip deps already present in the base
# image's site-packages, e.g. `packaging`).
FROM ${PYTHON_BASE} AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /tmp/build
COPY App/requirements.txt App/requirements-auth.txt ./
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir -r requirements-auth.txt

# ---------- final ----------
FROM ${PYTHON_BASE}
WORKDIR /app

# Apply all published security updates for the base image's OS layer, then
# install libmagic1 (backs python-magic upload content sniffing).
# The floating python:3.12-slim tag can be days behind Debian-security, so a
# plain rebuild would still ship older packages (e.g. openssl) — apt-get upgrade
# pulls the current patched releases from the trixie repos on every build.
RUN apt-get update && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY App/ .

RUN groupadd --gid 1000 appuser \
    && useradd --uid 1000 --gid 1000 --create-home --home-dir /home/appuser appuser \
    && mkdir -p /data/logs /data/output /data/uploaded /data/projects \
    && sed -i 's/\r$//' /app/entrypoint.sh \
    && chmod +x /app/entrypoint.sh \
    && chown -R appuser:appuser /app /data /home/appuser

EXPOSE 5000

ENV PYTHONUNBUFFERED=1 \
    HOME=/data \
    LOG_DIR=/data/logs \
    PROJECTS_DIR=/data/projects \
    USERS_DB=/data/users.db \
    MAX_UPLOAD_MB=25 \
    ALLOW_AUTH=true \
    REQUIRE_AUTH=true \
    ALLOW_USER_REGISTRATION=true \
    ALLOW_GUEST_LOGIN=false \
    ALLOW_CLIENT_API_KEYS=false \
    REQUIRE_SECRETS=true \
    TRUST_PROXY=false \
    OLLAMA_HOST=http://host.docker.internal:11434 \
    LMSTUDIO_HOST=http://host.docker.internal:1234 \
    GUNICORN_WORKERS=3 \
    GUNICORN_THREADS=2

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5000/health', timeout=3).status==200 else 1)" || exit 1

CMD ["/app/entrypoint.sh"]
