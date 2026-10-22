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

```json
[
  {"id":"phone-01","serial":"REMPLACER_SERIAL_1","owners":["agent-demo"]},
  {"id":"phone-02","serial":"REMPLACER_SERIAL_2","owners":["agent-demo"]}
]
```

Enregistrer cet inventaire dans `data/fleet.json` avec permissions privées et définir `ENV_ANDROID_DEVICES_FILE=data/fleet.json`. Pour des clients distincts, attribuer un seul owner par appareil ; voir [Exploiter une flotte par client](CLIENT_FARMS.md).

Remplacer `agent-demo` par le nom réellement configuré. Les identifiants sont uniques ; un serial ne peut figurer deux fois. Seuls les serials enregistrés sont adressables. Aucun shell générique, installation APK, accès aux fichiers hôte ou commande ADB fournie par l'agent n'est exposé. Les actions autorisées sont capture/observation, tap et touches HOME/BACK/ENTER.

`ENV_ANDROID_SERIAL` reste compatible : il crée `android-01`, accessible à tous les propriétaires de clés configurés. Les entrées historiques `id`, `serial`, `owners` restent valides ; les champs `provider` et `automation` sont facultatifs (`physical` et `adb` par défaut). Pour UIAutomator2, installer l'extra Android et inscrire explicitement `"automation":"uiautomator2"`. Ce backend ajoute hiérarchie et sélecteurs structurés ; il ne permet pas XPath ni commandes arbitraires.

```python
from strowger_env.client import Runtime

with Runtime("http://127.0.0.1:8876", api_key) as runtime:
    print(runtime.devices())
    with runtime.phone.acquire(device_id="phone-01", ttl=120) as first:
        with runtime.phone.acquire(device_id="phone-02", ttl=120) as second:
            first.act("key", key="HOME")
            image = second.act("screenshot")  # PNG encodé en base64
```

Sans `device_id`, le broker choisit le premier appareil autorisé, libre et accessible. L'acquisition est atomique dans **un seul processus**. La capacité globale reste de quatre environnements par défaut, tous types confondus ; `ENV_CAPACITY` permet de la régler de 1 à 64. Une installation plus grande nécessite de mesurer les ressources hôte ; le nombre de ports USB n'est pas une preuve de capacité.

## États et réponses API

`GET /v1/devices`, avec la clé Bearer, retourne uniquement les appareils autorisés : identifiant public, type et état. Il ne retourne ni serial USB, ni propriétaire d'une autre lease, ni identifiant de lease, ni token.

- `available` : vérification ADB réussie lors de la requête, sans garantie de disponibilité future.
- `leased` : lease détenue par le demandeur ; `unavailable` si l'appareil partagé est occupé par un autre propriétaire.
- `offline_or_unauthorized` : ADB absent, erreur, appareil déconnecté ou non autorisé.
- `quarantined` : l'appareil est en quarantaine de nettoyage ou d'action incertaine ; aucune nouvelle allocation n'est possible tant qu'un opérateur ne l'a pas réconcilié.

`POST /v1/leases` accepte `{"kind":"phone","device_id":"phone-01","ttl":120}`. Un identifiant absent ou non autorisé retourne 404 ; appareil occupé ou capacité épuisée : 409 ; appareil autorisé mais inaccessible : 503. Les actions inconnues et arguments invalides retournent 422.

## Libération et déconnexion

Une libération ou expiration vérifie ADB et revient à HOME. **HOME n'efface rien** : applications, sessions, notifications, comptes et fichiers persistent. Ne pas partager un téléphone entre clients sans un processus opérateur de remise à zéro et de vérification encore à construire. Pour le pilote, attribuer chaque appareil à un seul propriétaire.

Lorsqu'une action téléphone échoue, la lease est fermée. Si le retour HOME échoue, l'état devient `cleanup_failed`, le serial reste réservé et n'est pas réattribué. Un retry de DELETE peut retenter le nettoyage ; un agent doit obtenir une nouvelle lease, l'ancienne ne reprend pas son activité. Si le résultat d'une action mutante est incertain après timeout, annulation ou crash du worker, le device est bloqué dans `data/uncertain-devices.json` même si HOME réussit ensuite. Après inspection physique, un opérateur peut lever cette quarantaine avec `strowger reconcile --device-id phone-01 --confirm-inspected`. Cette commande exige l'arrêt du broker et une attestation explicite ; aucun endpoint agent ne l'expose. Aucune réinitialisation, suppression de données ou restauration d'image n'est annoncée.

Le registre des leases reste en mémoire : ne lancer **ni plusieurs workers, ni deux brokers sur les mêmes appareils**. Les quarantaines d'action incertaine sont persistées, mais les leases actives ne le sont pas ; après un crash, inspecter les appareils et réconcilier les opérations incertaines avant de relancer la flotte. Les limites TTL et de commande bornent une requête, mais ne garantissent pas l'annulation d'une action déjà reçue par le téléphone. Ce pilote local ne constitue pas un service cloud public multi-client.

## Recette matérielle à exécuter avant une offre

