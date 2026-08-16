resource "google_cloud_run_v2_service" "api" {
  project             = var.project_id
  name                = var.app_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.cloud_run.email
    timeout         = "3600s"

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = var.container_image

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }

      env {
        name  = "APP_NAME"
        value = var.app_name
      }

      env {
        name  = "FIRESTORE_DATABASE_ID"
        value = google_firestore_database.app.name
      }

      env {
        name  = "BASE_URL"
        value = local.public_base_url
      }

      env {
        name  = "PUBLIC_BASE_URL"
        value = local.public_base_url
      }

      env {
        name = "SESSION_SIGNING_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.session_signing_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "COOKIE_ENCRYPTION_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.cookie_encryption_key.secret_id
            version = "latest"
          }
        }
      }

      resources {
        cpu_idle = true
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    time_sleep.wait_for_iam,
  ]
}

# Public invoker for Roku + phone clients; app-level pairing tokens provide auth.
# Org policy may block allUsers — remove this and use authenticated invokers if needed.
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = google_cloud_run_v2_service.api.project
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
