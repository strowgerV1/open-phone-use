# STROWGER Environment Lease · 0.1.0

**Un agent réserve un environnement, agit, puis le libère.**

Un runtime local expérimental pour vos agents GETA / STROWGER, avec une API HTTP et un SDK Python. Aucun fournisseur LLM ni abonnement cloud nécessaire pour la démonstration.

```python
from strowger_env.client import Runtime

with Runtime("http://127.0.0.1:8765", api_key) as runtime:
    with runtime.browser.acquire(ttl=300) as lease:
        lease.act("navigate", url="https://example.com")
        print(lease.act("observe"))
# Le context manager appelle lease.release().
```

## Ce qui fonctionne

| Ressource | Implémentation | Validation locale du 22 octobre 2026 |
|---|---|---|
| Browser | Chromium dédié à chaque lease ; navigation, observation, clic, saisie, capture | Mission réelle et séparation de deux sessions testées |
| Desktop | Desktop Linux X11 dans Docker ; capture, clic, texte, touches | Création, capture PNG, saisie et suppression testées |
| Phone | Flotte Android enregistrée, attribution exclusive par appareil, inventaire autorisé et ADB | 12 tests de flotte simulée ; aucun appareil connecté pour validation matérielle |
| iOS, Windows VM, portique robotisé | À développer | Non disponibles |

Le site dans `site/` est une **maquette locale rebrandée de PhoneUse**, demandée pour étude visuelle. Ses ressources tierces, sa police, son modèle 3D et son code ne sont **pas couverts par notre licence MIT**. Les tarifs, la flotte et les performances montrés sont ceux de la maquette source, pas des services STROWGER disponibles. L’utilisateur a confirmé disposer des autorisations de réutilisation pour cette publication ; cela ne relicencie pas ces éléments sous MIT. Voir `site/NOTICE.md`.

## Démarrer en local

Prérequis : Python 3.11+ ; internet pour télécharger Chromium et les dépendances. macOS/Linux pour ce quickstart. Docker est facultatif pour le navigateur et nécessaire pour le desktop Linux.

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.lock
pip install -e .
playwright install chromium
# Sous Linux : playwright install --with-deps chromium
python scripts/init_env.py
set -a
. ./.env
set +a
uvicorn strowger_env.server:create_app --factory --host 127.0.0.1 --port 8765
```

Dans un second terminal, depuis le même dossier :

```sh
. .venv/bin/activate
set -a
. ./.env
set +a
python examples/browser_demo.py
```

Résultat attendu : `Bonjour STROWGER`, une image `demo.png`, puis libération automatique du navigateur. La page de test est locale ; aucune inscription réelle ni action sur un service externe.

Documentation API interactive : <http://127.0.0.1:8765/docs>.

## Activer le desktop

```sh
docker build -t strowger-desktop:0.1.0 docker/desktop
export ENV_DESKTOP_ENABLED=1
# Relancer le serveur après ce changement.
```

```python
with runtime.desktop.acquire(ttl=60) as lease:
    image = lease.act("screenshot")   # png_base64
    lease.act("tap", x=200, y=200)
    lease.act("type", text="hello")
```

Chaque lease réserve un nouveau conteneur : aucun réseau, aucun dossier hôte monté, utilisateur non-root, capabilities retirées, limites CPU/RAM/PID. Un terminal reste un terminal : toute commande saisie peut s’exécuter dans ce conteneur. Ce n’est pas une VM ni une isolation suffisante pour du code hostile. Le broker nécessite l’accès au daemon Docker ; ne jamais exposer ce daemon aux agents.

## Connecter un Android de laboratoire

Installer Android SDK Platform Tools depuis la source officielle ; activer le débogage USB sur un appareil dédié, et autoriser la connexion sur cet appareil.

```sh
adb devices
export ENV_ANDROID_SERIAL=emulator-5554  # remplacer par l’identifiant exact
# Relancer le serveur.
```

```python
with runtime.phone.acquire(ttl=60) as lease:
    image = lease.act("observe")
    lease.act("tap", x=100, y=200)
    lease.act("key", key="BACK")
```

Plusieurs téléphones peuvent avoir chacun une lease exclusive. Pour configurer les serials, les permissions et le banc USB, suivre le [guide flotte physique](docs/PHYSICAL_FLEET.md). La libération revient à HOME sans réinitialiser les applications ni les données. Pas de wipe automatisé. ADB contrôle le téléphone ; cette version n’utilise pas de robot physique et ne promet aucune « indétectabilité ».

## Tester

```sh
pytest -q
ENV_DESKTOP_TEST=1 pytest -q tests/test_desktop.py
```

La suite navigateur exige Chromium installé. Le test desktop est désactivé par défaut ; il exige Docker et l’image construite. Le CI exécute le protocole et la mission Chromium, mais pas Docker ni Android.

## Explorer la maquette

```sh
cd site
npm run dev -- --host 127.0.0.1 --port 4173
```

Ouvrir <http://127.0.0.1:4173>. Les animations utilisent les ressources récupérées sur PhoneUse : il s’agit d’une reproduction locale d’étude, pas d’une création originale. Les formulaires et boutons commerciaux ne déclenchent aucune commande réelle.

## Documentation

- [Flotte Android physique et recette hardware](docs/PHYSICAL_FLEET.md)
- [Protocole et intégration](docs/PROTOCOL.md)
- [Architecture, limites et passage au cloud](docs/ARCHITECTURE.md)
- [Projets consultés et attribution](docs/SOURCES.md)
- [Contribuer](CONTRIBUTING.md)

Cette première version est mono-processus et pour des agents de confiance. L’état des leases est en mémoire. Les clés sont configurées par l’opérateur ; le journal JSONL ne contient pas les tokens ni les arguments des actions. Un kill brutal peut laisser des ressources orphelines. Une plateforme cloud publique nécessite des workers isolés, un registre persistant, un contrôle réseau et un mécanisme de réconciliation.
