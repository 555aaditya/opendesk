# Remote state in S3 with native lock files (no DynamoDB table). The bucket is
# created once by hand (deploy/terraform/README.md) and passed at init:
#
#   terraform init \
#     -backend-config="bucket=opendesk-terraform-state-<account_id>" \
#     -backend-config="region=us-east-1"
terraform {
  backend "s3" {
    key          = "opendesk/production.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
