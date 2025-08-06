# FROM mcr.microsoft.com/devcontainers/base:bookworm
FROM public.ecr.aws/docker/library/rust:buster

# Install all dependencies and setup rust in one layer
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    protobuf-compiler \
    cmake curl && \
    rustup toolchain install nightly-2025-05-20 && \
    rustup default nightly-2025-05-20 && \
    rustup target add x86_64-unknown-linux-gnu && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
