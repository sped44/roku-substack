locals {
  public_base_url = trimspace(trimsuffix(
    var.public_base_url != "" ? var.public_base_url : "https://roku-substack-REPLACE_ME-uw.a.run.app",
    "/",
  ))
}
