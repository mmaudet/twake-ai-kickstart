# visio-upcoming-meets — overlay pour Cozy Visio

Injecte un widget "Prochains RDV Meet" sur la page d'accueil de l'app
Cozy Visio (`*-visio.<BASE_DOMAIN>`), sans forker l'image amont
`cozy-visio` du registre Cozy.

## Fichiers

| Fichier | Rôle |
|---------|------|
| `widget.js` | Widget browser. Fait la danse OIDC silent + fetch des events + rendu. |
| `silent-callback.html` | Page statique chargée par l'iframe caché du widget pour le callback OIDC (postMessage vers le parent). |
| `hermes-nginx-patch.py` | Idempotent. Copie widget.js + silent-callback.html sur hermes, patche le vhost wildcard pour injecter le widget via `sub_filter`. |
| `register-llng-client.py` | Idempotent. Ajoute le client OIDC public `visio-widget` au template LemonLDAP-NG. |

## Architecture (v2 : silent OIDC + real events)

```
┌────────────────────────────────────────────────────────────────────┐
│ Browser (mmaudet-visio.twake-dev.maudet.cloud)                     │
│                                                                    │
│   Cozy Visio (registry) HTML — sub_filter injecte <script>         │
│   widget.js                                                        │
│      │                                                             │
│      │ 1. hidden iframe → /oauth2/authorize?prompt=none&PKCE       │
│      ▼                                                             │
│   auth.twake-dev.maudet.cloud (LLNG) — voit le cookie de session   │
│      │  du login Cozy initial → OK sans interaction                │
│      ▼                                                             │
│   /oauth-silent-callback (statique, servi par hermes)              │
│      │  postMessage({code, state}) → parent widget                 │
│      ▼                                                             │
│   widget.js échange code → access_token via POST /oauth2/token     │
│      │                                                             │
│      ▼                                                             │
│   tcalendar-side-service.twake-dev.maudet.cloud (bearer token)     │
│      /api/user               → { _id }                             │
│      /dav/calendars/<uid>.json                                     │
│      /dav/calendars/<uid>/<cid>/?start=…&end=…                     │
│      │                                                             │
│      ▼                                                             │
│   Filtre : URL/description contient `meet.twake-dev.maudet.cloud`  │
│      │                                                             │
│      ▼                                                             │
│   Rendu de la liste + bouton "Rejoindre" par event                 │
└────────────────────────────────────────────────────────────────────┘
```

## Pourquoi un overlay et pas un fork

L'app Cozy Visio est distribuée depuis le registre Cozy
(`registry://visio/stable`, actuellement `1.3.0`), rebuildée
régulièrement en amont. Un fork nous forcerait à rebaser à chaque
bump. L'overlay :

- ne modifie ni l'image ni le code amont
- reste actif après `cozy-stack apps update visio` (le
  `sub_filter` s'applique à la nouvelle version tant que la structure
  HTML garde une balise `</body>`, ce qui est toujours le cas)
- se retire trivialement en supprimant les fichiers hermes

Même pattern que [`bentopdf-app/infra/hermes-nginx-patch.py`](../../../apps/bentopdf/) — patcher
au niveau du reverse proxy.

## Déploiement

### 1. Ajouter le client OIDC `visio-widget` à LLNG (une fois)

```bash
# À jouer sur athena (où vit le template LLNG)
cd /path/to/twake-ai-kickstart
python3 cozy_apps_source/visio/infra/register-llng-client.py

# Régénérer + reload LLNG
cd twake_auth && ./compose-wrapper.sh render
docker restart lemonldap-ng
```

Le script enregistre les redirect URIs `<user>-visio.<BASE_DOMAIN>/oauth-silent-callback`
pour chaque user Cozy connu (variable `INSTANCES` en haut du script).
**Ré-exécuter** ce script quand tu ajoutes un nouveau user Cozy, sinon
l'OIDC rejettera son iframe silent-callback avec `invalid_redirect_uri`.

### 2. Déployer widget + callback + vhost patch sur hermes

