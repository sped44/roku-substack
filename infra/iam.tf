data "google_project" "current" {
  project_id = var.project_id
}

resource "google_service_account" "cloud_run" {
  project      = var.project_id
  account_id   = "${var.app_name}-run"
  display_name = "${var.app_name} Cloud Run runtime"
}

# Cloud Run service agent must be allowed to act as the runtime SA.
resource "google_service_account_iam_member" "run_agent_sa_user" {
  service_account_id = google_service_account.cloud_run.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:service-${data.google_project.current.number}@serverless-robot-prod.iam.gserviceaccount.com"
}

resource "google_project_iam_member" "cloud_run_datastore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_session_signing_key" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.session_signing_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_cookie_encryption_key" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.cookie_encryption_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

# IAM bindings are eventually consistent; Cloud Run revisions fail with opaque
# "internal error" if secret access isn't visible yet.
resource "time_sleep" "wait_for_iam" {
  create_duration = "45s"

  depends_on = [
    google_service_account_iam_member.run_agent_sa_user,
    google_secret_manager_secret_iam_member.cloud_run_session_signing_key,
    google_secret_manager_secret_iam_member.cloud_run_cookie_encryption_key,
    google_secret_manager_secret_version.session_signing_key,
    google_secret_manager_secret_version.cookie_encryption_key,
  ]
}
