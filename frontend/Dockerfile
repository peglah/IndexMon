FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json tsconfig.node.json tailwind.config.js postcss.config.js vite.config.ts index.html ./
COPY src ./src
RUN npm install --legacy-peer-deps
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80