```bash
# depuis le fork twake-ai-kickstart
INFRA=cozy_apps_source/visio/infra
scp $INFRA/{hermes-nginx-patch.py,widget.js,silent-callback.html} hermes:/tmp/

ssh hermes '
    sudo python3 /tmp/hermes-nginx-patch.py \
        --widget /tmp/widget.js \
        --silent-callback /tmp/silent-callback.html &&
    sudo nginx -t &&
    sudo nginx -s reload
'
```

### 3. Vérifs

```bash
curl -sk https://mmaudet-visio.twake-dev.maudet.cloud/visio-patches/widget.js | head -3
curl -sk https://mmaudet-visio.twake-dev.maudet.cloud/oauth-silent-callback   | head -3
curl -sk https://mmaudet-visio.twake-dev.maudet.cloud/                        | grep -o '<script src="/visio-patches/widget.js"[^>]*>'
# Le sub_filter ne doit PAS toucher les autres apps :
curl -sk https://mmaudet-drive.twake-dev.maudet.cloud/                        | grep -c '/visio-patches/widget.js'   # attendu : 0
```

Puis ouvrir `https://mmaudet-visio.twake-dev.maudet.cloud/` dans un
navigateur qui a une session LLNG active (i.e. tu es déjà logué sur
mmaudet-home) → un panneau orange "Prochains RDV Meet" apparaît en
haut avec la liste des RDV Meet à venir dans les 14 prochains jours.

Si la session LLNG est manquante ou expirée, l'iframe silent
`prompt=none` rejette avec `login_required`, le widget passe en mode
fallback (juste un bouton "Ouvrir mon agenda"). Silencieux côté user.

## Ré-application après un bump de version

L'overlay se réapplique **automatiquement** à chaque nouvelle version
servie par cozy-stack — le `sub_filter` opère sur le HTML sortant, pas
sur les assets versionés de l'app. Aucun step manuel après
`cozy-stack apps update visio ...`.

Ce n'est plus vrai si l'app amont change radicalement de structure
HTML (par exemple si elle abandonne le pattern `#app` + `</body>`
final). Dans ce cas, itérer sur `widget.js` sans toucher au
`hermes-nginx-patch.py`, puis rejouer le déploiement pour recopier
`widget.js` dans `/var/www/visio-patches/`.

## Retrait

```bash
ssh hermes '
    # Enlever les fichiers servis
    sudo rm -rf /var/www/visio-patches
    sudo rm -f /etc/nginx/conf.d/visio-inject.conf
    # Le vhost twake-dev est patché en place — la re-exécution du
    # hermes-nginx-patch.py `strip` les blocs marqués BEGIN/END avant
    # de re-injecter. Pour retirer proprement sans réinstaller, éditer
    # /etc/nginx/sites-enabled/twake-dev et supprimer les blocs entre
    # `# BEGIN visio-inject` et `# END visio-inject`.
    sudo nginx -t && sudo nginx -s reload
'
```

Côté LLNG, le client `visio-widget` peut être laissé en place (dormant)
ou retiré du template LemonLDAP en éditant
`twake_auth/config/lmConf-1.json.ldap.template` puis en régénérant.

## Limitations connues

- **Liste des users hardcodée** dans `register-llng-client.py` (variable
  `INSTANCES`). OAuth 2.0 exige un match exact du `redirect_uri`, donc
  chaque `<user>-visio.<BASE>` doit être listé. Ré-exécuter le script
  après avoir ajouté un user.
- **Pas de refresh** au-delà de l'access_token courant. Le widget cache
  le token en localStorage avec sa vraie expiration ; quand il expire,
  il refait un `prompt=none` (silent). Le refresh_token retourné par
  LLNG n'est actuellement pas utilisé (option d'amélioration : swap
  refresh → access sans re-passer par LLNG).
- **API events côté side-service**. Le widget appelle
  `/dav/calendars/<uid>/<calId>/?start=…&end=…` en supposant que
  side-service accepte cette shape. Si un rebuild récent de
  side-service change les endpoints, le widget fallback proprement au
  bouton "Ouvrir mon agenda". Debug via la console browser : chaque
  erreur est loggée en `console.debug`.
