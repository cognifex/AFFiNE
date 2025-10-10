# syntax=docker/dockerfile:1.6

# --- Builder stage ---------------------------------------------------------
# Use the full Node.js 20 image so we have system headers for native deps.
FROM node:20-bookworm AS builder

# pnpm stores its binaries in PNPM_HOME; expose it early so later layers see pnpm.
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

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
  && corepack prepare pnpm@9.12.2 --activate \
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
RUN pnpm install --frozen-lockfile

# Build both the frontend and backend so static assets end up in the server package.
RUN pnpm build

# Strip dev dependencies while keeping everything the server runtime needs.
RUN pnpm prune --prod

# --- Runtime stage ---------------------------------------------------------
# Slim Node.js 20 image keeps the final image small.
FROM node:20-slim AS runner

ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

WORKDIR /app

# Only install runtime libraries required by the server.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libvips42 \
    openssl \
  && rm -rf /var/lib/apt/lists/*

# Reuse the same pnpm version without hitting the network at runtime.
RUN corepack enable \
  && corepack prepare pnpm@9.12.2 --activate
COPY --from=builder ${PNPM_HOME} ${PNPM_HOME}

# Copy the built application and its production dependencies.
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/backend/server ./packages/backend/server
COPY --from=builder /app/packages/backend/native ./packages/backend/native
COPY --from=builder /app/packages/common/reader ./packages/common/reader

ENV NODE_ENV=production
ENV AFFINE_SERVER_HOST=0.0.0.0
ENV AFFINE_SERVER_PORT=3010

EXPOSE 3010

# Start the NestJS server via the pnpm script so Prisma/env hooks run consistently.
CMD ["pnpm", "start:server"]
