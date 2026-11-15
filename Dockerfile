# World Ascendant game server + web client, ready for any host that runs containers
# (Railway, Fly.io, Render, a VPS with Docker). See docs/HOSTING.md.
#
#   docker build -t world-ascendant .
#   docker run -p 8787:8787 -v wa-data:/data world-ascendant
#
# Node 22.5+ is required for the built-in SQLite database (node:sqlite).
FROM node:26-slim

WORKDIR /app

# Install dependencies first, so code changes don't reinstall everything.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/sim/package.json packages/sim/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund

# Build the web client (apps/web/dist), which the game server serves.
COPY . .
RUN npm run build

# The database lives in /data: mount a persistent volume there, or games and
# accounts are lost on every deploy.
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data
RUN mkdir -p /data
EXPOSE 8787

# Run node directly (not through npm) so it receives the host's stop signal and
# saves every game before shutting down.
CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]
