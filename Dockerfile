FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Local, bounded program-source extraction; uploads remain disabled unless explicitly configured.
RUN apt-get update && apt-get install -y --no-install-recommends python3 poppler-utils util-linux && rm -rf /var/lib/apt/lists/*

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
