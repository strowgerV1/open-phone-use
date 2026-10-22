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

Les routes par ID exigent aussi `X-Lease-Token: <token du lease>`. Un token volé ne suffit pas sans la clé du propriétaire. La réponse ne réémet jamais le token après création. Identifiant inexistant, autre propriétaire ou token incorrect : même réponse 404.

TTL entre 1 et 3600 secondes. L’expiration est contrôlée par une horloge monotone ; `expires_at` est un timestamp Unix de présentation. Le balayage des expirations s’exécute toutes les 500 ms. Une requête contrôle aussi l’expiration avant d’agir. Une action est limitée au plus petit de 20 secondes et de la durée restante. Deux actions du même lease sont sérialisées. Acquisitions sérialisées, capacité globale de quatre leases par défaut, téléphone exclusif.

```text
acquire → active ──renew──→ active
             │
             ├── release / expiry → closing → released / expired
             │                        └────→ cleanup_failed → nouvelle tentative
             └── action (vérification identité, jeton et TTL)
```

Un échec de nettoyage met la ressource en quarantaine et continue de consommer une place. Aucun renouvellement ni action après expiration/libération. Les tombstones sont conservées environ une heure après l’échéance initialement programmée. Un token d’un tombstone supprimé reste invalide.

Erreurs : 401 authentification, 404 identité/lease, 409 capacité, 410 lease inactif, 422 validation, 501 provider non configuré, 502 action échouée/timeout, 503 démarrage/nettoyage échoué. La santé du processus ne garantit pas que Docker, Chromium ou ADB soient disponibles.

Actions navigateur : `navigate(url)`, `observe()`, `click(selector)`, `fill(selector,text)`, `screenshot()`. Les URL doivent être HTTP(S) ; ce filtre ne bloque pas les réseaux locaux, redirections et sous-ressources. Ce runtime local n’a pas de filtre egress.

Actions desktop : `observe`/`screenshot`, `tap(x,y)`, `type(text)` (2000 caractères max), `key(key)` (Return, Tab, Escape, BackSpace). Actions Android : `observe`/`screenshot`, `tap(x,y)`, `key(key)` (HOME, BACK, ENTER).

Les captures PNG sont retournées en `png_base64`. Le texte navigateur est tronqué à 20 000 caractères. Les screenshots et le texte sont renvoyés au client mais ne sont pas enregistrés dans le journal d’audit. Ce journal garde uniquement date, propriétaire, ID, type, opération et résultat. L’opérateur doit gérer sa rétention/rotation.

## Ajouter un provider

Définir `actions`, puis trois méthodes asynchrones : `start()`, `act(action,args)` et `close()`. `close` doit être idempotente. `start` doit nettoyer ses ressources partielles en cas d’échec. Le broker contrôle le cycle de vie, le provider contrôle son environnement. Ajouter l’activation explicite et un test réel de provisionnement, action et nettoyage.

Pour une intégration GETA/STROWGER, provisionner une clé distincte par agent, créer un `Runtime` avec cette clé, puis utiliser les context managers. Le choix du provider appartient à l’orchestrateur ; aucune boucle LLM n’est intégrée dans ce broker.


## Flotte Android physique

L'acquisition téléphone accepte le champ facultatif `device_id`, identifiant public configuré par l'opérateur, jamais un serial arbitraire. La réponse et l'inspection incluent `device_id` (null pour browser/desktop). Le SDK expose `runtime.phone.acquire(ttl=120, device_id="phone-01")`.

`GET /v1/devices` exige une clé Bearer et ne liste que les appareils autorisés : `{"devices":[{"id":"phone-01","kind":"phone","state":"available"}]}`. Le SDK fournit `runtime.devices()`. Ni serial USB, ni token, ni identité d'un autre propriétaire ne sont retournés. Voir [les états, la configuration et les limites](PHYSICAL_FLEET.md).

## Configuration du pilote 0.2

`ENV_CAPACITY` configure de 1 à 64 places (défaut 4). `strowger init --capacity 6` prépare six places pour le banc local. `ENV_ANDROID_DEVICES_FILE` désigne un inventaire JSON privé lu au démarrage. Priorité : argument `devices` explicite, puis `ENV_ANDROID_DEVICES` si présent, puis le fichier, puis le serial legacy. Une liste explicitement vide désactive les téléphones, sans réactiver le serial legacy. Les changements d’inventaire demandent un redémarrage du broker.
