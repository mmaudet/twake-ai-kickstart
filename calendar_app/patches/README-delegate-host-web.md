# Patch `03-frontend-delegate-host` — deployment notes

WS3 Patch C. Adds a per-attendee "delegate host" crown toggle to the
calendar-ng event editor. Ticked attendees end up in
`X-TWAKE-DELEGATE-HOSTS` on the ICS saved via CalDAV; the side-service
(Patch B) picks it up and grants each of them `administrator` role on
the underlying Meet room.

## What the patch touches

Applied against upstream `linagora/twake-calendar-frontend` at commit
`0d173029e5fd` (branch-master tip that produced the deployed
`linagora/twake-calendar-web:branch-master` image on 2026-07-28).

- `common/src/features/User/models/attendee.ts` — new `is_delegate_host: boolean`
  on `UserAttendeeData` + `withDelegateHost(flag)` helper (mirrors
  `withPartStat` / `withRsvp`).
- `common/src/features/Events/utils/makeVevent.ts` — emits
  `X-TWAKE-DELEGATE-HOSTS:<comma-emails>` at the top of the VEVENT
  when at least one attendee has the flag set.
- `common/src/features/Events/utils/parseCalendarEvent.ts` — reads the
  property on load, sets `is_delegate_host` on matching attendees, and
  removes it from `passthroughProps` (so it's not double-emitted on
  re-serialize).
- `common/src/components/Attendees/AttendeeChip.tsx` — new
  `getChipAction` prop; when present, renders a crown IconButton
  (filled = on, outlined = off) inside the chip label. Click toggles
  the attendee's flag; `stopPropagation` prevents the Chip's select
  handler from firing.
- `common/src/components/Attendees/PeopleSearch.tsx` — threads
  `getChipAction` through to `AttendeeChip`.
- `common/src/components/Attendees/AttendeeSearch.tsx` — provides the
  toggle callback; **also fixes a pre-existing bug** where the
  `handleOnChange` was rebuilding every attendee from scratch on any
  list mutation, silently wiping metadata like `partstat` and now
  `is_delegate_host`. It now preserves the existing `userAttendee`
  instance when an email is already in the list.

## Runtime prerequisites

- Patch A (`../../meet_app/patches/01-external-rooms-grant-access.patch`)
  applied and deployed on the Meet backend.
- Patch B (`02-meet-host-delegation.patch`) built into the patched
  side-service image (`local/twake-calendar-side-service:ws3-hostdel`)
  and enabled via `MEET_ENABLED=true` in the deploy `.env`.
- Nothing new to configure for Patch C — pure frontend change.

## Build the patched image

Everything is scripted:

```bash
./build-patched-web-image.sh                              # → workdir /tmp/twake-calendar-frontend-build
./build-patched-web-image.sh /path/to/persistent/dir      # or a stable workdir for the ~1GB node_modules cache
```

What the script does:
1. Clones `linagora/twake-calendar-frontend` at the pinned commit
   `0d173029e5fd` and applies `03-frontend-delegate-host.patch`.
2. Runs `npm ci` then `npm run build:private` inside a `node:20`
   docker container (first run ~5–10 min; subsequent runs seconds).
3. `docker build -f apps/private/Dockerfile -t local/twake-calendar-web:ws3-hostdel .`

## Wire the deployment to the patched image

In `../docker-compose.yml`, `tcalendar-frontend.image` already reads
from `${TCALENDAR_WEB_IMAGE:-linagora/twake-calendar-web:branch-master}`.
Set the env in `../../.env`:

```
TCALENDAR_WEB_IMAGE=local/twake-calendar-web:ws3-hostdel
```

Then reload:
```
cd calendar_app
sudo docker compose --env-file ../.env up -d tcalendar-frontend
```

Hard-reload the browser (calendar-ng caches aggressively).

## Smoke test

1. Log into `https://calendar-ng.<BASE>/` as an organizer whose
   `client_credentials` scope is permitted by the Meet Application
   (see Patch B README — `linagora.com` and `twake-dev.maudet.cloud`
   are the default allowed domains).
2. Create an event. Add a Meet URL via the "Add Visio conference"
   button (auto-generates a Meet room owned by the organizer).
3. In the attendee field, type a delegate's full email
   (e.g. `bandre@linagora.com`) and press Enter. A chip appears — the
   `freeSolo` + `enableEmailAutocompleteAndCommit` combo accepts a raw
   email even when `/api/people/search` returns empty, so directory
   sync isn't a prerequisite for testing.
4. Click the small crown icon inside the chip label. It should switch
   from outlined to filled.
5. Save the event.
6. Tail the side-service logs:
   ```
   docker logs -f tcalendar-side-service | grep -iE "MeetHostDeleg|MeetApplication"
   ```
   Expect:
   ```
   Granted admin on Meet room <uuid> to bandre@linagora.com (HTTP 201)
   ```
7. Verify in the Meet DB:
   ```
   docker exec visio-backend python manage.py shell -c "
   from core.models import Room, ResourceAccess
   r = Room.objects.filter(slug='<slug>').first()
   print([(a.role, a.user.email if a.user else None) for a in ResourceAccess.objects.filter(resource=r)])
   "
   ```

## Round-trip

Re-open the saved event — the bandre chip should have the crown lit.
Un-toggle it, save, re-open; crown should stay off, and the ICS
`X-TWAKE-DELEGATE-HOSTS` property should be gone (the backend
re-emitting it would only happen if any attendee still had the flag).

## Known limitations / follow-ups

- **Attendee search is empty for LDAP users.** The `ContactSearchProvider`
  reads OpenSearch (`user_contact` / `domain_contact`) which is populated
  by the DAV vcard flow, not by user creation. The `scripts/sync-ldap-users.sh`
  helper populates MongoDB via `POST /domains/<domain>/registeredUsers`,
  but the OpenSearch indexing hook for those users is a separate concern
  (probably needs an event bus listener or a first-login vcard emission).
  Workaround for testing: type the full email and rely on `freeSolo`.
- **i18n keys not yet added.** The tooltip text on the crown IconButton
  is currently hard-coded English via `title=`. Follow-up: add
  `attendees.delegateHost*` keys under `common/src/locales/{en,fr,ru,vi}.json`
  and wire via `useI18n()`.
- **No unit test yet.** Follow-up: add cases to the ICS-utils tests
  (verify emission + round-trip parsing) and to the attendee-chip test.
- **Upstream PR** deferred until end-to-end validated across accounts
  (organizer + delegate log in and confirm Meet admin controls appear).
