# Flotte de téléphones physiques · pilote Android

Le broker sait attribuer plusieurs Android déjà configurés, un appareil par lease, avec sélection facultative. Un téléphone doit être dédié à des tests, sans comptes personnels ni données de tiers. Aucun appareil n'était connecté lors du développement : concurrence, refus et déconnexion ont été vérifiés avec un fournisseur simulé ; le passage matériel reste à faire. iOS et bras robotisés ne sont pas implémentés.

## Préparer le banc

1. Commencer avec deux Android. Étiqueter téléphone, câble et port du hub `phone-01`, `phone-02`. Conserver le rapprochement avec le serial dans un inventaire opérateur privé.
2. Utiliser un hub USB **alimenté avec transfert de données**, des câbles de données courts et une alimentation dimensionnée par le fabricant pour les appareils branchés simultanément. Un répartiteur de charge sans données ne suffit pas. Ne pas présumer que chaque port recharge à pleine puissance en même temps.
3. Poser les appareils sur un support ventilé, accessible pour confirmer l'autorisation USB. Surveiller température et état des batteries ; retirer du banc tout appareil gonflé ou endommagé. Pour une longue marche, suivre les recommandations du fabricant et les fonctions de limitation de charge disponibles.
4. Installer les [Android SDK Platform Tools officiels](https://developer.android.com/tools/releases/platform-tools), activer les options développeur et le débogage USB. Déverrouiller chaque téléphone et autoriser cet ordinateur sur l'écran.
5. Exécuter `adb devices -l` localement. Chaque serial prévu doit être en état `device`. `unauthorized` nécessite une validation sur le téléphone ; `offline` exige de vérifier câble, alimentation et connexion. Le broker ne contourne pas une autorisation manquante.

Source de procédure : [Android Debug Bridge, documentation officielle](https://developer.android.com/tools/adb), consultée le 22 octobre 2026. La connexion USB n'active pas à elle seule internet : prévoir le Wi-Fi de test, sans supposer qu'une SIM ou une connexion cellulaire est fournie.

## Configurer explicitement les appareils et permissions

Depuis le dossier du projet, après chargement des clés créées par `scripts/init_env.py`, utiliser les noms d'agents présents dans `ENV_API_KEYS` :

```sh
export ENV_ANDROID_DEVICES='[{"id":"phone-01","serial":"REMPLACER_SERIAL_1","owners":["agent-demo"]},{"id":"phone-02","serial":"REMPLACER_SERIAL_2","owners":["agent-demo"]}]'
uvicorn strowger_env.server:create_app --factory --host 127.0.0.1 --port 8765
```

Remplacer `agent-demo` par le nom réellement configuré. Les identifiants sont uniques ; un serial ne peut figurer deux fois. Seuls les serials enregistrés sont adressables. Aucun shell générique, installation APK, accès aux fichiers hôte ou commande ADB fournie par l'agent n'est exposé. Les actions autorisées sont capture/observation, tap et touches HOME/BACK/ENTER.

`ENV_ANDROID_SERIAL` reste compatible : il crée `android-01`, accessible à tous les propriétaires de clés configurés. Pour une séparation par propriétaire, utiliser l'inventaire explicite `ENV_ANDROID_DEVICES` et ses listes `owners`.

```python
from strowger_env.client import Runtime

with Runtime("http://127.0.0.1:8765", api_key) as runtime:
    print(runtime.devices())
    with runtime.phone.acquire(device_id="phone-01", ttl=120) as first:
        with runtime.phone.acquire(device_id="phone-02", ttl=120) as second:
            first.act("key", key="HOME")
            image = second.act("screenshot")  # PNG encodé en base64
```

Sans `device_id`, le broker choisit le premier appareil autorisé, libre et accessible. L'acquisition est atomique dans **un seul processus**. La capacité globale reste de quatre environnements par défaut, tous types confondus. Une installation plus grande nécessite d'ajuster la capacité dans le lancement applicatif et de mesurer les ressources hôte ; le nombre de ports USB n'est pas une preuve de capacité.

## États et réponses API

`GET /v1/devices`, avec la clé Bearer, retourne uniquement les appareils autorisés : identifiant public, type et état. Il ne retourne ni serial USB, ni propriétaire d'une autre lease, ni identifiant de lease, ni token.

- `available` : vérification ADB réussie lors de la requête, sans garantie de disponibilité future.
- `leased` : lease détenue par le demandeur ; `unavailable` si l'appareil partagé est occupé par un autre propriétaire.
- `offline_or_unauthorized` : ADB absent, erreur, appareil déconnecté ou non autorisé.
- `quarantined` : nettoyage d'une lease du demandeur en échec ; aucune nouvelle allocation avant nettoyage réussi.

`POST /v1/leases` accepte `{"kind":"phone","device_id":"phone-01","ttl":120}`. Un identifiant absent ou non autorisé retourne 404 ; appareil occupé ou capacité épuisée : 409 ; appareil autorisé mais inaccessible : 503. Les actions inconnues et arguments invalides retournent 422.

## Libération et déconnexion

Une libération ou expiration vérifie ADB et revient à HOME. **HOME n'efface rien** : applications, sessions, notifications, comptes et fichiers persistent. Ne pas partager un téléphone entre clients sans un processus opérateur de remise à zéro et de vérification encore à construire. Pour le pilote, attribuer chaque appareil à un seul propriétaire.

Lorsqu'une action téléphone échoue, la lease est fermée. Si le retour HOME échoue, l'état devient `cleanup_failed`, le serial reste réservé et n'est pas réattribué. Le worker retente le nettoyage ; une reconnexion réussie permet de libérer l'appareil. Un agent doit obtenir une nouvelle lease, l'ancienne ne reprend pas son activité. Un retry de DELETE peut aussi terminer le nettoyage. Aucune réinitialisation, suppression de données ou restauration d'image n'est annoncée.

Le registre est en mémoire : ne lancer **ni plusieurs workers, ni deux brokers sur les mêmes appareils**, et ne redémarrer qu'après réconciliation manuelle des téléphones. Après crash, l'exclusivité précédente et les quarantaines ne sont pas persistées. Les limites TTL et de commande bornent une requête, mais ne garantissent pas l'annulation d'une action déjà reçue par le téléphone. Ce pilote local ne constitue pas un service cloud public multi-client.

## Recette matérielle à exécuter avant une offre

1. Vérifier deux serials autorisés avec `adb devices -l`, puis les voir `available` via le SDK.
2. Réserver les deux simultanément et vérifier visuellement que HOME/capture ciblent le bon téléphone. Une seconde réservation du même identifiant doit échouer en 409.
3. Débrancher le premier pendant sa lease. Une capture doit échouer ; le serial doit rester indisponible tant que le nettoyage échoue. Vérifier que le second continue à répondre.
4. Rebrancher, vérifier l'autorisation, attendre le nettoyage ou rappeler DELETE ; obtenir une nouvelle lease. Vérifier la libération par TTL et la persistance attendue des données.
5. Vérifier avec une autre clé que les identifiants privés et les tokens sont inaccessibles. Tester une marche prolongée en surveillant alimentation, chaleur et déconnexions, et consigner modèles/versions/ports/câbles.

Ces étapes sont une recette à faire, pas des tests matériels déjà réussis.

## iPhone et iPad : chantier séparé

Brancher des iPhone à un hub ne les rend pas contrôlables par l'adaptateur Android. Une voie connue à étudier est Appium XCUITest avec WebDriverAgent, un hôte macOS/Xcode compatible et la configuration des appareils/signatures. Voir les documents officiels [exigences système](https://github.com/appium/appium-xcuitest-driver/blob/master/docs/getting-started/system-requirements.md) et [configuration appareil](https://github.com/appium/appium-xcuitest-driver/blob/master/docs/getting-started/device-setup.md), consultés le 22 octobre 2026. Version iOS/Xcode, provisioning et compatibilité du modèle doivent être validés sur le matériel choisi. Le broker retourne actuellement `ios.enabled=false` ; aucune intégration iOS n'est livrée.
