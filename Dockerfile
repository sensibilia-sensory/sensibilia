# Release tooling supplies reviewed immutable base image references.
ARG NODE_IMAGE
ARG PYTHON_IMAGE
FROM ${NODE_IMAGE} AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
# The frontend imports published JSON contracts and method snapshots from outside frontend/.
COPY docs/contracts/ /build/docs/contracts/
COPY migrations/versions/*.json /build/migrations/versions/
COPY frontend/ ./
RUN npm run build

FROM ${PYTHON_IMAGE} AS wheels
WORKDIR /build
COPY requirements.lock pyproject.toml ./
COPY src/ src/
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /wheels -r requirements.lock \
    && pip wheel --no-cache-dir --no-deps --wheel-dir /wheels .

FROM ${PYTHON_IMAGE} AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 SENSIBILIA_ROOT=/app
WORKDIR /app
COPY --from=wheels /wheels /wheels
COPY requirements.lock ./
RUN pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.lock sensibilia \
    && rm -rf /wheels \
    && groupadd --gid 10001 sensibilia \
    && useradd --uid 10001 --gid 10001 --no-create-home sensibilia \
    && mkdir /data /assets && chown 10001:10001 /data /assets
COPY alembic.ini ./
COPY migrations/ migrations/
COPY --from=frontend /build/frontend/dist/ frontend/dist/
USER 10001:10001
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "sensibilia.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--no-access-log"]
