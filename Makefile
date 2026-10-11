SCRATCH ?= ./data
export DATABASE_URL ?= postgres://opendesk:opendesk@localhost:55432/opendesk?sslmode=disable

.PHONY: dev-db dev api realtime web site docs build test lint web-embed

dev-db: ## start local Postgres
	docker compose -f docker-compose.dev.yml -p opendesk-dev up -d --wait

api: ## run the Go API + workers with embedded NATS (listens for the gateway on :4222)
	NATS_LISTEN=0.0.0.0:4222 go run ./cmd/opendesk serve

realtime: ## run the Elixir gateway
	cd realtime && mix phx.server

web: ## run the web app
	cd web && pnpm dev

site:
	cd site && pnpm dev

docs:
	cd docs && pnpm dev

build:
	go build -o bin/opendesk ./cmd/opendesk

web-embed: ## build the web app into the Go binary's embed dir
	cd web && pnpm build
	rm -rf internal/webui/dist/assets && cp -R web/dist/. internal/webui/dist/

test:
	go test ./...

lint:
	test -z "$$(gofmt -l .)"
	go vet ./...
