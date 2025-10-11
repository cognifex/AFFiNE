# syntax=docker/dockerfile:1.6

# --- Builder stage ---------------------------------------------------------
# Use the full Node.js 20 image so we have system headers for native deps.
FROM node:20-bookworm AS builder

WORKDIR /app

# Install build tooling required by the monorepo (Rust toolchain, libvips for sharp, etc.).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    git \
    libssl-dev \
    libvips-dev \
    pkg-config \
    python3 \
  && rm -rf /var/lib/apt/lists/*

# Enable Corepack-managed package managers so we can use the repo-defined versions.
RUN corepack enable \
  && corepack prepare yarn@4.9.1 --activate

# Install the Rust toolchain that powers @affine/server-native.
COPY rust-toolchain.toml ./
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
    sh -s -- -y --profile minimal --default-toolchain none \
  && . "$HOME/.cargo/env" \
  && rustup toolchain install "$(sed -n 's/^channel = \"\(.*\)\"/\1/p' rust-toolchain.toml)" --profile minimal \
  && rustup default "$(sed -n 's/^channel = \"\(.*\)\"/\1/p' rust-toolchain.toml)"
ENV PATH="/root/.cargo/bin:${PATH}"

# Copy the repository and install dependencies from the lockfile for reproducibility.
COPY . .
RUN yarn install --immutable

# Build both the frontend and backend so static assets end up in the server package.
RUN yarn build

# Strip dev dependencies while keeping everything the server runtime needs.
RUN yarn workspaces focus --all --production

# --- Runtime stage ---------------------------------------------------------
# Slim Node.js 20 image keeps the final image small.
FROM node:20-slim AS runner

WORKDIR /app

# Only install runtime libraries required by the server.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libvips42 \
    openssl \
  && rm -rf /var/lib/apt/lists/*

# Copy the built application and its production dependencies.
COPY --from=builder /app/package.json ./
COPY --from=builder /app/.yarnrc.yml ./
COPY --from=builder /app/.yarn ./ ./.yarn
COPY --from=builder /app/yarn.lock ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/backend/server ./packages/backend/server
COPY --from=builder /app/packages/backend/native ./packages/backend/native
COPY --from=builder /app/packages/common/reader ./packages/common/reader

# Provide a project-local yarn shim so runtime scripts and migrations can invoke it.
RUN printf '#!/bin/sh\nexec node /app/.yarn/releases/yarn-4.9.1.cjs "$@"\n' > /usr/local/bin/yarn \
  && chmod +x /usr/local/bin/yarn \
  && ln -sf /usr/local/bin/yarn /usr/local/bin/yarnpkg

ENV NODE_ENV=production
ENV AFFINE_SERVER_HOST=0.0.0.0
ENV AFFINE_SERVER_PORT=3010

EXPOSE 3010

# Start the NestJS server via the Yarn script so Prisma/env hooks run consistently.
CMD ["yarn", "start:server"]
