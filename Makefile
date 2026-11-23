# Run all targets from this directory:
#   cd marketplace-listing-assistant
# Or: make -C /path/to/marketplace-listing-assistant smoke

ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
MERMAID_CLI_VERSION := 11.10.1

export PATH := $(HOME)/.maestro/bin:$(PATH)

.PHONY: backend e2e-backend e2e-mobile e2e-seed-ios e2e-auth-onboarding e2e-create-listing e2e-configure-ai e2e-improve-listing e2e-manage-photos e2e-download-images mobile mobile-manual mobile-tunnel mobile-tunnel-clean mobile-tunnel-measure mobile-tunnel-benchmark docs-user-flow test smoke install-backend install-mobile build-preview build-prod help

help:
	@echo "Targets: backend, e2e-backend, e2e-mobile, e2e-seed-ios, e2e-auth-onboarding, e2e-create-listing, e2e-configure-ai, e2e-improve-listing, e2e-manage-photos, e2e-download-images, mobile, mobile-manual, mobile-tunnel, mobile-tunnel-clean, mobile-tunnel-measure, mobile-tunnel-benchmark, docs-user-flow, test, smoke, build-preview, build-prod"
	@echo "Run from: $(ROOT)"

install-backend:
	cd $(ROOT)backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

install-mobile:
	cd $(ROOT)mobile && npm install

backend:
	cd $(ROOT)backend && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

e2e-backend:
	bash $(ROOT)scripts/start-e2e-backend.sh

e2e-mobile:
	bash $(ROOT)scripts/start-e2e-mobile.sh

e2e-seed-ios:
	bash $(ROOT)scripts/seed-maestro-ios-photo.sh

e2e-auth-onboarding:
	@command -v maestro >/dev/null 2>&1 || { echo "Maestro CLI is required: https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli"; exit 1; }
	cd $(ROOT) && maestro test .maestro/auth-onboarding.yaml

e2e-create-listing:
	@command -v maestro >/dev/null 2>&1 || { echo "Maestro CLI is required: https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli"; exit 1; }
	cd $(ROOT) && maestro test .maestro/create-listing.yaml

e2e-configure-ai:
	@command -v maestro >/dev/null 2>&1 || { echo "Maestro CLI is required: https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli"; exit 1; }
	cd $(ROOT) && maestro test .maestro/configure-ai.yaml

e2e-improve-listing:
	@command -v maestro >/dev/null 2>&1 || { echo "Maestro CLI is required: https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli"; exit 1; }
	cd $(ROOT) && maestro test .maestro/improve-listing.yaml

e2e-manage-photos:
	@command -v maestro >/dev/null 2>&1 || { echo "Maestro CLI is required: https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli"; exit 1; }
	cd $(ROOT) && maestro test .maestro/manage-photos.yaml

e2e-download-images:
	@command -v maestro >/dev/null 2>&1 || { echo "Maestro CLI is required: https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli"; exit 1; }
	cd $(ROOT) && maestro test .maestro/download-images.yaml

mobile:
	chmod +x $(ROOT)scripts/start-mobile-auto-ip.sh
	$(ROOT)scripts/start-mobile-auto-ip.sh

mobile-manual:
	cd $(ROOT)mobile && npx expo run:ios --device

mobile-tunnel:
	node $(ROOT)scripts/start-mobile-tunnel.mjs

mobile-tunnel-clean:
	node $(ROOT)scripts/start-mobile-tunnel.mjs --clear

mobile-tunnel-measure:
	node $(ROOT)scripts/start-mobile-tunnel.mjs --measure

mobile-tunnel-benchmark:
	node $(ROOT)scripts/start-mobile-tunnel.mjs --benchmark 5

docs-user-flow:
	mkdir -p $(ROOT)docs/generated
	cd $(ROOT) && npx --yes --package=@mermaid-js/mermaid-cli@$(MERMAID_CLI_VERSION) mmdc --input docs/user-flow.mmd --output docs/generated/user-flow.svg --backgroundColor white

test:
	cd $(ROOT)backend && .venv/bin/pytest -q

smoke:
	chmod +x $(ROOT)scripts/smoke.sh
	$(ROOT)scripts/smoke.sh

build-preview:
	@echo "Starting EAS preview build..."
	cd $(ROOT)mobile && npx eas-cli build --profile preview

build-prod:
	@echo "Starting EAS production build..."
	cd $(ROOT)mobile && npx eas-cli build --profile production
