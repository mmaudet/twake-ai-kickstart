#!/usr/bin/env python3
"""Add the `visio-widget` public OIDC client to the LLNG template.

Public + PKCE-required client used by the visio-upcoming-meets widget to
obtain an LLNG-audience access_token via silent authorization_code flow
(prompt=none). Callback runs from each user's `<user>-visio.<BASE>`
domain via a static /oauth-silent-callback page hermes serves out of
visio-app/infra/silent-callback.html.

The list of redirect URIs enumerates each Cozy instance's visio
subdomain — LLNG (and OAuth 2.0) require exact match on redirect_uri.
Re-run this script when you add a new Cozy user, or extend `INSTANCES`.
"""
import json, pathlib, re, subprocess, sys

TPL = pathlib.Path("/home/mmaudet/deploy/kickstart-maudet-cloud/twake_auth/config/lmConf-1.json.ldap.template")

# Cozy instances that have a corresponding <user>-visio.<BASE> subdomain.
# Pulled once from `cozy-stack instances ls`; refresh when adding new users.
INSTANCES = [
    "mmaudet", "bandre", "qvalmori", "dpotokina",
    "ptranvan", "xguimard", "alebaud",
    "user1", "user2", "user3",
]
BASE_DOMAIN_LITERAL = "twake-dev.maudet.cloud"  # kept explicit — matches the domain the visio hosts run on today

SILENT_CB_PATH = "/oauth-silent-callback"
REDIRECT_URIS = " ".join(
    f"https://{u}-visio.{BASE_DOMAIN_LITERAL}{SILENT_CB_PATH}" for u in INSTANCES
)
POST_LOGOUT_URIS = " ".join(
    f"https://{u}-visio.{BASE_DOMAIN_LITERAL}/" for u in INSTANCES
)

CLIENT_ALIAS = "visio-widget"
EXPORTED_VARS = {"email": "mail", "name": "cn", "preferred_username": "uid", "user_name": "uid"}


def build_client_entry():
    return {
        "oidcRPMetaDataOptionsAccessTokenClaims": 1,
        "oidcRPMetaDataOptionsAdditionalAudiences": "openpaas",  # tcalendar-side-service expects aud=openpaas
        "oidcRPMetaDataOptionsAccessTokenJWT": 1,
        "oidcRPMetaDataOptionsAccessTokenSignAlg": "RS256",
        "oidcRPMetaDataOptionsAllowClientCredentialsGrant": 0,
        "oidcRPMetaDataOptionsAllowOffline": 1,           # refresh_token allowed → widget keeps a session
        "oidcRPMetaDataOptionsAllowPasswordGrant": 0,
        "oidcRPMetaDataOptionsAuthRequiredForAuthorize": 0,
        "oidcRPMetaDataOptionsAuthnRequireNonce": 1,
        "oidcRPMetaDataOptionsAuthnRequireState": 1,
        "oidcRPMetaDataOptionsBypassConsent": 1,           # silent flow, no user prompt
        "oidcRPMetaDataOptionsClientID": CLIENT_ALIAS,
        "oidcRPMetaDataOptionsClientSecret": "",           # public client
        "oidcRPMetaDataOptionsIDTokenForceClaims": 1,
        "oidcRPMetaDataOptionsIDTokenSignAlg": "RS256",
        "oidcRPMetaDataOptionsLogoutBypassConfirm": 1,
        "oidcRPMetaDataOptionsLogoutSessionRequired": 1,
        "oidcRPMetaDataOptionsLogoutType": "front",
        "oidcRPMetaDataOptionsPostLogoutRedirectUris": POST_LOGOUT_URIS,
        "oidcRPMetaDataOptionsPublic": 1,                  # public client (no secret)
        "oidcRPMetaDataOptionsRedirectUris": REDIRECT_URIS,
        "oidcRPMetaDataOptionsRefreshToken": 1,
        "oidcRPMetaDataOptionsRefreshTokenRotation": 1,
        "oidcRPMetaDataOptionsRequirePKCE": 1,             # public client MUST use PKCE
        "oidcRPMetaDataOptionsUserinfoRequireHeaderToken": 0,
    }


def main():
    raw = TPL.read_text()
    SEN1, SEN2 = "___BD___", "___LB___"
    parsed = json.loads(raw.replace("${BASE_DOMAIN}", SEN1).replace("${LDAP_BASE_DN}", SEN2))

    parsed.setdefault("oidcRPMetaDataOptions", {})[CLIENT_ALIAS] = build_client_entry()
    parsed.setdefault("oidcRPMetaDataExportedVars", {})[CLIENT_ALIAS] = dict(EXPORTED_VARS)
    parsed.setdefault("oidcRPMetaDataOptionsExtraClaims", {})[CLIENT_ALIAS] = {}
    parsed.setdefault("oidcRPMetaDataMacros", {})[CLIENT_ALIAS] = {}
    parsed.setdefault("oidcRPMetaDataScopeRules", {})[CLIENT_ALIAS] = {}
    parsed["cfgNum"] = int(parsed["cfgNum"]) + 1

    out = json.dumps(parsed, indent=3, ensure_ascii=False, sort_keys=True)
    out = out.replace(SEN1, "${BASE_DOMAIN}").replace(SEN2, "${LDAP_BASE_DN}")
    TPL.write_text(out + "\n")
    print(f"cfgNum bumped to {parsed['cfgNum']}")
    print(f"clients: {sorted(parsed['oidcRPMetaDataOptions'].keys())}")
    print(f"redirect_uris registered: {REDIRECT_URIS.count('https://')} URIs")


if __name__ == "__main__":
    main()
