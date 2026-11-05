FROM node:22-alpine AS camera
WORKDIR /sdk
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM python:3.13-slim
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/mcflykid/anycubic-cloud-page" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"
COPY app/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY app /app/app
COPY web /app/web
COPY scripts /app/scripts
COPY --from=camera /sdk/node_modules/agora-rtc-sdk-ng/AgoraRTC_N-production.js /app/web/js/agora-rtc.js
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8080
RUN command -v setpriv
ENTRYPOINT ["python", "/app/scripts/container_entrypoint.py"]
EXPOSE 8080
CMD ["python", "/app/app/server.py"]
