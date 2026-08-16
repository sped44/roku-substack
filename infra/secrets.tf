resource "google_secret_manager_secret" "session_signing_key" {
  project   = var.project_id
  secret_id = "${var.app_name}-session-signing-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret" "cookie_encryption_key" {
  project   = var.project_id
  secret_id = "${var.app_name}-cookie-encryption-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "session_signing_key" {
  secret      = google_secret_manager_secret.session_signing_key.id
  secret_data = var.session_signing_key
}

resource "google_secret_manager_secret_version" "cookie_encryption_key" {
  secret      = google_secret_manager_secret.cookie_encryption_key.id
  secret_data = var.cookie_encryption_key
}
