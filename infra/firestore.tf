resource "google_firestore_database" "app" {
  project     = var.project_id
  name        = var.app_name
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  # Avoid accidental deletes of app data.
  deletion_policy = "ABANDON"

  depends_on = [google_project_service.apis]
}
