# Environment Lease protocol · v1

Base : `/v1`. Transport HTTP local. Pour chaque requête authentifiée : `Authorization: Bearer <clé API>`. Une clé correspond à une identité configurée par l’opérateur dans `ENV_API_KEYS`. Un champ `owner` soumis par le client n’est pas accepté.

| Méthode | Chemin | Corps | Résultat |
|---|---|---|---|
| GET | `/health` | — | Santé du processus, sans authentification |
| GET | `/v1/capabilities` | — | Providers activés et isolation annoncée |
| POST | `/v1/leases` | `{"kind":"browser","ttl":300}` | 201, métadonnées et `lease_token` |
| GET | `/v1/leases/{id}` | — | État du lease |
| POST | `/v1/leases/{id}/actions` | `{"action":"observe","args":{}}` | Résultat du provider |
| POST | `/v1/leases/{id}/renew` | `{"ttl":300}` | Nouveau délai à compter de maintenant |
| DELETE | `/v1/leases/{id}` | — | État après libération ; idempotent |
| POST | `/v1/leases/{id}/viewer` | — | Ouvre l’observation scrcpy sur l’hôte si l’opérateur l’a activée |
| DELETE | `/v1/leases/{id}/viewer` | — | Arrête et attend le viewer associé |
| POST | `/v1/jobs` | `{"device_id":"phone-01","ttl":300,"steps":[{"action":"key","args":{"key":"HOME"}}]}` | 202, ID et `job_token` retourné une fois |
| GET | `/v1/jobs/{id}` | — | Progression autorisée avec `X-Job-Token` |
| POST | `/v1/jobs/{id}/cancel` | — | Demande une annulation idempotente et son nettoyage |

Les routes par ID exigent aussi `X-Lease-Token: <token du lease>`. Un token volé ne suffit pas sans la clé du propriétaire. La réponse ne réémet jamais le token après création. Identifiant inexistant, autre propriétaire ou token incorrect : même réponse 404.

TTL entre 1 et 3600 secondes. L’expiration est contrôlée par une horloge monotone ; `expires_at` est un timestamp Unix de présentation. Le balayage des expirations s’exécute toutes les 500 ms. Une requête contrôle aussi l’expiration avant d’agir. Une action est limitée au plus petit de 20 secondes et de la durée restante. Deux actions du même lease sont sérialisées. Acquisitions sérialisées, capacité globale de quatre leases par défaut, téléphone exclusif.

```text
acquire → active ──renew──→ active
             │
             ├── release / expiry → closing → released / expired
             │                        └────→ cleanup_failed → nouvelle tentative
             └── action (vérification identité, jeton et TTL)
```

Un échec de nettoyage met la ressource en quarantaine et continue de consommer une place. Un timeout ou crash de worker pendant une mutation peut laisser le résultat distant inconnu; cette quarantaine est conservée dans un fichier privé et exige un contrôle opérateur puis `strowger reconcile --device-id ID --confirm-inspected`. La réconciliation ne défait pas l’action. Aucun renouvellement ni action après expiration/libération. Les tombstones sont conservées environ une heure après l’échéance initialement programmée. Un token d’un tombstone supprimé reste invalide.

Erreurs : 401 authentification, 404 identité/lease, 409 capacité, 410 lease inactif, 422 validation, 501 provider non configuré, 502 action échouée/timeout, 503 démarrage/nettoyage échoué. La santé du processus ne garantit pas que Docker, Chromium ou ADB soient disponibles.

Actions navigateur : `navigate(url)`, `observe()`, `click(selector)`, `fill(selector,text)`, `screenshot()`, `tap(x,y)`, `type(text)`, `key(key)`, `scroll(delta_y)`. Touches autorisées : Enter, Tab, Escape, Backspace et les quatre flèches ; défilement de -4000 à 4000 pixels. Les URL doivent être HTTP(S) ; ce filtre ne bloque pas les réseaux locaux, redirections et sous-ressources. Ce runtime local n’a pas de filtre egress.

Actions desktop : `observe`/`screenshot`, `tap(x,y)`, `type(text)` (2000 caractères max), `key(key)` (Return, Tab, Escape, BackSpace). Actions Android : `observe`/`screenshot`, `tap(x,y)`, `key(key)` (HOME, BACK, ENTER), `swipe(x1,y1,x2,y2,duration_ms=350)`, `type(text)`, `open_app(package)`. Le swipe dure de 50 à 2000 ms ; coordonnées entières de 0 à 10000. Saisie ADB : ASCII imprimable, sans `%`, 2000 caractères maximum. Le texte est échappé avant la frontière du shell Android. Le package doit être un nom Android valide, sans commande libre.

