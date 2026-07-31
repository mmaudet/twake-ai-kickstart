# Patch `02-meet-host-delegation` — deployment notes

WS3 Patch B. When a calendar event is saved with a Meet URL
(`X-OPENPAAS-VIDEOCONFERENCE`) and one or more delegate emails
(`X-TWAKE-DELEGATE-HOSTS`), the side-service silently grants each
delegate `administrator` role on the underlying Meet room via
`POST /external-api/v1.0/rooms/<id>/grant-access/` — the endpoint
that Patch A (`../../meet_app/patches/01-external-rooms-grant-access.patch`)
added to the Meet backend.

Failures never block event save: token errors, HTTP failures, missing
rooms and per-delegate failures are logged as WARN and swallowed.

## What the patch touches

Applied against upstream `linagora/twake-calendar-side-service` at
commit `06e01598efa9` (branch-master tip, 2026-07-29 — the commit
that produced the deployed `:branch-master` image).

- `calendar-amqp/…/EventProperty.java` — new `DELEGATE_HOSTS` constant
  + public `name()` / `value()` accessors on the base class
- `calendar-amqp/…/CalendarEventMessage.java` — public `calendarEvent()`
  accessor on the abstract base
- `calendar-amqp/…/meet/MeetConfiguration.java` — config record read from
  `configuration.properties`
- `calendar-amqp/…/meet/MeetApplicationClient.java` — Reactor-Netty client
  for the three Meet external-API endpoints (token, rooms list, grant-access)
- `calendar-amqp/…/meet/MeetHostDelegationService.java` — parses each
  VEVENT, orchestrates token + slug lookup + per-delegate grants
- `calendar-amqp/…/meet/MeetHostDelegationConsumer.java` — dedicated AMQP
  consumer subscribed to `calendar:event:created` + `calendar:event:updated`
  with its own queues + dead-letter (does not share indexing queues)
- `calendar-amqp/…/meet/MeetHostDelegationReconnectionHandler.java` — RabbitMQ
  reconnection handler (mirrors `EventIndexerReconnectionHandler`)
- `calendar-amqp/…/meet/MeetIntegrationModule.java` — Guice module
  (bindings + init operation + reconnection multibind)
- `calendar-amqp/…/meet/MeetHostDelegationServiceTest.java` — WireMock unit
  tests (happy path, mixed success/failure, unreachable Meet, slug not found,
  disabled config, URL slug extraction)
- `app/…/TwakeCalendarMain.java` — installs `MeetIntegrationModule` in
  the module list

## Runtime prerequisites

On the running Meet deployment (see `../../meet_app/patches/README-grant-access.md`):
- Patch A applied and deployed (grant-access endpoint live).
- `EXTERNAL_API_ENABLED=true` and `APPLICATION_ENABLED=true`.
- An `Application` named `twake-calendar-side-service` registered with at
  least the `rooms:list` + `rooms:grant-access` scopes, whose
  `CLIENT_ID` and `CLIENT_SECRET` you capture.

On the side-service, set either via `configuration.properties` (mounted
at `/root/conf/configuration.properties` on the container) **or** the
identical env vars (docker-compose `environment:` block):

```
meet.enabled=true
meet.application.client_id=<CLIENT_ID>
meet.application.client_secret=<CLIENT_SECRET>
meet.external.api.base.url=http://visio-backend:8000
# optional:
#meet.rest.client.trust.all.ssl.certs=false
#meet.rest.client.response.timeout=10000
```

If `meet.enabled=false` (or absent), the consumer initialises to a no-op
and no queues are declared — safe to ship in a build even without config.

## Bootstrap — (re)generate the CLIENT_SECRET

The `CLIENT_SECRET` from Patch A's bootstrap block is only shown once
(the model hashes it on save). If lost, delete the Application and
re-create it:

```bash
docker exec visio-backend python manage.py shell -c "
from core.models import Application, ApplicationDomain, ApplicationScope
from secrets import token_hex

name = 'twake-calendar-side-service'
existing = Application.objects.filter(name=name).first()
if existing:
    existing.delete()
    print('Deleted previous Application:', name)

client_secret_plain = token_hex(64)
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
for domain in ('linagora.com', 'maudet.cloud'):
    ApplicationDomain.objects.create(application=app, domain=domain)
print('CLIENT_ID=' + app.client_id)
print('CLIENT_SECRET=' + client_secret_plain)
"
```

Capture both values into an untracked `.env.local` next to your compose
file — never commit them.

## Build the patched image

Everything is scripted:

```bash
./build-patched-image.sh                           # → workdir /tmp/twake-calendar-side-service-build
./build-patched-image.sh /path/to/persistent/dir   # or a stable workdir to keep the .m2 cache
```

What the script does:
1. Clones `linagora/twake-calendar-side-service` at the pinned commit
   (`06e01598efa9`) and applies `02-meet-host-delegation.patch`.
2. Clones `linagora/tmail-backend` (shallow) + initialises the
   `james-project` submodule.
3. Runs `mvn install -DskipTests` on the required tmail-backend modules
   (populates the local `.m2` cache — persistent inside the workdir).
4. Runs `mvn install -DskipTests` on the patched side-service — this
   produces `app/target/jib-image.tar` via the jib maven plugin.
5. `docker load` + `docker tag local/twake-calendar-side-service:ws3-hostdel`.

First run is ~15–30 min (fetches all james-project deps). Subsequent
runs are minutes.

## Wire the deployment to the patched image

In `../docker-compose.yml`, switch `tcalendar-side-service`:

```yaml
tcalendar-side-service:
  # image: linagora/twake-calendar-side-service:branch-master
  image: local/twake-calendar-side-service:ws3-hostdel
  environment:
    - meet.enabled=true
    - meet.application.client_id=${MEET_APPLICATION_CLIENT_ID}
    - meet.application.client_secret=${MEET_APPLICATION_CLIENT_SECRET}
    - meet.external.api.base.url=http://visio-backend:8000
```

Then reload:
```
docker compose up -d tcalendar-side-service
docker logs -f tcalendar-side-service | grep -iE "meet|delegation"
```

You should see on startup:
```
Meet host delegation is disabled — …          # if meet.enabled ≠ true
Trying to stop meet host delegation consumer  # on shutdown
```

## Smoke test

1. As an organizer (say `alice@linagora.com`), create a calendar event
   in Twake Calendar with a Meet URL — the calendar auto-adds
   `X-OPENPAAS-VIDEOCONFERENCE`.
2. Manually inject an `X-TWAKE-DELEGATE-HOSTS` property. Until Patch C
   ships a UI toggle, either:
   - Edit the `.ics` via CalDAV `PUT`, or
   - Use `docker exec sabre_dav` to run a small PHP script.
   The property must look like:
   ```
   X-TWAKE-DELEGATE-HOSTS:bob@linagora.com,carol@linagora.com
   ```
3. Save. In the side-service logs you should see:
   ```
   Granted admin on Meet room <uuid> to bob@linagora.com (HTTP 201)
   Granted admin on Meet room <uuid> to carol@linagora.com (HTTP 200)
   ```
4. Have Bob join the Meet room — he should see the admin controls
   (admit lobby, kick, etc.) without the organizer being present.

## Failure-mode sanity check

Set `MEET_APPLICATION_CLIENT_SECRET` to a wrong value, restart the
side-service, save an event with delegates. Expected: a WARN line
```
Meet host delegation failed for delegation Delegation[...] — skipping
```
The event still saves cleanly; no 5xx bubbles up to the calendar frontend.
