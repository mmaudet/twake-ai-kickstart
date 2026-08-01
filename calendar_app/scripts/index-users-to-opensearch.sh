#!/usr/bin/env bash
#
# Populate OpenSearch domain_contact index with every user from the
# calendar side-service MongoDB. Needed because the frontend attendee
# autocomplete resolves through ContactSearchProvider (backed by
# OpenSearch), not UserSearchProvider directly. Empty index = empty
# autocomplete results, even when Mongo has the users.
#
# Idempotent: re-running upserts on the same contactId (email-based).

set -euo pipefail

OS_CONTAINER="opensearch"
INDEX="domain_contact"

# Pull all users from Mongo as JSON lines
mapfile -t USERS < <(
    docker exec mongodb mongosh -u mongoroot -p password \
        --authenticationDatabase admin --quiet --eval '
            db.getSiblingDB("esn_docker").users.find({}, {email:1, firstname:1, lastname:1}).forEach(u => {
                if (u.email) print(JSON.stringify({email: u.email, firstname: u.firstname || "", surname: u.lastname || ""}))
            })
        '
)

echo "==> Indexing ${#USERS[@]} users into ${INDEX}"

for line in "${USERS[@]}"; do
    email=$(echo "${line}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["email"])')
    domain="${email##*@}"
    # contactId = base64-ish email as stable id
    contactId=$(echo -n "${email}" | md5sum | cut -c1-32)
    doc=$(echo "${line}" | python3 -c "import json,sys; d=json.load(sys.stdin); d['contactId']='${contactId}'; d['domain']='${domain}'; print(json.dumps(d))")

    docker exec "${OS_CONTAINER}" curl -sS -X PUT \
        -H 'Content-Type: application/json' \
        -d "${doc}" \
        "http://localhost:9200/${INDEX}/_doc/${contactId}" > /dev/null
    echo "  + indexed ${email}"
done

echo "==> Refreshing index"
docker exec "${OS_CONTAINER}" curl -sS -X POST "http://localhost:9200/${INDEX}/_refresh" > /dev/null

count=$(docker exec "${OS_CONTAINER}" curl -sS "http://localhost:9200/${INDEX}/_count" | python3 -c 'import json,sys; print(json.load(sys.stdin)["count"])')
echo "==> Done: ${INDEX} now has ${count} docs"
