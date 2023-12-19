.DEFAULT_GOAL := help

.PHONY: format

help:          ## Show available options with this Makefile
	@grep -F -h "##" $(MAKEFILE_LIST) | grep -v grep | awk 'BEGIN { FS = ":.*?##" }; { printf "%-18s  %s\n", $$1,$$2 }'

format: ## Run black formatter on the tests folder
	black tests/

test: ## Run pytest
	pytest tests/
