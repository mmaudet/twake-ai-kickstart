#!/usr/bin/env python3
"""Idempotently install the visio-upcoming-meets overlay on hermes.

Cozy's Visio app is served by cozy-stack from the registry
(`registry://visio/stable`, no local source), so we cannot edit its
HTML at build time. Instead we patch the existing wildcard hermes
vhost `sites-enabled/twake-dev` to conditionally inject `widget.js`
via nginx `sub_filter` when the requested host matches
`*-visio.<BASE>`. Other subdomains are untouched (the map is empty
for them, sub_filter no-ops).

Attempted first: a dedicated vhost with a regex server_name. That
approach doesn't work because nginx picks wildcard server_names over
regex ones for the same host — the shared `*.twake-dev.maudet.cloud`
wildcard already claims `<user>-visio.twake-dev.maudet.cloud`.

Files touched on hermes (all root-owned):
  /etc/nginx/sites-enabled/twake-dev             (patched in place — see markers below)
  /etc/nginx/conf.d/visio-inject.conf            (new: the `map` block, http-level)
  /var/www/visio-patches/widget.js               (copy of the local widget.js)

Usage:
  scp cozy_apps_source/visio/infra/{hermes-nginx-patch.py,widget.js} hermes:/tmp/
  ssh hermes 'sudo python3 /tmp/hermes-nginx-patch.py --widget /tmp/widget.js && \
              sudo nginx -t && sudo nginx -s reload'
"""
from __future__ import annotations
import argparse, os, pathlib, re, shutil, sys, textwrap

VHOST_PATH = pathlib.Path("/etc/nginx/sites-enabled/twake-dev")
MAP_CONF_PATH = pathlib.Path("/etc/nginx/conf.d/visio-inject.conf")
WIDGET_DEPLOY_DIR = pathlib.Path("/var/www/visio-patches")
WIDGET_URL_PATH = "/visio-patches/widget.js"

# Marker lines that let us find + replace our own injection idempotently
# on re-runs. Kept short so they don't churn if we later change wording.
BEGIN = "# BEGIN visio-inject"
END = "# END visio-inject"

# The `map` sets $visio_inject to a <script> tag for -visio.* hosts,
# empty for anything else. Lives in the http context (conf.d/).
MAP_CONF = f"""{BEGIN}
# Managed by cozy_apps_source/visio/infra/hermes-nginx-patch.py
# Injects widget.js only when Host matches <user>-visio.<BASE_DOMAIN>.
map $host $visio_inject {{
    default "";
    ~^[^.]+-visio\\.twake-dev\\.maudet\\.cloud$
        '<script src="{WIDGET_URL_PATH}" defer></script>';
}}
{END}
"""

# Snippet injected into the wildcard vhost's `server { ... }` block.
# Adds:
#   - a `location /visio-patches/` that serves widget.js from disk
#     (short-circuits the proxy_pass, must come before location /)
#   - inside `location /`, the sub_filter that appends $visio_inject
#     before </body>. When $visio_inject is empty (any non-visio host)
#     nginx still runs the substitution but the output is unchanged.
LOCATION_SNIPPET = f"""    {BEGIN}
    # Serve the injected widget locally so cozy-stack never sees this URL.
    location /visio-patches/ {{
        alias {WIDGET_DEPLOY_DIR}/;
        add_header Cache-Control "no-cache";
        default_type application/javascript;
    }}
    {END}
"""

# sub_filter fragment to inject inside `location / { ... }` — after
# the existing proxy_set_header lines, before the closing brace.
SUBFILTER_SNIPPET = f"""        {BEGIN}
        # Empty for non-visio hosts (see map in conf.d/visio-inject.conf).
        proxy_set_header Accept-Encoding "";
        sub_filter_once on;
        sub_filter '</body>' '$visio_inject</body>';
        {END}
"""


def install_widget(source_widget: pathlib.Path) -> None:
    WIDGET_DEPLOY_DIR.mkdir(parents=True, exist_ok=True)
    target = WIDGET_DEPLOY_DIR / "widget.js"
    if target.exists() and target.read_bytes() == source_widget.read_bytes():
        print(f"[widget] {target} already up to date")
        return
    shutil.copy2(source_widget, target)
    os.chmod(target, 0o644)
    print(f"[widget] copied {source_widget} -> {target}")


def install_map_conf() -> None:
    if MAP_CONF_PATH.exists() and MAP_CONF_PATH.read_text() == MAP_CONF:
        print(f"[map] {MAP_CONF_PATH} already up to date")
        return
    MAP_CONF_PATH.write_text(MAP_CONF)
    print(f"[map] wrote {MAP_CONF_PATH}")


def patch_vhost() -> None:
    src = VHOST_PATH.read_text()

    # 1) strip any prior injection block so re-runs are idempotent
    stripped = re.sub(
        rf"\s*{re.escape(BEGIN)}.*?{re.escape(END)}\n?",
        "\n",
        src,
        flags=re.DOTALL,
    )

    # 2) reinsert the location /visio-patches/ block just after the
    #    opening of `server {` (before any other location)
    server_open = re.search(r"^\s*server\s*\{\s*\n", stripped, re.MULTILINE)
    if not server_open:
        raise RuntimeError(f"couldn't find `server {{` in {VHOST_PATH}")
    insert_at = server_open.end()
    patched = stripped[:insert_at] + LOCATION_SNIPPET + stripped[insert_at:]

    # 3) reinsert the sub_filter fragment inside the FIRST `location / { ... }`
    m = re.search(r"(location\s+/\s*\{)", patched)
    if not m:
        raise RuntimeError(f"couldn't find `location /` in {VHOST_PATH}")
    insert_at = m.end()
    patched = patched[:insert_at] + "\n" + SUBFILTER_SNIPPET + patched[insert_at:]

    if patched == src:
        print(f"[vhost] {VHOST_PATH} already up to date")
        return
    VHOST_PATH.write_text(patched)
    print(f"[vhost] patched {VHOST_PATH}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--widget",
        type=pathlib.Path,
        default=pathlib.Path(__file__).parent / "widget.js",
        help="Path to widget.js to install (defaults to sibling widget.js).",
    )
    args = parser.parse_args()

    if os.geteuid() != 0:
        print("error: run as root (writes /etc/nginx and /var/www)", file=sys.stderr)
        return 2
    if not args.widget.exists():
        print(f"error: widget file not found: {args.widget}", file=sys.stderr)
        return 2
    if not VHOST_PATH.exists():
        print(f"error: expected wildcard vhost not found: {VHOST_PATH}", file=sys.stderr)
        return 2

    install_widget(args.widget)
    install_map_conf()
    patch_vhost()

    print()
    print(textwrap.dedent(
        """
        Next steps (run as root):
          nginx -t && nginx -s reload

        Verify with:
          curl -sk https://mmaudet-visio.twake-dev.maudet.cloud/visio-patches/widget.js | head -3
          curl -sk https://mmaudet-visio.twake-dev.maudet.cloud/ | grep -o '<script src="/visio-patches/widget.js"[^>]*>'
          curl -sk https://mmaudet-drive.twake-dev.maudet.cloud/    | grep -c '/visio-patches/widget.js' || true    # must be 0
        """
    ).strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
