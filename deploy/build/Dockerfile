FROM public.ecr.aws/docker/library/node:18.12.1-bullseye as webBuilder
WORKDIR /web
COPY ./web /web/

RUN npm install
RUN NODE_OPTIONS="--max-old-space-size=8192" npm run build

# FROM public.ecr.aws/docker/library/rust:bullseye as builder
FROM public.ecr.aws/zinclabs/rust:bullseye-sccache as builder
ARG AWS_DEFAULT_REGION
ARG AWS_CONTAINER_CREDENTIALS_RELATIVE_URI

# RUN apt-get update
# RUN apt-get install -y protobuf-compiler
# RUN apt-get install -y cmake curl

# RUN rustup toolchain install nightly-2023-03-28
# RUN rustup default nightly-2023-03-28
# RUN rustup target add x86_64-unknown-linux-gnu
# RUN diff -u <(rustc --print cfg) <(rustc -C target-cpu=native --print cfg)
# RUN rustc --print cfg
# RUN rustc -C target-cpu=native --print cfg
# RUN cargo install sccache
# ENV SCCACHE_IDLE_TIMEOUT=1800
# ENV RUSTC_WRAPPER=/usr/local/cargo/bin/sccache
ENV SCCACHE_BUCKET=codepipeline-us-west-2-scccache
ENV SCCACHE_S3_KEY_PREFIX=zincobserve/dev/amd64/

# RUN wget https://github.com/protocolbuffers/protobuf/releases/download/v21.12/protoc-21.12-linux-x86_64.zip \
#     && unzip protoc-21.12-linux-x86_64.zip -d protoc \
#     && cp protoc/bin/protoc /usr/local/bin/ \
#     && cp -r protoc/include/google /usr/local/include/

WORKDIR /app
COPY . /app
COPY --from=webBuilder /web/dist web/dist

# RUN cargo build --release
RUN RUSTFLAGS='-C target-feature=+sse2,+sse3,+ssse3,+sse4.1,+sse4.2' cargo build --release --features tmpcache,zo_functions --target x86_64-unknown-linux-gnu
RUN sccache --show-stats
RUN mv /app/target/x86_64-unknown-linux-gnu/release/zincobserve /app/target/release/zincobserve

# FROM gcr.io/distroless/cc as runtime
FROM public.ecr.aws/debian/debian:bullseye-slim as runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates
RUN apt-get install -y curl htop iftop sysstat procps lsof net-tools
RUN update-ca-certificates
COPY --from=builder /app/target/release/zincobserve /
CMD ["/zincobserve"]
