## Pyroscope for profiling

Pyroscope can be used for basic profiling of `OpenObserve`.
The following steps can be followed:
- Setup a local `pyroscope` server from `benchmarks/pyroscope` directory:
  - `docker-compose up docker-compose.yml`
- In another terminal, compile and run the `openobserve` code with the debug profile.
- Note that we are setting `RUST_LOG=warn` to restrict logging only to `warn`.
- `cargo build --profile release-profiling && RUST_LOG=warn ZO_ROOT_USER_EMAIL=root@example.com ZO_ROOT_USER_PASSWORD=Complexpass#123 ./target/release-profiling/openobserve`

- Launch http://localhost:4040
