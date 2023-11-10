# syntax=docker/dockerfile:1
FROM public.ecr.aws/docker/library/node:18.12.1-bullseye as webBuilder
WORKDIR /web
COPY ./web /web/

RUN npm install
RUN NODE_OPTIONS="--max-old-space-size=8192" npm run build

# FROM public.ecr.aws/docker/library/rust:bullseye as builder
FROM public.ecr.aws/zinclabs/rust:bullseye-sccache as builder

# RUN rustup toolchain install nightly-2023-10-24
# RUN rustup default nightly-2023-10-24
# RUN rustup target add x86_64-unknown-linux-gnu
# RUN diff -u <(rustc --print cfg) <(rustc -C target-cpu=native --print cfg)
RUN rustc --version && sccache --version

WORKDIR /app
COPY . /app
COPY --from=webBuilder /web/dist web/dist

RUN cargo build --release

# FROM gcr.io/distroless/cc as runtime
FROM public.ecr.aws/debian/debian:bullseye-slim as runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates
RUN apt-get install -y curl htop iftop sysstat procps lsof net-tools tini
RUN update-ca-certificates
COPY --from=builder /app/target/release/openobserve /
RUN ["/openobserve", "init-dir", "-p", "/data/"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/openobserve"]
