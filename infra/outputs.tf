output "cloud_run_url" {
  description = "HTTPS URL for the companion API."
  value       = google_cloud_run_v2_service.api.uri
}

output "cloud_run_service_account_email" {
  description = "Runtime service account for Cloud Run."
  value       = google_service_account.cloud_run.email
}

output "artifact_registry_repository" {
  description = "Artifact Registry repository path for docker push."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
}

output "session_signing_key_secret" {
  description = "Secret Manager secret id for the session signing key."
  value       = google_secret_manager_secret.session_signing_key.secret_id
}

output "cookie_encryption_key_secret" {
  description = "Secret Manager secret id for Substack cookie encryption."
  value       = google_secret_manager_secret.cookie_encryption_key.secret_id
}

output "firestore_database" {
  description = "Named Firestore database id."
  value       = google_firestore_database.app.name
}

output "link_url" {
  description = "URL to claim a Roku pairing code after Substack login."
  value       = "${google_cloud_run_v2_service.api.uri}/link"
}
