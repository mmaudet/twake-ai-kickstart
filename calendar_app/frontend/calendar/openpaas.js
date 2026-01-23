window.openpaas = {
    AUTH_PROVIDER: 'oidc',
    OPENPAAS_API_URL: 'https://tcalendar-side-service.twake.local',
    BASE_URL: '',
    ACCOUNT_SPA_URL: 'https://account.twake.local/account/',
    MAILTO_SPA_URL:'https://mail.twake.local',
    APP_GRID_ITEMS: '[ { "name": "Contacts", "url": "https://contacts.twake.local/contacts/" }]',
    AUTH_PROVIDER_SETTINGS: {
        authority: 'https://auth.twake.local/',
        client_id: 'openpaas',
        redirect_uri: 'https://calendar.twake.local/calendar/auth/oidc/callback',
        silent_redirect_uri: 'https://calendar.twake.local/calendar/assets/auth/silent-renew.html',
        post_logout_redirect_uri: 'https://calendar.twake.local/calendar',
        response_type: 'code',
        scope: 'openid email profile'
    }
};




