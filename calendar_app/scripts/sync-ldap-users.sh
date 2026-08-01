#!/usr/bin/env bash
#
# Sync every LDAP inetOrgPerson entry into the calendar side-service
# MongoDB user store via POST /domains/<domain>/registeredUsers.
#
# The side-service runs in UserChoice.MEMORY mode (no built-in LDAP
# reader). Attendee autocomplete in calendar-ng reads from MongoDB, so
# users who have never logged in via OIDC don't appear. This script
# provisions them ahead of time.
#
# Idempotent: HTTP 409 on an already-registered user is treated as OK.
#
# Requires: ldap and tcalendar-side-service containers running,
# webadmin password known.

set -euo pipefail

LDAP_CONTAINER="ldap"
CAL_CONTAINER="tcalendar-side-service"
LDAP_BASE="dc=twake-dev,dc=maudet,dc=cloud"
LDAP_ADMIN_DN="cn=admin,${LDAP_BASE}"
LDAP_ADMIN_PW="${LDAP_ADMIN_PW:-admin}"
USERS_OU="ou=users,${LDAP_BASE}"

# Webadmin password — pinned in deploy .env or read from side-service
# logs. Pass via env: WEBADMIN_PASSWORD=... ./sync-ldap-users.sh
if [ -z "${WEBADMIN_PASSWORD:-}" ]; then
    WEBADMIN_PASSWORD=$(docker logs "${CAL_CONTAINER}" 2>&1 \
        | grep -o "Generated WebAdmin password: [^ ]*" \
        | tail -1 | awk '{print $NF}')
fi
if [ -z "${WEBADMIN_PASSWORD}" ]; then
    echo "ERROR: could not find webadmin password. Set WEBADMIN_PASSWORD env var." >&2
    exit 1
fi

echo "==> Pulling LDAP users from ${USERS_OU}"
mapfile -t ENTRIES < <(
    docker exec "${LDAP_CONTAINER}" ldapsearch -x -H ldap://localhost \
        -D "${LDAP_ADMIN_DN}" -w "${LDAP_ADMIN_PW}" \
        -b "${USERS_OU}" -LLL \
        "(objectClass=inetOrgPerson)" mail givenName sn \
        2>/dev/null | awk '
            /^dn:/ { if (mail) print mail "|" (given?given:mail) "|" (sn?sn:mail); mail=""; given=""; sn="" }
            /^mail:/ { mail=$2 }
            /^givenName:/ { $1=""; sub(/^ /,""); given=$0 }
            /^sn:/ { $1=""; sub(/^ /,""); sn=$0 }
            END { if (mail) print mail "|" (given?given:mail) "|" (sn?sn:mail) }
        '
)

echo "==> ${#ENTRIES[@]} LDAP users to sync"

created=0
existed=0
failed=0
for entry in "${ENTRIES[@]}"; do
    IFS='|' read -r email given sn <<< "${entry}"
    [ -z "${email}" ] && continue
    domain="${email##*@}"

    payload=$(printf '{"email":"%s","firstname":"%s","lastname":"%s"}' \
        "${email}" "${given//\"/}" "${sn//\"/}")

    resp=$(docker exec "${CAL_CONTAINER}" curl -sSw "\n%{http_code}" \
        -X POST \
        -H "Password: ${WEBADMIN_PASSWORD}" \
        -H 'Content-Type: application/json' \
        -d "${payload}" \
        "http://localhost:8000/domains/${domain}/registeredUsers" 2>&1)
    code=$(echo "${resp}" | tail -1)
    body=$(echo "${resp}" | sed '$d')

    case "${code}" in
        201)
            echo "  + created ${email}"
            created=$((created + 1))
            ;;
        409)
            echo "  = already registered ${email}"
            existed=$((existed + 1))
            ;;
        *)
            echo "  ! ${email} HTTP ${code} — ${body}" >&2
            failed=$((failed + 1))
            ;;
    esac
done

echo
echo "==> Done: created=${created} existed=${existed} failed=${failed}"
[ "${failed}" -eq 0 ]
