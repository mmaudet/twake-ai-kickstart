# visio-upcoming-meets — overlay pour Cozy Visio

Injecte un widget "Prochains RDV Meet" sur la page d'accueil de l'app
Cozy Visio (`*-visio.<BASE_DOMAIN>`), sans forker l'image amont
`cozy-visio` du registre Cozy.

## Pourquoi un overlay et pas un fork

L'app Cozy Visio est distribuée depuis le registre Cozy
(`registry://visio/stable`, actuellement `1.3.0`), rebuildée
régulièrement en amont. Un fork nous forcerait à rebaser à chaque
bump. L'overlay :

- ne modifie ni l'image ni le code amont
- reste actif après `cozy-stack apps update visio` (le
  `sub_filter` s'applique à la nouvelle version tant que la structure
  HTML garde une balise `</body>`, ce qui est toujours le cas)
- se retire trivialement en supprimant le vhost hermes

Même pattern que [`bentopdf-app/infra/hermes-nginx-patch.py`](../../../apps/bentopdf/) — patcher
au niveau du reverse proxy.

## Mécanique

1. `hermes-nginx-patch.py` (à jouer sur hermes en `root`) :
   - Crée `/etc/nginx/sites-available/twake-visio`, un vhost dédié
     dont le `server_name ~^([^.]+)-visio\.twake-dev\.maudet\.cloud$`
     capture toutes les instances Cozy (`mmaudet-visio.*`,
     `bandre-visio.*`, …). Ce vhost proxy vers Traefik sur athena
     comme la wildcard existante, mais ajoute un `sub_filter` nginx
     qui insère `<script src="/visio-patches/widget.js" defer>` juste
     avant `</body>` dans chaque réponse `text/html`.
   - Sert `widget.js` en local depuis `/var/www/visio-patches/`.
2. Le widget côté browser (`widget.js`) :
   - Insère en haut du `#app` de Cozy Visio un panneau orange
     "Prochains RDV Meet" avec un bouton d'ouverture de l'agenda.
   - **v1 (état actuel)** : le panneau se contente de linker vers
     `calendar-ng.<BASE_DOMAIN>`. Objectif : valider la mécanique
     d'injection, sans traiter le cross-origin OIDC.
   - **v2 (TODO)** : lister *inline* les RDV à venir dont l'URL
     contient `meet.<BASE_DOMAIN>`. Trois pistes documentées dans le
     header de `widget.js` (silent OIDC, `io.cozy.events` doctype,
     proxy cozy-stack).

## Déploiement

```bash
# depuis le fork twake-ai-kickstart
scp cozy_apps_source/visio/infra/hermes-nginx-patch.py \
    cozy_apps_source/visio/infra/widget.js \
    hermes:/tmp/

ssh hermes '
    sudo python3 /tmp/hermes-nginx-patch.py --widget /tmp/widget.js &&
    sudo nginx -t &&
    sudo nginx -s reload
'
```

Vérif :

```bash
curl -sk https://mmaudet-visio.twake-dev.maudet.cloud/visio-patches/widget.js | head -3
curl -sk https://mmaudet-visio.twake-dev.maudet.cloud/ | grep -o '<script src="/visio-patches/widget.js"[^>]*>'
```

Puis ouvrir `https://mmaudet-visio.twake-dev.maudet.cloud/` dans un
navigateur → un panneau orange "Prochains RDV Meet" apparaît en haut de
la page d'accueil.

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
    sudo rm -f /etc/nginx/sites-enabled/twake-visio \
              /etc/nginx/sites-available/twake-visio
    sudo rm -rf /var/www/visio-patches
    sudo nginx -t && sudo nginx -s reload
'
```

La wildcard `*.twake-dev.maudet.cloud` reprend la main sur
`mmaudet-visio.*` et l'app redevient exactement celle du registre
Cozy, sans overlay.
