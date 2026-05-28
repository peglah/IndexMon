FROM node:22-alpine

WORKDIR /app

# Create user and group
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Install dependencies
COPY package.json .
RUN npm install --production

# Copy scripts and source files
COPY scripts ./scripts
COPY dist ./dist

# Initialize and copy database
RUN mkdir -p /app/data && \
    chown -R appuser:appgroup /app/data && \
    chmod -R 775 /app/data && \
    apk add --no-cache sqlite && \
    node ./scripts/init-db.cjs && \
    chown appuser:appgroup /app/data/indexmon.db && \
    chmod 664 /app/data/indexmon.db

USER appuser

EXPOSE 3000
CMD ["npm", "start"]