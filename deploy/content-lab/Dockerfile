# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Optional public CA for builds behind an enterprise/session HTTPS proxy.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then \
      NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --include=dev --no-audit --no-fund; \
    else npm ci --include=dev --no-audit --no-fund; fi
COPY . .
RUN npm run content-lab:build

FROM node:24-bookworm-slim
ENV NODE_ENV=production CONTENT_LAB_MODE=private CONTENT_LAB_HOST=0.0.0.0 CONTENT_LAB_PORT=3000
WORKDIR /app
# Pipeline commands execute TypeScript through tsx; devDependencies are needed at runtime.
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/tools ./tools
RUN mkdir -p /app/content && chown node:node /app/content
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const http=require('node:http');http.get({host:'127.0.0.1',port:3000,path:'/api/session',headers:{host:new URL(process.env.CONTENT_LAB_ORIGIN).host}},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["npm", "run", "content-lab:start"]
