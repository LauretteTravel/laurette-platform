FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