1. Vérifier deux serials autorisés avec `adb devices -l`, puis les voir `available` via le SDK.
2. Réserver les deux simultanément et vérifier visuellement que HOME/capture ciblent le bon téléphone. Une seconde réservation du même identifiant doit échouer en 409.
3. Débrancher le premier pendant sa lease. Une capture doit échouer ; le serial doit rester indisponible tant que le nettoyage échoue. Vérifier que le second continue à répondre.
4. Rebrancher, vérifier l'autorisation, attendre le nettoyage ou rappeler DELETE ; obtenir une nouvelle lease. Vérifier la libération par TTL et la persistance attendue des données.
5. Vérifier avec une autre clé que les identifiants privés et les tokens sont inaccessibles. Tester une marche prolongée en surveillant alimentation, chaleur et déconnexions, et consigner modèles/versions/ports/câbles.

Ces étapes sont une recette à faire, pas des tests matériels déjà réussis.

## iPhone et iPad : chantier séparé

Brancher des iPhone à un hub ne les rend pas contrôlables par l'adaptateur Android. Une voie connue à étudier est Appium XCUITest avec WebDriverAgent, un hôte macOS/Xcode compatible et la configuration des appareils/signatures. Voir les documents officiels [exigences système](https://github.com/appium/appium-xcuitest-driver/blob/master/docs/getting-started/system-requirements.md) et [configuration appareil](https://github.com/appium/appium-xcuitest-driver/blob/master/docs/getting-started/device-setup.md), consultés le 22 octobre 2026. Version iOS/Xcode, provisioning et compatibilité du modèle doivent être validés sur le matériel choisi. Le broker retourne actuellement `ios.enabled=false` ; aucune intégration iOS n'est livrée.

## Préparation aujourd'hui, recette demain avec 5 à 6 téléphones

Aujourd'hui, sans appareils : installer le logiciel et ses dépendances, préparer le banc et créer une configuration vide. Aucune capture ni action sur un téléphone n'est nécessaire pour cette préparation.

```sh
strowger init --capacity 6
strowger doctor
```

`doctor` est un diagnostic local : une flotte vide ou ADB non prêt signifie que la recette matérielle reste à faire. La capacité configurée à six est une limite logicielle de réservations, sans garantie que l'alimentation, le hub ou l'ordinateur supportent six appareils.

Demain, commencer par deux téléphones Android dédiés et déjà autorisés sur l'ordinateur. Charger la configuration selon le lanceur fourni, puis inscrire les appareils. Remplacer `alice` par un propriétaire réellement configuré dans les clés ; l'inscription ne crée pas d'autorisation ADB et ne doit prendre que les appareils explicitement prévus pour ce banc.

```sh
strowger doctor
strowger enroll --owner alice
strowger serve
```

Dans un second terminal avec la même configuration, lancer explicitement la recette opérateur :

```sh
strowger smoke --limit 2
```

Le smoke réserve les appareils, envoie HOME, demande une capture et libère les leases, puis écrit un rapport local. **Il agit réellement sur les téléphones et doit être lancé volontairement par l'opérateur**, avec les bons appareils et comptes de test. Ne pas le lancer aujourd'hui sans téléphones en prétendant que le banc est validé. Vérifier le rapport et les écrans physiques ; conserver les captures localement car elles peuvent contenir les données présentes à l'écran.

Après réussite avec deux appareils, ajouter progressivement les autres, vérifier de nouveau l'inventaire et exécuter :

```sh
strowger doctor
strowger enroll --owner alice
# Après mise à jour de l'inventaire, relancer l'unique broker.
strowger smoke --limit 6
```

Si seulement cinq sont disponibles, utiliser `--limit 5` et documenter cinq appareils testés. Le broker ne doit pas tourner deux fois pendant l'inscription ou le redémarrage. Réserver six appareils en parallèle, refuser une septième acquisition et réacquérir un appareil précisément après sa libération sont déjà couverts au niveau protocole avec six faux Android ; cela ne remplace pas la validation USB, ADB, alimentation et thermique de demain.

### Configuration de flotte sur fichier

`ENV_ANDROID_DEVICES_FILE` désigne un fichier JSON opérateur contenant la même liste d'objets `id`, `serial`, `owners` que `ENV_ANDROID_DEVICES`. Un fichier contenant `[]` est valide pour préparer l'installation ; le fournisseur téléphone reste alors désactivé tant qu'aucun appareil n'est inscrit. Fichier absent, JSON malformé, doublons ou permissions invalides bloquent le démarrage. Si `ENV_ANDROID_DEVICES` est défini, son JSON prend priorité sur le fichier, y compris une liste vide explicite. Éviter de conserver cet ancien paramètre lors du passage à l'inscription sur fichier.

`ENV_CAPACITY=6` configure la capacité totale du broker, navigateur et desktop compris. Une valeur non entière, inférieure à un ou supérieure à 64 est refusée au démarrage. Les serials restent privés dans ce fichier ; publier uniquement un exemple sans serial réel, sans clé et sans capture d'écran privée.
