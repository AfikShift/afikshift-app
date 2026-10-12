FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends gnupg curl openssl \
 && curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/mongodb.gpg] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" > /etc/apt/sources.list.d/mongodb.list \
 && apt-get update && apt-get install -y --no-install-recommends mongodb-database-tools && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/dutyconnect
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend backend
COPY ops ops
RUN useradd -r -u 10001 dutyconnect && chown -R dutyconnect /opt/dutyconnect
USER dutyconnect
WORKDIR /opt/dutyconnect/backend
EXPOSE 8001
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001", "--proxy-headers", "--forwarded-allow-ips", "*"]
