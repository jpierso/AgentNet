FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# Build
FROM deps AS build
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm build

# Production
FROM base AS production
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY drizzle/ ./drizzle/

EXPOSE 3000
CMD ["node", "dist/index.js"]
