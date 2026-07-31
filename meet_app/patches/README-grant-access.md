# Patch `01-external-rooms-grant-access` — deployment notes

Adds `POST /external-api/v1.0/rooms/<id>/grant-access/` on the Meet
backend, so an application (typically the Twake Calendar side-service)
can promote a delegate attendee to `admin` on a room the meeting
organiser owns.

## What the patch touches

- `core/models.py` — new `ApplicationScope.ROOMS_GRANT_ACCESS`
- `core/external_api/permissions.py` — new `scope_map` entry
- `core/external_api/serializers.py` — new `GrantAccessSerializer`
- `core/external_api/viewsets.py` — new `grant_access` action on `RoomViewSet`

Behaviour:
- The authenticated user (from the application-JWT scope) must be
  OWNER or ADMIN of the room, else 403.
- The delegate is identified by email. If the account doesn't exist,
  `ProvisionalUserService` creates a placeholder (claimed by the user
  on their first OIDC login by email match).
- Idempotent: re-running with the same `email`+`role` returns 200 with
  `created: false`. Existing OWNER access is preserved (returns 200).

## Runtime prerequisites

Set on the backend container (see `meet_app/docker-compose.yml`):

```
EXTERNAL_API_ENABLED=true          # exposes /external-api/v1.0/*
APPLICATION_ENABLED=true           # turns on the FeatureFlag decorator
APPLICATION_JWT_SECRET_KEY=<key>   # HMAC key for the app-JWT
APPLICATION_JWT_AUDIENCE=twake-meet-app
APPLICATION_ALLOW_USER_CREATION=true
OIDC_FALLBACK_TO_EMAIL_FOR_IDENTIFICATION=true   # required by ProvisionalUserService
OIDC_USER_SUB_FIELD_IMMUTABLE=false              # required so the delegate can claim their sub on first login
APPLICATION_BASE_URL=https://meet.<BASE>
```

And on `meet_app/config/nginx.conf` on the frontend container, proxy
the new namespace:

```nginx
location ^~ /external-api/ {
    proxy_pass http://backend:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    ...
}
```

## Bootstrap — register the calendar side-service as an Application

Run inside the backend container (idempotent — skips if the name is
already registered):

```bash
docker exec visio-backend python manage.py shell -c "
from core.models import Application, ApplicationDomain, ApplicationScope
from secrets import token_hex

name = 'twake-calendar-side-service'
app = Application.objects.filter(name=name).first()
if app:
    print('Application already exists:', app.client_id)
else:
    client_secret_plain = token_hex(64)   # SecretField hashes on save; capture now
    app = Application.objects.create(
        name=name,
        client_secret=client_secret_plain,
        scopes=[
            ApplicationScope.ROOMS_CREATE,
            ApplicationScope.ROOMS_LIST,
            ApplicationScope.ROOMS_RETRIEVE,
            ApplicationScope.ROOMS_UPDATE,
            ApplicationScope.ROOMS_GRANT_ACCESS,
        ],
        is_active=True,
    )
    for domain in ('linagora.com', '<other allowed domain>'):
        ApplicationDomain.objects.create(application=app, domain=domain)
    print('CLIENT_ID=' + app.client_id)
    print('CLIENT_SECRET=' + client_secret_plain)
"
```

Copy the printed `CLIENT_ID` + `CLIENT_SECRET` into the side-service
config (patch B, forthcoming).

## Smoke test

```bash
CID=<client_id>
CSEC=<client_secret>

# 1) app-JWT scoped to the meeting organiser's email
TOK=$(curl -sk -X POST https://meet.<BASE>/external-api/v1.0/application/token/ \
  -H 'Content-Type: application/json' \
  -d "{\"client_id\":\"$CID\",\"client_secret\":\"$CSEC\",\"grant_type\":\"client_credentials\",\"scope\":\"organizer@example.com\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')

# 2) list rooms owned by organizer
curl -sk -H "Authorization: Bearer $TOK" \
  https://meet.<BASE>/external-api/v1.0/rooms/

# 3) grant admin to a delegate on one of those rooms
ROOM_ID=<uuid>
curl -sk -X POST "https://meet.<BASE>/external-api/v1.0/rooms/$ROOM_ID/grant-access/" \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"email":"delegate@example.com","role":"administrator"}'
# → 201 { email, role, created:true, provisional_user_created:true }
# on re-run → 200 { …, created:false, provisional_user_created:false }
```

## Follow-ups (patches B + C)

- Patch B — `twake-calendar-side-service`: on event save, if the event
  has a Meet URL and one or more delegate attendees, call
  `/rooms/<id>/grant-access/` for each.
- Patch C — `twake-calendar-frontend`: UI toggle per attendee to mark
  them as delegate. Serialised as an ICS `X-TWAKE-DELEGATE-HOSTS`
  custom property that the side-service reads.
