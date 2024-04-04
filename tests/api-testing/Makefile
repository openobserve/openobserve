.DEFAULT_GOAL := help

.PHONY: format

help:          ## Show available options with this Makefile
	@grep -F -h "##" $(MAKEFILE_LIST) | grep -v grep | awk 'BEGIN { FS = ":.*?##" }; { printf "%-18s  %s\n", $$1,$$2 }'

format: ## Run ruff formatter on the tests folder
	ruff tests/

test: ## Run pytest
	pytest tests/
