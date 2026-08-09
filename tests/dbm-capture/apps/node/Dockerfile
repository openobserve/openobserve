FROM node:22-slim
WORKDIR /app
# ERA selects the package pin set: cur (latest, hard-cutover new-only) or
# era (2026-06-11 wave, OTEL_SEMCONV_STABILITY_OPT_IN honored).
ARG ERA=cur
COPY package.${ERA}.json package.json
RUN npm install --omit=dev --no-audit --no-fund \
 && npm ls --omit=dev --depth=0 > /app/pins.txt
COPY app.js .
CMD ["node", "app.js"]
