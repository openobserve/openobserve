# zinc-observe

|          |                                      |
-----------|---------------------------------------
| User ID  | admin                                |
| Password | Complexpass#123                      |

## Quick Start

```
ZIOX_USER_NAME = "admin" ZIOX_USER_PASSWORD = "Complexpass#123" cargo run
```

## Etcd client

etcd-client which is used by zinc-observe needs protocol buffer compiler, please refer https://grpc.io/docs/protoc-installation/

For MacOS,using Homebrew

brew install protobuf

protoc --version

## Application structure

User -> API Interface -> Protocol{http|grpc|job} -> Services{logs|metrics|traces|users} -> Infra{db|storage|config} -> meta | common{thirdparty|function utils} 

## init

1. register cluster
2. load cache
3. start move job
4. start file list
5. start grpc
6. start http
7. change node status to online

## Mimalloc

We use [Mimalloc](https://github.com/microsoft/mimalloc) replaced jemalloc.

But default we didn't enable it, if you want enable should add cargo flags like this:

```
RUSTFLAGS='-C target-cpu=native' cargo build --release --features "mimalloc"
```

if you want better control to release memory quickly, you can set some evironments

```
export MIMALLOC_VERBOSE=1
export MIMALLOC_PAGE_RESET=1
export MIMALLOC_DECOMMIT_DELAY=25
```

More options refer to: https://github.com/microsoft/mimalloc#environment-options

## Format code

```
cargo clippy -- -A clippy::uninlined_format_args
```

## check cargo build feature

```
diff -u <(rustc --print cfg) <(rustc -C target-cpu=native --print cfg)
```
