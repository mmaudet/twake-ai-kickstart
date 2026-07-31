/*
 * visio-upcoming-meets widget — v3 (mini calendar + live countdown + LED)
 * -----------------------------------------------------------------------
 * Injected into Cozy Visio (`*-visio.<BASE_DOMAIN>`) by hermes sub_filter.
 * Fetches upcoming meet events from tcalendar-side-service via silent
 * OIDC + CalDAV REPORT, renders a compact list with:
 *
 *   - a live countdown ("commence dans 2h 15" / "dans 12 min") for
 *     upcoming events;
 *   - a blinking red LED + "en cours" label while now is inside an
 *     event's [start,end] window;
 *   - a time window of [now - 1h, now + 24h] — one hour of grace so a
 *     currently-running meeting keeps showing until it ends.
 *
 * Fallback contract: any error → hide the widget entirely so the visio
 * home never looks broken. When we cannot obtain a token silently (LLNG
 * session missing, network error, side-service down) the widget shows a
 * "Ouvrir mon agenda" link.
 */
(function () {
  'use strict';

  var CFG = {
    clientId: 'visio-widget',
    scope: 'openid profile email',
    llngIssuer: null,           // computed below
    sideServiceBase: null,      // computed below
    calendarUiBase: null,       // computed below
    meetHostPattern: null,      // computed below
    silentCallbackPath: '/oauth-silent-callback',
    windowPastMinutes: 60,      // include events that started up to N min ago (still-running detection)
    windowFutureMinutes: 24 * 60, // include events starting in the next N min
    maxEventsToShow: 5,
    tickIntervalMs: 1000,        // rerender countdown labels every second (shows seconds)
    refetchIntervalMs: 60 * 1000, // refetch events every N ms — pick up newly-created events within a minute
  };

  var hostname = window.location.hostname;
  var suffixIdx = hostname.indexOf('-visio.');
  if (suffixIdx < 0) return;   // safety: not on a *-visio host
  var BASE_DOMAIN = hostname.substring(suffixIdx + '-visio.'.length);
  CFG.llngIssuer = 'https://auth.' + BASE_DOMAIN;
  CFG.sideServiceBase = 'https://tcalendar-side-service.' + BASE_DOMAIN;
  CFG.calendarUiBase = 'https://calendar-ng.' + BASE_DOMAIN + '/';
  CFG.meetHostPattern = new RegExp('meet\\.' + BASE_DOMAIN.replace(/\./g, '\\.'), 'i');

  var STORAGE_KEY = 'visio-widget-oidc';

  // ============================================================
  // PKCE helpers
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
      if (obj.exp && obj.exp < Date.now() / 1000 + 30) return null;
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
    } catch (_e) {}
  }

  function getAccessToken() {
    var cached = getCachedToken();
    if (cached) return Promise.resolve(cached.access_token);
    return silentAuthorize().then(function (t) { cacheToken(t); return t.access_token; });
  }

  // ============================================================
  // side-service — user + events
  // ============================================================
  function apiGet(path, token) {
    return fetch(CFG.sideServiceBase + path, {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
    }).then(function (r) {
      if (r.status === 401) {
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        throw new Error('api ' + path + ': 401 (cache cleared, will retry)');
      }
      if (!r.ok) throw new Error('api ' + path + ': ' + r.status);
      return r.json();
    });
  }

  function fetchUpcomingMeetEvents(token) {
    return apiGet('/api/user', token).then(function (user) {
      var uid = user && user._id;
      if (!uid) throw new Error('api: no user id');
      return apiGet('/dav/calendars/' + uid + '.json?personal=true', token).then(function (home) {
        var calendars = ((home && home._embedded && home._embedded['dav:calendar']) || []);
        if (!calendars.length) return [];
        var now = new Date();
        var start = new Date(now.getTime() - CFG.windowPastMinutes * 60000);
        var end = new Date(now.getTime() + CFG.windowFutureMinutes * 60000);
        var reportBody = buildCalendarQuery(caldavTime(start), caldavTime(end));
        var fetches = calendars.map(function (cal) {
          var self = cal && cal._links && cal._links.self && cal._links.self.href;
          if (!self) return Promise.resolve([]);
          var relPath = self.charAt(0) === '/' ? self : '/' + self;
          if (relPath.indexOf('/dav/') !== 0) relPath = '/dav' + relPath;
          relPath = relPath.replace(/\.json$/, '');
          return caldavReport(relPath, reportBody, token).catch(function () { return []; });
        });
        return Promise.all(fetches).then(function (perCal) {
          var all = [];
          perCal.forEach(function (arr) { if (Array.isArray(arr)) arr.forEach(function (e) { all.push(e); }); });
          return all;
        });
      });
    }).then(function (events) {
      var nowMs = Date.now();
      var horizonPast = nowMs - CFG.windowPastMinutes * 60000;
      var horizonFuture = nowMs + CFG.windowFutureMinutes * 60000;
      return events
        .map(parseEvent)
        .filter(function (e) {
          // keep if: hasMeet AND event.end > horizonPast (not fully over) AND event.start < horizonFuture
          if (!e || !e.hasMeet) return false;
          return e.end.getTime() > horizonPast && e.start.getTime() < horizonFuture;
        })
        .sort(function (a, b) { return a.start - b.start; })
        .slice(0, CFG.maxEventsToShow);
    });
  }

  function caldavTime(d) {
    var s = d.toISOString();
    return s.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  function buildCalendarQuery(startZ, endZ) {
    return '<?xml version="1.0" encoding="utf-8" ?>' +
      '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
      '<d:prop><d:getetag/><c:calendar-data/></d:prop>' +
      '<c:filter><c:comp-filter name="VCALENDAR">' +
      '<c:comp-filter name="VEVENT">' +
      '<c:time-range start="' + startZ + '" end="' + endZ + '"/>' +
      '</c:comp-filter></c:comp-filter></c:filter>' +
      '</c:calendar-query>';
  }

  function caldavReport(path, body, token) {
    return fetch(CFG.sideServiceBase + path, {
      method: 'REPORT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1',
      },
      body: body,
    }).then(function (r) {
      if (r.status === 401) {
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        throw new Error('REPORT ' + path + ': 401 (cache cleared, will retry)');
      }
      if (!r.ok) throw new Error('REPORT ' + path + ': ' + r.status);
      return r.text();
    }).then(parseMultistatus);
  }

  function parseMultistatus(xml) {
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return [];
    var els = doc.getElementsByTagNameNS('urn:ietf:params:xml:ns:caldav', 'calendar-data');
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var ics = els[i].textContent || '';
      if (ics.trim()) out.push({ ics: ics });
    }
    return out;
  }

  function parseEvent(raw) {
    // Extract SUMMARY, DTSTART, DTEND, URL, DESCRIPTION, X-OPENPAAS-VIDEOCONFERENCE
    // from a jCal-like ICS. Meet URL lives in X-OPENPAAS-VIDEOCONFERENCE
    // in the Twake stack.
    try {
      var ics = raw && raw.ics ? raw.ics : '';
      if (!ics) return null;
      // Unfold RFC 5545 continuations
      ics = ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
      var lines = ics.split(/\r?\n/);
      var inEvent = false;
      var summary = '', dtstart = null, dtend = null, url = '', description = '', videoconf = '';
      var duration = null;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line === 'BEGIN:VEVENT') { inEvent = true; continue; }
        if (line === 'END:VEVENT') break;
        if (!inEvent) continue;
        var colon = line.indexOf(':');
        if (colon < 0) continue;
        var head = line.substring(0, colon);
        var value = line.substring(colon + 1);
        var name = head.split(';')[0].toUpperCase();
        if (name === 'SUMMARY') summary = unescapeICSText(value);
        else if (name === 'DTSTART') dtstart = parseICSDate(value);
        else if (name === 'DTEND') dtend = parseICSDate(value);
        else if (name === 'DURATION') duration = parseICSDuration(value);
        else if (name === 'URL') url = value;
        else if (name === 'DESCRIPTION') description = unescapeICSText(value);
        else if (name === 'X-OPENPAAS-VIDEOCONFERENCE') videoconf = value;
      }
      if (!dtstart) return null;
      if (!dtend) {
        dtend = duration
          ? new Date(dtstart.getTime() + duration)
          : new Date(dtstart.getTime() + 3600000); // fallback: 1h
      }
      var haystack = videoconf + '\n' + url + '\n' + description;
      var hasMeet = CFG.meetHostPattern.test(haystack);
      var meetUrl = null;
      if (hasMeet) {
        var m = haystack.match(new RegExp('https?://[^\\s"<]*meet\\.' + BASE_DOMAIN.replace(/\./g, '\\.') + '[^\\s"<]*', 'i'));
        if (m) meetUrl = m[0];
      }
      return { summary: summary, start: dtstart, end: dtend, meetUrl: meetUrl, hasMeet: hasMeet };
    } catch (_e) { return null; }
  }

  function unescapeICSText(s) {
    return String(s || '').replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  }

  function parseICSDate(v) {
    try {
      var s = String(v || '');
      if (/^\d{8}$/.test(s)) {
        return new Date(s.substring(0,4) + '-' + s.substring(4,6) + '-' + s.substring(6,8) + 'T00:00:00Z');
      }
      var m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
      if (m) {
        return new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + (m[7] || ''));
      }
      return new Date(s);
    } catch (_e) { return null; }
  }

  // ICS duration like "PT1H30M" → milliseconds.
  function parseICSDuration(v) {
    try {
      var m = String(v || '').match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
      if (!m) return null;
      var days = parseInt(m[1] || '0', 10);
      var hours = parseInt(m[2] || '0', 10);
      var mins = parseInt(m[3] || '0', 10);
      var secs = parseInt(m[4] || '0', 10);
      return (((days * 24 + hours) * 60 + mins) * 60 + secs) * 1000;
    } catch (_e) { return null; }
  }

  // ============================================================
  // rendering (mini calendar + live status)
  // ============================================================
  function ensureStyles() {
    if (document.getElementById('visio-upcoming-meets-styles')) return;
    var st = document.createElement('style');
    st.id = 'visio-upcoming-meets-styles';
    st.textContent = [
      '#visio-upcoming-meets{',
      '  margin:24px auto;max-width:720px;padding:18px 20px;',
      '  background:linear-gradient(135deg,#FF7B24 0%,#FFA92E 100%);color:#fff;',
      '  border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);',
      '  font-family:system-ui,-apple-system,sans-serif;',
      '}',
      '#visio-upcoming-meets h3{margin:0 0 12px;font-size:1.05em;font-weight:600;letter-spacing:.02em;text-transform:uppercase;opacity:.95}',
      '#visio-upcoming-meets ul{list-style:none;padding:0;margin:0 0 12px;display:flex;flex-direction:column;gap:6px}',
      '#visio-upcoming-meets li{',
      '  padding:10px 12px;background:rgba(255,255,255,.15);border-radius:8px;',
      '  display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;',
      '}',
      '#visio-upcoming-meets .vum-time{font-variant-numeric:tabular-nums;font-weight:600;font-size:1.05em;min-width:3.5em}',
      '#visio-upcoming-meets .vum-title{font-weight:600;line-height:1.2}',
      '#visio-upcoming-meets .vum-status{display:block;font-size:.78em;opacity:.85;margin-top:2px;font-weight:400}',
      '#visio-upcoming-meets a.vum-join{',
      '  padding:6px 12px;background:#fff;color:#FF7B24;text-decoration:none;',
      '  border-radius:6px;font-size:.85em;font-weight:600;',
      '}',
      '#visio-upcoming-meets a.vum-agenda{',
      '  display:inline-block;padding:6px 12px;background:rgba(255,255,255,.2);',
      '  color:#fff;text-decoration:none;border-radius:6px;font-size:.85em;font-weight:500;',
      '}',
      '#visio-upcoming-meets .vum-live{color:#fff;display:inline-flex;align-items:center;gap:6px}',
      '#visio-upcoming-meets .vum-led{',
      '  display:inline-block;width:9px;height:9px;border-radius:50%;background:#ff3b3b;',
      '  box-shadow:0 0 6px #ff3b3b;animation:vumBlink 1.2s ease-in-out infinite;',
      '}',
      '@keyframes vumBlink{0%,100%{opacity:.35}50%{opacity:1}}',
    ].join('');
    document.head.appendChild(st);
  }

  function ensureContainer() {
    ensureStyles();
    var app = document.getElementById('app') || document.body;
    var existing = document.getElementById('visio-upcoming-meets');
    if (existing) return existing;
    var wrap = document.createElement('div');
    wrap.id = 'visio-upcoming-meets';
    app.insertBefore(wrap, app.firstChild);
    return wrap;
  }

  function renderLoading() {
    var wrap = ensureContainer();
    wrap.innerHTML = '<h3>Prochains RDV Meet</h3><p style="margin:0;opacity:.9">Chargement…</p>';
  }

  function fmtHm(dt) {
    try {
      return dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch (_e) { return dt.toTimeString().substring(0, 5); }
  }

  function fmtDayLabel(dt) {
    var now = new Date();
    var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var eventDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
    var dayDiff = Math.round((eventDay - startOfToday) / 86400000);
    if (dayDiff === 0) return "aujourd'hui";
    if (dayDiff === 1) return 'demain';
    try {
      return dt.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    } catch (_e) { return dt.toDateString(); }
  }

  // countdown / status label based on the current wall clock.
  // Always shows seconds so the tick is visibly alive; label goes
  // "2h 15m 34s" → "15m 34s" → "34s".
  function statusFor(event) {
    var now = Date.now();
    var start = event.start.getTime();
    var end = event.end.getTime();
    if (now >= start && now < end) return { kind: 'live', label: 'en cours' };
    if (now >= end) return { kind: 'done', label: 'terminé' };
    var msTo = start - now;
    var totalSec = Math.max(0, Math.floor(msTo / 1000));
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var parts = [];
    if (h > 0) parts.push(h + 'h');
    if (h > 0 || m > 0) parts.push((h > 0 ? String(m).padStart(2, '0') : m) + 'm');
    parts.push((m > 0 || h > 0 ? String(s).padStart(2, '0') : s) + 's');
    var label = 'dans ' + parts.join(' ');
    // beyond today → also mention the day
    var eventDay = new Date(event.start.getFullYear(), event.start.getMonth(), event.start.getDate()).getTime();
    var startOfToday = new Date().setHours(0, 0, 0, 0);
    if (eventDay > startOfToday) label += ' (' + fmtDayLabel(event.start) + ')';
    return { kind: 'upcoming', label: label };
  }

  function renderEvents(events) {
    var wrap = ensureContainer();
    wrap.innerHTML = '';
    var h = document.createElement('h3');
    h.textContent = 'Prochains RDV Meet';
    wrap.appendChild(h);

    if (!events.length) {
      var p = document.createElement('p');
      p.textContent = 'Aucun rendez-vous Meet dans les 24 prochaines heures.';
      p.style.cssText = 'margin:0 0 12px;opacity:.9;font-size:.95em';
      wrap.appendChild(p);
    } else {
      var ul = document.createElement('ul');
      events.forEach(function (e) {
        var li = document.createElement('li');
        li.setAttribute('data-vum-eventid', String(e.start.getTime()));
        li.setAttribute('data-vum-start', String(e.start.getTime()));
        li.setAttribute('data-vum-end', String(e.end.getTime()));

        var when = document.createElement('div');
        when.className = 'vum-time';
        when.textContent = fmtHm(e.start);
        li.appendChild(when);

        var mid = document.createElement('div');
        var title = document.createElement('div');
        title.className = 'vum-title';
        title.textContent = e.summary || '(sans titre)';
        var status = document.createElement('span');
        status.className = 'vum-status';
        mid.appendChild(title); mid.appendChild(status);
        li.appendChild(mid);

        if (e.meetUrl) {
          var btn = document.createElement('a');
          btn.className = 'vum-join';
          btn.href = e.meetUrl; btn.target = '_blank'; btn.rel = 'noopener';
          btn.textContent = 'Rejoindre';
          li.appendChild(btn);
        }
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
    }

    var link = document.createElement('a');
    link.className = 'vum-agenda';
    link.href = CFG.calendarUiBase; link.target = '_blank'; link.rel = 'noopener';
    link.textContent = 'Ouvrir mon agenda';
    wrap.appendChild(link);

    tickStatuses();
  }

  function tickStatuses() {
    var wrap = document.getElementById('visio-upcoming-meets');
    if (!wrap) return;
    var lis = wrap.querySelectorAll('li[data-vum-eventid]');
    var toRemove = [];
    for (var i = 0; i < lis.length; i++) {
      var li = lis[i];
      var start = parseInt(li.getAttribute('data-vum-start'), 10);
      var end = parseInt(li.getAttribute('data-vum-end'), 10);
      var st = statusFor({ start: new Date(start), end: new Date(end) });
      if (st.kind === 'done') { toRemove.push(li); continue; }
      var statusEl = li.querySelector('.vum-status');
      if (!statusEl) continue;
      if (st.kind === 'live') {
        statusEl.innerHTML = '';
        var wrapLive = document.createElement('span'); wrapLive.className = 'vum-live';
        var led = document.createElement('span'); led.className = 'vum-led';
        wrapLive.appendChild(led);
        wrapLive.appendChild(document.createTextNode(' en cours'));
        statusEl.appendChild(wrapLive);
      } else {
        statusEl.textContent = st.label;
      }
    }
    toRemove.forEach(function (li) { li.parentNode && li.parentNode.removeChild(li); });
    // if list became empty, replace with empty-state text
    var ul = wrap.querySelector('ul');
    if (ul && !ul.querySelector('li')) {
      var p = document.createElement('p');
      p.textContent = 'Aucun rendez-vous Meet dans les 24 prochaines heures.';
      p.style.cssText = 'margin:0 0 12px;opacity:.9;font-size:.95em';
      ul.parentNode.replaceChild(p, ul);
    }
  }

  function renderFallback() {
    var wrap = ensureContainer();
    wrap.innerHTML = '';
    var h = document.createElement('h3');
    h.textContent = 'Prochains RDV Meet';
    var p = document.createElement('p');
    p.textContent = 'Retrouvez vos prochains rendez-vous avec un lien Meet dans votre agenda.';
    p.style.cssText = 'margin:0 0 12px;opacity:.9;font-size:.95em';
    var link = document.createElement('a');
    link.className = 'vum-agenda';
    link.href = CFG.calendarUiBase; link.target = '_blank'; link.rel = 'noopener';
    link.textContent = 'Ouvrir mon agenda';
    wrap.appendChild(h); wrap.appendChild(p); wrap.appendChild(link);
  }

  // ============================================================
  // boot & loops
  // ============================================================
  var runInProgress = false;
  var lastResult = null;
  var tickTimer = null;
  var refetchTimer = null;

  function run(opts) {
    if (suffixIdx < 0) return;
    if (runInProgress) return;
    if (lastResult === 'success' && !(opts && opts.force)) return;

    runInProgress = true;
    renderLoading();
    getAccessToken()
      .then(fetchUpcomingMeetEvents)
      .then(function (events) {
        renderEvents(events);
        lastResult = 'success';
        // start periodic loops on first success
        if (!tickTimer) tickTimer = setInterval(tickStatuses, CFG.tickIntervalMs);
        if (!refetchTimer) refetchTimer = setInterval(function () {
          getAccessToken().then(fetchUpcomingMeetEvents).then(renderEvents).catch(function () {});
        }, CFG.refetchIntervalMs);
      })
      .catch(function (err) {
        if (window.console && console.debug) console.debug('[visio-upcoming-meets] fallback:', err && err.message);
        renderFallback();
        lastResult = 'fallback';
      })
      .then(function () { runInProgress = false; });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
  window.setTimeout(run, 500);
  window.setTimeout(run, 2000);
})();
