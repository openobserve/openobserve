# FROM mcr.microsoft.com/devcontainers/base:bookworm
FROM public.ecr.aws/docker/library/rust:buster

RUN apt-get update
RUN apt-get install -y protobuf-compiler
RUN apt-get install -y cmake curl

# RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
RUN rustup toolchain install nightly-2025-05-20
RUN rustup default nightly-2025-05-20
RUN rustup target add x86_64-unknown-linux-gnu