Avec l’extra optionnel `uiautomator2==3.7.0`, les Android inscrits avec `automation=uiautomator2` exposent aussi `hierarchy`, `ui_click`, `ui_exists` et `ui_set_text`. Un sélecteur est un objet limité à `resourceId`, `text`, `description`, `className`, `packageName`, `clickable`, `enabled` et `instance`; XPath et méthodes libres sont refusés. L’XML est borné à 256 KiB et signale toute troncature. Les jobs n’acceptent que les actions Android. La queue en mémoire est limitée à 64 jobs au total et 16 par propriétaire par défaut; chaque job tient un seul appareil et attend au plus 60 s une place disponible.

Le viewer scrcpy est facultatif (`ENV_SCRCPY_ENABLED=1`), lecture seule et local à l’hôte. Aucune image en direct ou URL de streaming n’est renvoyée au navigateur. La fermeture de la fenêtre arrête l’observation; la lease reste active jusqu’à sa libération ou expiration.

Les captures PNG sont retournées en `png_base64`. Le texte navigateur est tronqué à 20 000 caractères. Les screenshots et le texte sont renvoyés au client mais ne sont pas enregistrés dans le journal d’audit. Ce journal garde uniquement date, propriétaire, ID, type, opération et résultat. L’opérateur doit gérer sa rétention/rotation.

## Ajouter un provider

Définir `actions`, puis trois méthodes asynchrones : `start()`, `act(action,args)` et `close()`. `close` doit être idempotente. `start` doit nettoyer ses ressources partielles en cas d’échec. Le broker contrôle le cycle de vie, le provider contrôle son environnement. Ajouter l’activation explicite et un test réel de provisionnement, action et nettoyage.

Pour une intégration GETA/STROWGER, provisionner une clé distincte par agent, créer un `Runtime` avec cette clé, puis utiliser les context managers. Le choix du provider appartient à l’orchestrateur ; aucune boucle LLM n’est intégrée dans ce broker.


## Flotte Android physique

L'acquisition téléphone accepte le champ facultatif `device_id`, identifiant public configuré par l'opérateur, jamais un serial arbitraire. La réponse et l'inspection incluent `device_id` (null pour browser/desktop). Le SDK expose `runtime.phone.acquire(ttl=120, device_id="phone-01")`.

`GET /v1/devices` exige une clé Bearer et ne liste que les appareils autorisés : `{"devices":[{"id":"phone-01","kind":"phone","state":"available"}]}`. Le SDK fournit `runtime.devices()`. Ni serial USB, ni token, ni identité d'un autre propriétaire ne sont retournés. Voir [les états, la configuration et les limites](PHYSICAL_FLEET.md).

## Configuration du pilote 0.2

`ENV_CAPACITY` configure de 1 à 64 places (défaut 4). `strowger init --capacity 6` prépare six places pour le banc local. `ENV_ANDROID_DEVICES_FILE` désigne un inventaire JSON privé lu au démarrage. Priorité : argument `devices` explicite, puis `ENV_ANDROID_DEVICES` si présent, puis le fichier, puis le serial legacy. Une liste explicitement vide désactive les téléphones, sans réactiver le serial legacy. Les changements d’inventaire demandent un redémarrage du broker.

## Console locale 0.4

`GET /` sert la console intégrée au paquet Python, sans CDN. `strowger serve --open` ouvre un code de connexion à usage unique dans le fragment URL, supprimé avant les requêtes HTTP. Le code expire après 120 s. Le serveur échange le code ou la clé opérateur contre un cookie HttpOnly, SameSite=Strict, valable 12 h, en mémoire. Ce mode est destiné à la boucle locale HTTP.

La console utilise `X-Strowger-Console: 1`. Les origines tierces sont refusées. La clé API n’est jamais renvoyée au navigateur après connexion. Les jetons de leases sont gardés dans le sessionStorage de l’onglet pour retrouver ses sessions après rechargement. Les clients SDK continuent d’utiliser leurs en-têtes Bearer.

`GET /demo` fournit une mission locale. Le CLI protège le dossier `data/` contre deux brokers concurrents. Les leases et sessions sont en mémoire ; ce verrou ne remplace pas la coordination entre plusieurs hôtes.
