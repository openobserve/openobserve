# pytest-openobserve

This is a repo to test openobserve API endpoints.

## Introduction:
The tests are running using `pytest` against alpha1 for now. 
Idea is to parametrize it for the other endpoints like `production` as well.

## Getting Started
- We use `rye` to manage the python version and environment - https://github.com/mitsuhiko/rye
- Once installed, simply run the following steps:
  - `rye sync`
  - `rye run pytest`


## TODOS:
- [ ] Parametrize tests to run against different environments
- [ ] Run the tests as cron-job every few hours or daily etc. for different environments
- [ ] Send slack-notification ( use github-actions ) in case something fails on `alpha1` or `production` endpoints.
