# meet_app/patches

Local overlay on top of the pinned DINUM release (`MEET_VERSION` in `.env`,
e.g. `v1.24.0`). Every `*.patch` in this directory is applied — sorted by
filename — by `../build-meet.sh` right after it checks out the upstream tag.

## Adding a patch

```bash
cd ../upstream           # the working clone that build-meet.sh reset to MEET_VERSION
# … edit or make your changes …
git diff > ../patches/01-short-summary.patch
```

Use the `NN-short-name.patch` convention so the ordering stays stable when
you add more. `git apply --index` is used, so the patches carry both file
content and mode/rename metadata.

## Rolling forward to a new DINUM release

1. Bump `MEET_VERSION` in `.env` (e.g. `v1.24.0` → `v1.25.0`)
2. Run `./build-meet.sh`
3. If a patch stops applying cleanly the script fails loudly — rebase that
   patch against the new tag inside `upstream/` and regenerate the `.patch`.

## Design intent

- Image tag stays DINUM-native (`v1.24.0`) so you can trace what upstream
  code was actually shipped.
- Our diff lives *outside* the build context of the upstream tree, checked
  in to git as small, reviewable text files rather than a fork branch.
- No patch → `build-meet.sh` builds an unmodified upstream image, tagged
  `twake-meet-{backend,frontend}:${MEET_VERSION}`.
