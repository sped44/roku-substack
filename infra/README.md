# GCP infra (Terraform)

Provisions the companion backend footing for Roku Substack:

- API enablement (Cloud Run, Artifact Registry, Firestore, Secret Manager, IAM)
- Artifact Registry Docker repo
- Cloud Run service (placeholder image until the API is built)
- Named Firestore database `roku-substack` in `us-west1` (does not touch Photos’ `(default)` DB)
- Secret Manager secrets for session signing + cookie encryption
- Runtime service account with least-privilege IAM

## Prerequisites

- Existing GCP project with billing enabled (`roku-502821` by default)
- `gcloud` authenticated (`gcloud auth application-default login`)
- Terraform `>= 1.5`

## Apply

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
# edit project_id if needed

terraform init
terraform plan
terraform apply
```

Useful outputs after apply: `cloud_run_url`, `link_url`, secret ids, Artifact Registry path, `firestore_database`.

If Cloud Run fails with opaque `REVISION_FAILED` / "internal error", re-run `terraform apply` after the IAM wait (45s) lands — secret-accessor propagation is a common cause.

If apply fails with `cannot destroy service without setting deletion_protection=false`, the service is **tainted**. Fix with:

```bash
terraform untaint google_cloud_run_v2_service.api
terraform apply
```

## After apply (secrets)

Placeholder secret versions are `REPLACE_ME`. The companion will refuse to boot until you replace them:

```bash
openssl rand -base64 32 | tr -d '\n' | gcloud secrets versions add "$(terraform output -raw session_signing_key_secret)" --data-file=-
openssl rand -base64 32 | tr -d '\n' | gcloud secrets versions add "$(terraform output -raw cookie_encryption_key_secret)" --data-file=-
```

Redeploy/restart Cloud Run so new secret versions are picked up (new revision or traffic update).

## Deploy companion to Cloud Run

From repo root after `backend/.env` has `PUBLIC_BASE_URL` and `GCP_PROJECT_ID`:

```bash
make deploy
```

Or manually:

```bash
IMAGE=us-west1-docker.pkg.dev/roku-502821/roku-substack/api:$(date +%Y%m%d-%H%M%S)
gcloud auth configure-docker us-west1-docker.pkg.dev --quiet
docker build --platform=linux/amd64 -t "$IMAGE" backend
docker push "$IMAGE"

cd infra
terraform apply \
  -var="container_image=$IMAGE" \
  -var="public_base_url=https://YOUR-SERVICE-uw.a.run.app"
```

Then set the Roku channel `apiBaseUrl` to that HTTPS URL and re-sideload.
