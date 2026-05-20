# Multi-stage build for IndexMon (Backend + Frontend + Nginx + SQLite)

# Stage 1: Build the frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package.json ./
COPY frontend/tsconfig.json ./
COPY frontend/tsconfig.node.json ./
COPY frontend/tailwind.config.js ./
COPY frontend/postcss.config.js ./
COPY frontend/vite.config.ts ./
COPY frontend/index.html ./
COPY frontend/src ./src
RUN npm install --legacy-peer-deps
RUN npm run build

# Stage 2: Build the backend
FROM node:20-alpine AS backend-builder
WORKDIR /app
COPY backend/package.json ./
RUN npm install
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY backend/tsconfig.json ./
RUN npx tsc -p tsconfig.json

# Stage 3: Combine everything into a single container
FROM node:20-alpine
WORKDIR /app

# Install dependencies
RUN apk add --no-cache nginx sqlite

# Copy frontend build from stage 1
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# Copy backend build from stage 2
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/package.json ./
COPY --from=backend-builder /app/scripts ./scripts

# Install backend dependencies
RUN npm install --production

# Ensure data directory exists with correct permissions
RUN mkdir -p /app/data && \
    chown -R node:node /app/data && \
    chmod -R 775 /app/data

# Copy Nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf
RUN chmod -R 755 /etc/nginx

# Expose ports
EXPOSE 80 3000

# Start both Nginx and the backend (initialize DB first)
CMD ["sh", "-c", "node ./scripts/init-db.cjs && nginx && node dist/server.js"]