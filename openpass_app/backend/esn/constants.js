module.exports = {
  MODULE_NAME: 'linagora.esn.oidc',
  CONFIG_KEY: 'oidc',
  STRATEGY_NAME: 'passport-oidc',

  DEFAULT_PASSPORT_CONFIG: {
    issuer_url: 'https://auth.twake.local',
    authorization_url: 'https://auth.twake.local/oauth2/authorize',
    token_url: 'https://auth.twake.local/oauth2/token',
    user_info_url: 'https://auth.twake.local/oauth2/userinfo',
    end_session_endpoint: 'https://auth.twake.local/oauth2/logout',
    client_id: 'openpaas',
    client_secret: 'openpaas'
  },

  PASSPORT_PARAMETERS: {
    // Default callback (can be overridden dynamically per component)
    callback_url: '/linagora.esn.oidc/callback',
    scope: 'openid profile email'
  },

  CALLBACK_URLS: {
    account: 'https://account-calendar.twake.local/account/auth/oidc/callback',
    admin: 'https://admin-calendar.twake.local/admin/auth/oidc/callback',
    calendar: 'https://calendar.twake.local/calendar/auth/oidc/callback',
    contacts: 'https://contact.twake.local/contacts/auth/oidc/callback'
  }
};
