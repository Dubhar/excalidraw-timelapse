# One-shot packer:  docker run --rm -v "/path/to/snapshots:/data" excalidraw-timelapse
# Reads /data/manifest.json, writes /data/diagram.html, exits.
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pack.py ./
COPY vendor ./vendor

# Extra options can be appended to `docker run`, e.g.  --title "Sprint 12" --transition-ms 1500
ENTRYPOINT ["python", "/app/pack.py", "/data/manifest.json", "-o", "/data/diagram.html"]
