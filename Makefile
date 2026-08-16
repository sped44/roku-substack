# Roku Substack — common tasks from repo root
#
#   make test            Run backend unit tests with coverage (fails below 80% lines)
#   make test-coverage   Run tests with coverage report
#   make deploy          Build/push image and apply Cloud Run via Terraform
#   make release         test + deploy
#   make package         Zip the Roku channel
#   make sideload        Zip + install to Roku (ROKU_* from backend/.env)

ENV_FILE ?= backend/.env

# Load KEY=VALUE from .env (GCP_PROJECT_ID, ROKU_*, etc.)
ifneq (,$(wildcard $(ENV_FILE)))
  include $(ENV_FILE)
  export
endif

PROJECT         ?= $(or $(GCP_PROJECT_ID),roku-502821)
REGION          ?= $(or $(GCP_REGION),us-west1)
APP             ?= $(or $(APP_NAME),roku-substack)
PUBLIC_BASE_URL ?= https://roku-substack-REPLACE_ME-uw.a.run.app

IMAGE_REPO := $(REGION)-docker.pkg.dev/$(PROJECT)/$(APP)/api
ifeq ($(origin IMAGE),undefined)
  IMAGE := $(IMAGE_REPO):$(shell date +%Y%m%d-%H%M%S)
endif

TF_DIR  := infra
TF_VARS := -var="project_id=$(PROJECT)" \
	-var="region=$(REGION)" \
	-var="app_name=$(APP)" \
	-var="container_image=$(IMAGE)" \
	-var="public_base_url=$(PUBLIC_BASE_URL)" \
	-var="session_signing_key=$(SESSION_SIGNING_KEY)" \
	-var="cookie_encryption_key=$(COOKIE_ENCRYPTION_KEY)"

.PHONY: help test test-coverage deploy release package sideload

help:
	@echo "Targets:"
	@echo "  make test            Run backend unit tests with coverage (fails below 80% lines)"
	@echo "  make test-coverage   Run tests with coverage"
	@echo "  make deploy          Build, push, and deploy backend to Cloud Run"
	@echo "  make release         Run tests, then deploy"
	@echo "  make package         Build channel/roku-substack.zip"
	@echo "  make sideload        Package and install on Roku"
	@echo ""
	@echo "From $(ENV_FILE):"
	@echo "  GCP_PROJECT_ID / PROJECT, GCP_REGION / REGION, APP_NAME / APP,"
	@echo "  PUBLIC_BASE_URL, ROKU_IP, ROKU_PASS, ROKU_USER"
	@echo "CLI still wins, e.g. make deploy REGION=us-central1"
	@echo "Current PROJECT=$(PROJECT) REGION=$(REGION) APP=$(APP)"

test:
	cd backend && npm test

test-coverage:
	cd backend && npm run test:coverage

deploy:
	@echo "Deploying $(IMAGE)"
	@test -n "$(SESSION_SIGNING_KEY)" || { echo "Missing SESSION_SIGNING_KEY in $(ENV_FILE)"; exit 1; }
	@test -n "$(COOKIE_ENCRYPTION_KEY)" || { echo "Missing COOKIE_ENCRYPTION_KEY in $(ENV_FILE)"; exit 1; }
	@test -f $(TF_DIR)/terraform.tfvars || cp $(TF_DIR)/terraform.tfvars.example $(TF_DIR)/terraform.tfvars
	gcloud auth configure-docker $(REGION)-docker.pkg.dev --quiet
	cd $(TF_DIR) && terraform init -input=false
	cd $(TF_DIR) && terraform apply -auto-approve -target=google_artifact_registry_repository.app $(TF_VARS)
	docker build --platform=linux/amd64 -t "$(IMAGE)" backend
	docker push "$(IMAGE)"
	cd $(TF_DIR) && terraform apply -auto-approve $(TF_VARS)
	@echo "Deployed: $(PUBLIC_BASE_URL)"

release: test deploy

package:
	cd channel && ./sideload.sh

sideload:
	@test -f "$(ENV_FILE)" || { echo "Missing $(ENV_FILE) — copy backend/.env.example and set ROKU_IP / ROKU_PASS"; exit 1; }
	cd channel && ./sideload.sh install
