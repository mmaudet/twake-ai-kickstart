window.openpaas = {
  AUTH_PROVIDER: 'oidc',  // OIDC via LemonLDAP NG
  OPENPAAS_API_URL: 'https://esn.twake.local', // backend ESN API
  BASE_URL: '', // optional
  ACCOUNT_SPA_URL: 'https://account-calendar.twake.local/account/', // frontend container
  APP_GRID_ITEMS: '[  { "name": "Contacts", "url": "https://contact.twake.local/contacts/" }]',
  AUTH_PROVIDER_SETTINGS: {
    authority: 'https://auth.twake.local',  // LemonLDAP host
    client_id: 'openpaas',                       // OIDC client configured in LemonLDAP
    client_secret: 'openpaas',
    redirect_uri: 'https://contact.twake.local/contacts/auth/oidc/callback',
    silent_redirect_uri: 'https://contact.twake.local/contacts/assets/auth/silent-renew.html',
    post_logout_redirect_uri: 'https://contact.twake.local/contacts',
    response_type: 'code',
    scope: 'openid email profile'
  }
};


