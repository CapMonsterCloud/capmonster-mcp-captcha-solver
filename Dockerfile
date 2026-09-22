FROM node:20-slim

WORKDIR /app

COPY ts/package.json ts/package-lock.json ./
RUN npm ci

COPY ts/ ./
RUN npm run build

CMD ["node", "dist/server.js"]
