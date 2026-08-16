resource "google_artifact_registry_repository" "app" {
  project       = var.project_id
  location      = var.region
  repository_id = var.app_name
  description   = "Docker images for the ${var.app_name} companion API"
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}
