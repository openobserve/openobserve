# ZincObserve

🚀 10x easier, 🚀 10x cheaper, 🚀 petabyte scale - Elasticsearch alternative for 🚀 (logs, metrics, traces).

ZincObserve is a cloud native observability platform built specifically for logs, metrics & traces search & analytics. One can use it to search & analyze terabytes of data.

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

## Installation

You would need ZO_ROOT_USER_EMAIL and ZO_ROOT_USER_PASSWORD environment variables when you start ZincObserve for the first time. You don't need them on subsequent runs of ZincObserve.

Binaries can be downloaded from [releases page](https://github.com/zinclabs/zincobserve/releases) for appropriate platform.

### For Windows use:

        set ZO_ROOT_USER_EMAIL=admin@zinc.dev
        set ZO_ROOT_USER_PASSWORD=Complexpass#123
        zincobserve.exe

### For MacOS/Linux use:
   
        ZO_ROOT_USER_EMAIL=admin@zinc.dev ZO_ROOT_USER_PASSWORD=Complexpass#123 ./zincobserve 

### For Docker:   

        mkdir data
        docker run -v /full/path/of/data:/data -e ZO_DATA_DIR="/data" -p 5080:5080 \
                -e ZO_ROOT_USER_EMAIL=admin@zinc.dev -e ZO_ROOT_USER_PASSWORD=Complexpass#123 \
                --name zinc public.ecr.aws/zinclabs/zincobserve:latest


Now point your browser to [http://localhost:5080](http://localhost:5080) and login using user ZO_ROOT_USER_EMAIL & ZO_ROOT_USER_PASSWORD


## How to get support

Easiest way to get support is to join the [Slack channel](https://join.slack.com/t/zincsearch/shared_invite/zt-11r96hv2b-UwxUILuSJ1duzl_6mhJwVg).

# How to develop & contribute to Zinc

Check the [contributing guide](./CONTRIBUTING.md)
