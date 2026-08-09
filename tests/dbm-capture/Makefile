# DBM capture rig.
#   make up                          — start postgres + redis (DBS overridable)
#   make up DBS="postgres mysql redis mongo"
#   make capture CELL=python-pg-legacy|python-pg-dup|python-pg-new
#   make scrub                       — Task 4 (not yet implemented)
#   make down
#
# CELL grammar: <app-service>-<mode>, mode ∈ {legacy,dup,new}:
#   legacy → OTEL_SEMCONV_STABILITY_OPT_IN unset/empty
#   dup    → OTEL_SEMCONV_STABILITY_OPT_IN=database/dup
#   new    → OTEL_SEMCONV_STABILITY_OPT_IN=database
# (Cells whose mechanism is a package pin, e.g. dotnet-pg, use distinct app
# services instead of modes — see the plan.)

COMPOSE ?= docker compose
DBS ?= postgres redis

.PHONY: up down capture scrub verify

up:
	$(COMPOSE) up -d --wait $(DBS)

down:
	CELL=scratch $(COMPOSE) down -v --remove-orphans

capture:
ifndef CELL
	$(error CELL is required, e.g. make capture CELL=python-pg-legacy)
endif
	@mkdir -p out
	@rm -f out/$(CELL).jsonl
	@cell="$(CELL)"; mode="$${cell##*-}"; app="$${cell%-*}"; \
	case "$$mode" in \
	  legacy) optin="" ;; \
	  dup)    optin="database/dup" ;; \
	  new)    optin="database" ;; \
	  *) echo "unknown mode '$$mode' in CELL=$(CELL)"; exit 1 ;; \
	esac; \
	echo ">> cell=$(CELL) app=$$app OTEL_SEMCONV_STABILITY_OPT_IN='$$optin'"; \
	CELL=$(CELL) $(COMPOSE) up -d --force-recreate collector || exit 1; \
	ok=0; for i in $$(seq 1 30); do \
	  curl -sf localhost:13133 >/dev/null 2>&1 && { ok=1; break; }; sleep 1; \
	done; \
	[ "$$ok" = 1 ] || { echo "collector health check (13133) never came up"; exit 1; }; \
	CELL=$(CELL) OTEL_SEMCONV_STABILITY_OPT_IN="$$optin" \
	  $(COMPOSE) run --rm --build "$$app" || exit 1; \
	sleep 3; \
	CELL=$(CELL) $(COMPOSE) stop collector; \
	test -s out/$(CELL).jsonl \
	  && echo "OK: out/$(CELL).jsonl ($$(wc -l < out/$(CELL).jsonl | tr -d ' ') batch lines)" \
	  || { echo "FAIL: out/$(CELL).jsonl empty or missing"; exit 1; }

scrub:
	@echo "scrub tool is Task 4 — not implemented yet" && exit 1
