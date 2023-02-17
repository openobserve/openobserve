# zincobserve

🚀 10x easier, 🚀 10x cheaper, 🚀 petabyte scale - Elasticsearch alternative for 🚀 (logs, metrics, traces).

ZincObserve is a search engine built specifically for logs , metrics & traces search & analytics. One can use it to search & analyze terabytes of data.

## Features:
1. Best in class GUI.
1. Single binary for installation & running. Binaries available under [releases](https://github.com/zinclabs/zincobserve/releases) for multiple platforms.
1. SQL for sophisticated queries, no need to learn yet another query language.
1. Embedded scripting functions for ingestion & query to aid advanced capabilities like enrichment, redaction, log reduction, compliance, etc.
1. Dynamic Schema
1. Out of the box authentication
1. Storage in local Disk, s3, MinIO, GCP
1. Vastly easier to operate
1. Seamless upgrades

[zinc.dev](https://zinc.dev/)


## Installation
You would need ZO_ROOT_USER_EMAIL and ZO_ROOT_USER_PASSWORD environment variables when you start ZincObserve for the first time. You don't need them on subsequent runs of ZincObserve.

Binaries can be downloaded from [releases page](https://github.com/zinclabs/zincobserve/releases) for appropriate platform.

### For Windows use : 

        set ZO_ROOT_USER_EMAIL=admin@zinc.dev
        set ZO_ROOT_USER_PASSWORD=Complexpass#123
        zinc.exe

### For MacOS/Linux use :
   
        ZO_ROOT_USER_EMAIL=admin@zinc.dev ZO_ROOT_USER_PASSWORD=Complexpass#123 ./zincobserve 
   

Now point your browser to [http://localhost:5080](http://localhost:5080) and login using user ZO_ROOT_USER_EMAIL & ZO_ROOT_USER_PASSWORD


## How to get support
Easiest way to get support is to join the [Slack channel](https://join.slack.com/t/zincsearch/shared_invite/zt-11r96hv2b-UwxUILuSJ1duzl_6mhJwVg).

## Quick Start

```
ZO_ROOT_USER_EMAIL="admin@zinc.dev" ZO_ROOT_USER_PASSWORD="Complexpass#123" cargo run
```

## Etcd client

etcd-client which is used by zincobserve needs protocol buffer compiler, please refer https://grpc.io/docs/protoc-installation/

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

# How to develop & contribute to Zinc

Check the [contributing guide](./CONTRIBUTING.md)
