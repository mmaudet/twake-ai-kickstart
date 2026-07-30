/*
 * visio-upcoming-meets widget
 * ----------------------------
 * Injected into the Cozy Visio app served at *-visio.<BASE_DOMAIN> via
 * hermes nginx `sub_filter`. Renders a "Prochains RDV Meet" panel on top
 * of the visio home page.
 *
 * v1 (current): placeholder. Links to the Twake Calendar app so the user
 * can see their events there. Proves the injection pattern.
 *
 * v2 (TODO): fetch events from tcalendar-side-service and inline the
 * list. Blocker to solve first: cross-origin auth. `tcalendar-side-
 * service.<BASE_DOMAIN>` uses OIDC bearer tokens stored in
 * `calendar-ng.<BASE_DOMAIN>` localStorage — inaccessible from
 * `*-visio.<BASE_DOMAIN>`. Three viable paths:
 *
 *   A) Silent OIDC (prompt=none) from the widget → get a fresh access
 *      token in-page, filter events with meet URLs, render inline.
 *   B) Push events to `io.cozy.events` doctype on cozy-stack, add
 *      the permission to the visio manifest, query cozy-client
 *      locally. Cleanest but requires wiring the sync.
 *   C) Proxy through cozy-stack (add a route on cozy that forwards
 *      to tcalendar-side-service with the session-derived token).
 *
 * Fallback contract: on ANY error, hide the widget entirely. The visio
 * home must never look broken because our overlay failed.
 */
(function () {
  'use strict';

  var BASE_DOMAIN = 'twake-dev.maudet.cloud';                    // subdomain suffix, computed below if empty
  var MEET_HOST_PATTERN = /meet\.twake-dev\.maudet\.cloud/i;      // v2: filter events on this

  // Derive BASE_DOMAIN from current host, so the same widget works on any
  // future domain without editing this file. Host is `<user>-visio.<domain>`.
  try {
    var host = window.location.hostname;
    var dashIdx = host.indexOf('-visio.');
    if (dashIdx > 0) BASE_DOMAIN = host.substring(dashIdx + '-visio.'.length);
  } catch (_) { /* keep default */ }

  var CALENDAR_URL = 'https://calendar-ng.' + BASE_DOMAIN + '/';

  function render() {
    try {
      // Find a mount point at the top of the visio home. The Cozy Visio app
      // renders into `#app`; wait for it to exist.
      var app = document.getElementById('app') || document.body;
      if (!app || document.getElementById('visio-upcoming-meets')) return;

      var wrap = document.createElement('div');
      wrap.id = 'visio-upcoming-meets';
      wrap.style.cssText = [
        'margin: 24px auto',
        'max-width: 720px',
        'padding: 20px 24px',
        'background: linear-gradient(135deg,#FF7B24 0%,#FFA92E 100%)',
        'color: #fff',
        'border-radius: 12px',
        'box-shadow: 0 2px 8px rgba(0,0,0,0.08)',
        'font-family: system-ui, -apple-system, sans-serif',
      ].join(';');

      var h = document.createElement('h3');
      h.textContent = 'Prochains RDV Meet';
      h.style.cssText = 'margin:0 0 8px;font-size:1.15em;font-weight:600';
      wrap.appendChild(h);

      var p = document.createElement('p');
      p.textContent = 'Retrouvez vos prochains rendez-vous avec un lien Meet dans votre agenda Twake.';
      p.style.cssText = 'margin:0 0 14px;opacity:0.92;font-size:0.95em';
      wrap.appendChild(p);

      var link = document.createElement('a');
      link.href = CALENDAR_URL;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Ouvrir mon agenda';
      link.style.cssText = [
        'display:inline-block',
        'padding:8px 16px',
        'background:#fff',
        'color:#FF7B24',
        'text-decoration:none',
        'border-radius:6px',
        'font-weight:600',
        'font-size:0.95em',
      ].join(';');
      wrap.appendChild(link);

      // Insert at the very top of the app root so the user sees it first.
      app.insertBefore(wrap, app.firstChild);
    } catch (err) {
      // Fallback contract: silent on any error.
      if (window.console && console.debug) console.debug('[visio-upcoming-meets] render skipped:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
  // Cozy Visio hydrates the DOM after initial parse. Re-run once the app
  // has had a beat to mount so we don't insert before its own root wipe.
  window.setTimeout(render, 500);
  window.setTimeout(render, 2000);
})();
