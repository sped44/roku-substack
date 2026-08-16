variable "project_id" {
  description = "Existing GCP project ID (billing already linked)."
  type        = string
}

variable "region" {
  description = "Primary region for Cloud Run, Artifact Registry, and Firestore."
  type        = string
  default     = "us-west1"
}

variable "app_name" {
  description = "Short name used for resource naming."
  type        = string
  default     = "roku-substack"
}

variable "container_image" {
  description = "Container image for Cloud Run. Use a real image once the companion API is built."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "public_base_url" {
  description = "Public HTTPS origin for companion URLs (Cloud Run URL)."
  type        = string
  default     = ""
}

variable "session_signing_key" {
  description = "Session cookie signing key (from backend/.env SESSION_SIGNING_KEY)."
  type        = string
  sensitive   = true
}

variable "cookie_encryption_key" {
  description = "Substack cookie encryption key (from backend/.env COOKIE_ENCRYPTION_KEY)."
  type        = string
  sensitive   = true
}
