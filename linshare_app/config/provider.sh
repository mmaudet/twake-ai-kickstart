#!/bin/bash
set -euo pipefail

# Configuration
BASE_URL="https://admin-linshare.twake.local/linshare/webservice/rest/admin/v5"

# Create TOPDOMAIN
echo "Creating TOPDOMAIN..."
TOPDOMAIN_RESPONSE=$(curl -s -kv -u "root@localhost.localdomain:adminlinshare" "$BASE_URL/domains" \
  -H "accept: application/json, text/plain, */*" \
  -H "content-type: application/json" \
  --data-raw '{"name":"top1","parent":{"name":"LinShareRootDomain","uuid":"LinShareRootDomain"},"type":"TOPDOMAIN"}')

echo "TOPDOMAIN Response:"
echo "$TOPDOMAIN_RESPONSE"

# Extract the domain UUID from the response
DOMAIN_UUID=$(echo "$TOPDOMAIN_RESPONSE" | jq -r '.uuid')
echo "Created TOPDOMAIN with UUID: $DOMAIN_UUID"

#Create OIDC Provider for the domain
echo "Creating OIDC Provider..."
OIDC_RESPONSE=$(curl -s -kv -u "root@localhost.localdomain:adminlinshare" "$BASE_URL/domains/$DOMAIN_UUID/user_providers" \
  -H "accept: application/json, text/plain, */*" \
  -H "content-type: application/json" \
  --data-raw '{"type":"OIDC_PROVIDER","domainDiscriminator":"domain_discriminator"}')

echo "OIDC Provider Response:"
echo "$OIDC_RESPONSE"
