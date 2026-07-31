/*
 * visio-upcoming-meets widget — v2 (silent OIDC + real events)
 * ------------------------------------------------------------
 * Injected into Cozy Visio (`*-visio.<BASE_DOMAIN>`) by hermes
 * sub_filter. Fetches upcoming events from the Twake Calendar side-
 * service, keeps only those with a Meet URL in URL/description,
 * renders them as a list at the top of the visio home page.
 *
 * Auth: silent OIDC (prompt=none) against the LLNG `visio-widget`
 * public client. Because the browser already has an LLNG session
 * cookie on `.<BASE_DOMAIN>` (from the Cozy login), no user
 * interaction is required — the hidden iframe redirects straight
 * back with a `code`, which we swap for an access_token via PKCE.
 *
 * Fallback contract: any error → hide the widget entirely so the
 * visio home never looks broken because our overlay failed. If we
 * cannot obtain a token silently (LLNG session missing, network
 * error, side-service down) the widget renders the v1 fallback: a
 * link out to the full Calendar app.
 */
(function () {
  'use strict';

  var CFG = {
    // populated from window.location + Cozy defaults; overridable via
    // <script src="widget.js" data-...> attributes if we ever need to.
    clientId: 'visio-widget',
    scope: 'openid profile email',
    llngIssuer: null,          // computed below: https://auth.<BASE>
    sideServiceBase: null,     // computed below: https://tcalendar-side-service.<BASE>
    calendarUiBase: null,      // computed below: https://calendar-ng.<BASE>
    meetHostPattern: null,     // computed below: /meet\.<BASE>/i
    silentCallbackPath: '/oauth-silent-callback',
    upcomingWindowDays: 14,     // fetch events in the next N days
    maxEventsToShow: 5,
  };

  // --- host wiring: derive everything from window.location.hostname
  // (`<user>-visio.<BASE_DOMAIN>`), so the same widget works on any
  // future domain without editing here.
  var hostname = window.location.hostname;
  var suffixIdx = hostname.indexOf('-visio.');
  if (suffixIdx < 0) return;   // safety: not on a *-visio host, do nothing
  var BASE_DOMAIN = hostname.substring(suffixIdx + '-visio.'.length);
  CFG.llngIssuer = 'https://auth.' + BASE_DOMAIN;
  CFG.sideServiceBase = 'https://tcalendar-side-service.' + BASE_DOMAIN;
  CFG.calendarUiBase = 'https://calendar-ng.' + BASE_DOMAIN + '/';
  CFG.meetHostPattern = new RegExp('meet\\.' + BASE_DOMAIN.replace(/\./g, '\\.'), 'i');

  var STORAGE_KEY = 'visio-widget-oidc';   // localStorage: { access_token, refresh_token, exp }

  // ============================================================
  // PKCE helpers (Web Crypto)
  // ============================================================
  function b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randomString(len) {
    var bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return b64url(bytes);
  }
  function sha256(input) {
    var buf = new TextEncoder().encode(input);
    return crypto.subtle.digest('SHA-256', buf).then(function (hash) {
      return b64url(new Uint8Array(hash));
    });
  }

  // ============================================================
  // OIDC — silent authorization_code + PKCE
  // ============================================================
  function silentAuthorize() {
    // Returns a Promise resolving to { access_token, refresh_token, expires_in }
    // or rejecting on error / login_required.
    return new Promise(function (resolve, reject) {
      var code_verifier = randomString(48);
      var state = randomString(16);
      var nonce = randomString(16);
      sha256(code_verifier).then(function (code_challenge) {
        var redirectUri = window.location.origin + CFG.silentCallbackPath;
        var authUrl = CFG.llngIssuer + '/oauth2/authorize'
          + '?client_id=' + encodeURIComponent(CFG.clientId)
          + '&response_type=code'
          + '&scope=' + encodeURIComponent(CFG.scope)
          + '&redirect_uri=' + encodeURIComponent(redirectUri)
          + '&state=' + encodeURIComponent(state)
          + '&nonce=' + encodeURIComponent(nonce)
          + '&code_challenge=' + encodeURIComponent(code_challenge)
          + '&code_challenge_method=S256'
          + '&prompt=none';

        var iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
        iframe.src = authUrl;
        var timer = null;
        var done = false;

        function cleanup() {
          if (done) return; done = true;
          if (timer) clearTimeout(timer);
          window.removeEventListener('message', onMessage);
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }
        function onMessage(ev) {
          if (!ev.data || ev.data.source !== 'visio-widget-oidc-callback') return;
          if (ev.origin !== window.location.origin) return;
          var params = new URLSearchParams(ev.data.query || '');
          if (params.get('error')) { cleanup(); reject(new Error('oidc: ' + params.get('error'))); return; }
          if (params.get('state') !== state) { cleanup(); reject(new Error('oidc: state mismatch')); return; }
          var code = params.get('code');
          if (!code) { cleanup(); reject(new Error('oidc: no code')); return; }
          cleanup();
          exchangeCodeForToken(code, code_verifier, redirectUri).then(resolve, reject);
        }
        window.addEventListener('message', onMessage);
        timer = setTimeout(function () { cleanup(); reject(new Error('oidc: iframe timeout')); }, 10000);
        document.body.appendChild(iframe);
      });
    });
  }

  function exchangeCodeForToken(code, code_verifier, redirectUri) {
    var body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', redirectUri);
    body.set('client_id', CFG.clientId);
    body.set('code_verifier', code_verifier);
    return fetch(CFG.llngIssuer + '/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('token: ' + r.status + ' ' + t); });
      return r.json();
    });
  }

  function getCachedToken() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.access_token) return null;
      if (obj.exp && obj.exp < Date.now() / 1000 + 30) return null; // 30 s slack
      return obj;
    } catch (_e) { return null; }
  }
  function cacheToken(t) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        access_token: t.access_token,
        refresh_token: t.refresh_token || null,
        exp: Math.floor(Date.now() / 1000) + (t.expires_in || 300),
      }));
    } catch (_e) { /* quota / private mode → just don't cache */ }
  }

  function getAccessToken() {
    var cached = getCachedToken();
    if (cached) return Promise.resolve(cached.access_token);
    return silentAuthorize().then(function (t) { cacheToken(t); return t.access_token; });
  }

  // ============================================================
  // side-service — user & upcoming events
  // ============================================================
  function apiGet(path, token) {
    return fetch(CFG.sideServiceBase + path, {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
    }).then(function (r) {
      if (r.status === 401) {
        // Cached token is stale (rotated audience, LLNG session
        // dropped, …). Drop it and let the next run() retry a
        // fresh silent auth. Signal caller to fall back for this
        // pass.
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        throw new Error('api ' + path + ': 401 (cache cleared, will retry)');
      }
      if (!r.ok) throw new Error('api ' + path + ': ' + r.status);
      return r.json();
    });
  }

  function fetchUpcomingMeetEvents(token) {
    // 1) /api/user → { _id, ... }
    return apiGet('/api/user', token).then(function (user) {
      var uid = user && user._id;
      if (!uid) throw new Error('api: no user id');
      // 2) /dav/calendars/<uid>.json?personal=true → { _embedded: { "dav:calendar": [ { _links, ... } ] } }
      return apiGet('/dav/calendars/' + uid + '.json?personal=true', token).then(function (home) {
        var calendars = ((home && home._embedded && home._embedded['dav:calendar']) || []);
        if (!calendars.length) return [];
        // 3) For each personal calendar, ask for events in the next N days.
        //    side-service ships a query-events REST route on top of sabre's
        //    CalDAV REPORT — GET the calendar collection with a time-range.
        var now = new Date();
        var end = new Date(now.getTime() + CFG.upcomingWindowDays * 86400e3);
        var params = 'start=' + encodeURIComponent(now.toISOString())
                   + '&end=' + encodeURIComponent(end.toISOString());
        var fetches = calendars.map(function (cal) {
          var self = cal && cal._links && cal._links.self && cal._links.self.href;
          if (!self) return Promise.resolve([]);
          // strip leading "/"
          var relPath = self.charAt(0) === '/' ? self : '/' + self;
          return apiGet(relPath + '?' + params, token).catch(function () { return []; });
        });
        return Promise.all(fetches).then(function (perCal) {
          var all = [];
          perCal.forEach(function (arr) {
            if (arr && arr._embedded && arr._embedded['dav:item']) {
              arr._embedded['dav:item'].forEach(function (ev) { all.push(ev); });
            } else if (Array.isArray(arr)) {
              arr.forEach(function (ev) { all.push(ev); });
            }
          });
          return all;
        });
      });
    }).then(function (events) {
      return events
        .map(parseEvent)
        .filter(function (e) { return e && e.hasMeet; })
        .sort(function (a, b) { return a.start - b.start; })
        .slice(0, CFG.maxEventsToShow);
    });
  }

  function parseEvent(raw) {
    // raw is a sabre-JSON event: { data: <jCal>, etag, ... } or an already-decoded object.
    try {
      var summary = '', dtstart = null, url = '', description = '';
      var d = raw && raw.data;
      if (Array.isArray(d) && d[0] === 'vcalendar') {
        // jCal: [ "vcalendar", [props], [components] ]
        var components = d[2] || [];
        for (var i = 0; i < components.length; i++) {
          var comp = components[i];
          if (comp[0] !== 'vevent') continue;
          var props = comp[1] || [];
          for (var j = 0; j < props.length; j++) {
            var p = props[j];
            if (!p) continue;
            if (p[0] === 'summary') summary = String(p[3] || '');
            else if (p[0] === 'dtstart') dtstart = new Date(p[3] || 0);
            else if (p[0] === 'url') url = String(p[3] || '');
            else if (p[0] === 'description') description = String(p[3] || '');
          }
          break; // first vevent only
        }
      } else if (typeof raw === 'object') {
        summary = raw.summary || raw.title || '';
        dtstart = raw.start ? new Date(raw.start) : null;
        url = raw.url || raw.location || '';
        description = raw.description || '';
      }
      if (!dtstart) return null;
      var haystack = url + '\n' + description;
      var hasMeet = CFG.meetHostPattern.test(haystack);
      var meetUrl = null;
      if (hasMeet) {
        var m = haystack.match(new RegExp('https?://[^\\s"<]*meet\\.' + BASE_DOMAIN.replace(/\./g, '\\.') + '[^\\s"<]*', 'i'));
        if (m) meetUrl = m[0];
      }
      return { summary: summary, start: dtstart, meetUrl: meetUrl, hasMeet: hasMeet };
    } catch (_e) { return null; }
  }

  // ============================================================
  // rendering
  // ============================================================
  function formatWhen(dt) {
    try {
      return dt.toLocaleString('fr-FR', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
      });
    } catch (_e) { return dt.toString(); }
  }

  function ensureContainer() {
    var app = document.getElementById('app') || document.body;
    var existing = document.getElementById('visio-upcoming-meets');
    if (existing) return existing;
    var wrap = document.createElement('div');
    wrap.id = 'visio-upcoming-meets';
    wrap.style.cssText = [
      'margin:24px auto', 'max-width:720px', 'padding:20px 24px',
      'background:linear-gradient(135deg,#FF7B24 0%,#FFA92E 100%)', 'color:#fff',
      'border-radius:12px', 'box-shadow:0 2px 8px rgba(0,0,0,0.08)',
      'font-family:system-ui,-apple-system,sans-serif',
    ].join(';');
    app.insertBefore(wrap, app.firstChild);
    return wrap;
  }

  function renderLoading() {
    var wrap = ensureContainer();
    wrap.innerHTML = '';
    var h = document.createElement('h3');
    h.textContent = 'Prochains RDV Meet';
    h.style.cssText = 'margin:0 0 8px;font-size:1.15em;font-weight:600';
    wrap.appendChild(h);
    var p = document.createElement('p');
    p.textContent = 'Chargement…';
    p.style.cssText = 'margin:0;opacity:0.92;font-size:0.95em';
    wrap.appendChild(p);
  }

  function renderEvents(events) {
    var wrap = ensureContainer();
    wrap.innerHTML = '';
    var h = document.createElement('h3');
    h.textContent = 'Prochains RDV Meet';
    h.style.cssText = 'margin:0 0 12px;font-size:1.15em;font-weight:600';
    wrap.appendChild(h);
    if (!events.length) {
      var p = document.createElement('p');
      p.textContent = 'Aucun rendez-vous Meet à venir dans les ' + CFG.upcomingWindowDays + ' prochains jours.';
      p.style.cssText = 'margin:0 0 14px;opacity:0.92;font-size:0.95em';
      wrap.appendChild(p);
    } else {
      var ul = document.createElement('ul');
      ul.style.cssText = 'list-style:none;padding:0;margin:0 0 14px';
      events.forEach(function (e) {
        var li = document.createElement('li');
        li.style.cssText = 'padding:10px 12px;margin-bottom:6px;background:rgba(255,255,255,0.15);border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:10px';
        var left = document.createElement('div');
        var when = document.createElement('div');
        when.textContent = formatWhen(e.start);
        when.style.cssText = 'font-size:0.85em;opacity:0.85';
        var title = document.createElement('div');
        title.textContent = e.summary || '(sans titre)';
        title.style.cssText = 'font-weight:600';
        left.appendChild(when); left.appendChild(title);
        li.appendChild(left);
        if (e.meetUrl) {
          var btn = document.createElement('a');
          btn.href = e.meetUrl; btn.target = '_blank'; btn.rel = 'noopener';
          btn.textContent = 'Rejoindre';
          btn.style.cssText = 'padding:6px 12px;background:#fff;color:#FF7B24;text-decoration:none;border-radius:6px;font-size:0.85em;font-weight:600;flex-shrink:0';
          li.appendChild(btn);
        }
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
    }
    var link = document.createElement('a');
    link.href = CFG.calendarUiBase; link.target = '_blank'; link.rel = 'noopener';
    link.textContent = 'Ouvrir mon agenda';
    link.style.cssText = 'display:inline-block;padding:6px 14px;background:rgba(255,255,255,0.2);color:#fff;text-decoration:none;border-radius:6px;font-size:0.9em;font-weight:500';
    wrap.appendChild(link);
  }

  function renderFallback() {
    var wrap = ensureContainer();
    wrap.innerHTML = '';
    var h = document.createElement('h3');
    h.textContent = 'Prochains RDV Meet';
    h.style.cssText = 'margin:0 0 8px;font-size:1.15em;font-weight:600';
    var p = document.createElement('p');
    p.textContent = 'Retrouvez vos prochains rendez-vous avec un lien Meet dans votre agenda.';
    p.style.cssText = 'margin:0 0 14px;opacity:0.92;font-size:0.95em';
    var link = document.createElement('a');
    link.href = CFG.calendarUiBase; link.target = '_blank'; link.rel = 'noopener';
    link.textContent = 'Ouvrir mon agenda';
    link.style.cssText = 'display:inline-block;padding:8px 16px;background:#fff;color:#FF7B24;text-decoration:none;border-radius:6px;font-weight:600;font-size:0.95em';
    wrap.appendChild(h); wrap.appendChild(p); wrap.appendChild(link);
  }

  // ============================================================
  // boot
  // ============================================================
  function run() {
    // Do nothing on hosts that aren't our target (defensive when the
    // sub_filter is misconfigured somewhere).
    if (suffixIdx < 0) return;
    if (document.getElementById('visio-upcoming-meets')) return;

    renderLoading();
    getAccessToken()
      .then(fetchUpcomingMeetEvents)
      .then(renderEvents)
      .catch(function (err) {
        if (window.console && console.debug) console.debug('[visio-upcoming-meets] fallback:', err && err.message);
        renderFallback();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
  // Cozy Visio hydrates the DOM after initial parse; re-run once the
  // app has had a beat to mount so we don't insert before its own root
  // wipe.
  window.setTimeout(run, 500);
  window.setTimeout(run, 2000);
})();
