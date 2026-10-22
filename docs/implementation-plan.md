# Plan d’intégration — UIAutomator2, scrcpy, tâches parallèles et Cuttlefish

Plan préparé par Astra le 23 octobre 2026 pour implémentation par Luna. Base inspectée : `2d13793902e26c41833d739d508e9bebb713087a`. Ce document décrit du travail à réaliser, pas des fonctionnalités déjà livrées.

## 1. Résultat attendu et périmètre

Livrer une ferme privée où plusieurs clients configurés par l’opérateur lancent des tâches sur des Android distincts en parallèle. Chaque téléphone physique ou Cuttlefish n’a qu’un détenteur de lease ; toutes ses actions passent par cette lease. Les agents IA externes emploient le SDK ou HTTP, les scénarios déterministes emploient un petit moteur de jobs déclaratifs. Aucun fournisseur LLM fictif ni exécution de Python/shell arbitraire n’est ajouté.

Ordre d’implémentation : sécuriser le cycle des leases et l’inventaire, intégrer UIAutomator2, intégrer scrcpy en observation locale, ajouter les jobs et le SDK asynchrone, puis intégrer le pool Cuttlefish et les outils de préparation Linux. Chaque étape est testable sans matériel, puis dispose d’une recette matérielle volontaire.

La première livraison cloud utilise un **pool préprovisionné** : un opérateur prépare les CVD avec le vrai CLI `cvdr`, connecte leurs transports ADB, puis inscrit les serials exacts dans la flotte. Le broker gère leurs réservations, leurs tâches et leur nettoyage de session ; il ne crée ni ne détruit des VM au gré des leases. Cette distinction est visible dans les capacités et la documentation.

Restent hors périmètre : hébergement public multi-tenant, facturation, provisioning automatique par requête d’agent, ordonnanceur distribué, reset complet garanti des appareils, streaming scrcpy dans le navigateur, iOS. Plusieurs clients privés sont possibles avec des appareils dédiés à chacun ; HOME ne nettoie pas les données. L’API reste derrière loopback ou tunnel privé. Un vrai service public nécessitera un registre durable réconciliable, des workers isolés, une passerelle TLS/auth, des quotas et une politique de reset validée.

## 2. État constaté et compatibilité

- `server.py` fournit les leases en mémoire, les ACL `owners`, le TTL monotone, le verrou par lease, un verrou global d’allocation, la quarantaine en cas d’échec du nettoyage, Bearer + `X-Lease-Token`.
- `Android` dans `adapters.py` exécute ADB par subprocess ; il sait observer, capturer, tapoter, glisser, saisir ASCII, ouvrir un package et envoyer HOME/BACK/ENTER. Le SDK actuel est synchrone.
- Les inventaires ne tolèrent actuellement que les trois clés `id`, `serial`, `owners`. Les sondes d’inventaire appellent `start()` et le verrou d’allocation reste pris pendant tous les démarrages. Cela doit être adapté avant d’introduire des connexions UIAutomator2 lentes.
- `serve` impose déjà une instance locale avec verrou de dossier ; la console a un cookie HttpOnly et une vérification same-origin. Ne pas affaiblir ces mécanismes.
- Le parent a exécuté la base dans un environnement frais : **51 tests réussis, 1 ignoré** (Docker), 13,52 s, puis le test Docker réel a également réussi séparément. ADB est présent mais aucun Android connecté ; scrcpy 5.0.1 a ensuite été installé par Homebrew et ses options inspectées. UIAutomator2 3.7.0 est en cours d’installation par le parent. Aucun hôte Linux KVM n’est disponible localement. Il ne faut donc pas annoncer de recette Android/Cuttlefish réussie.
- Garder les chemins `/v1/leases`, `kind=phone`, `Runtime`, `Lease`, `ENV_ANDROID_SERIAL`, les inventaires anciens et les factories injectées des tests existants. N’ajouter que des options ou champs facultatifs ; ne pas refaire la maquette `site/`.

## 3. Architecture et invariants

Flux commun : client authentifié → ACL de ressource → réservation atomique → adaptateur choisi par inventaire → actions sérialisées → nettoyage → libération. Les jobs utilisent exactement le même service de leases que l’API, jamais un chemin direct vers ADB.

### Inventaire

Ajouter un validateur central, par exemple `strowger_env/fleet.py`. Il accepte les anciens objets et normalise les champs facultatifs suivants :

- `provider`: `physical` par défaut, ou `cuttlefish` ;
- `automation`: `adb` par défaut, ou `uiautomator2` ;
- `tenant`: facultatif, identifiant de client configuré ; si présent, il doit figurer dans `owners` et ce pilote impose `owners=[tenant]` pour dédier le téléphone ;
- `cuttlefish`: métadonnées opérateur facultatives `host`, `group`, `instance`, uniquement pour les entrées du fournisseur correspondant. Aucune URL fournie par l’agent.

Un serial demeure unique à travers tous les fournisseurs. Conserver les tests de partage explicite anciens, mais les nouveaux exemples multi-client utilisent un seul owner par appareil. La v1 assimile un owner de clé à un tenant ; ne pas prétendre gérer plusieurs rôles, utilisateurs et organisations avec ce seul modèle.

Ne pas ajouter les métadonnées aux anciens objets `/v1/devices` par défaut si des consommateurs en comparent la forme exacte. Les capacités par lease (`actions`) suffisent pour l’UI ; une vue enrichie facultative, par exemple `GET /v1/devices?details=true`, peut ajouter `provider`, `automation` et les capacités disponibles. Serial, adresses, configuration Cuttlefish et identité d’un autre propriétaire restent privés.

### Allocation, annulation et nettoyage

1. Sous le verrou global, valider ACL/capacité, réserver le device dans un registre `pending` et compter cette réservation dans la capacité. Relâcher le verrou avant tout I/O ou startup.
2. Démarrer le candidat hors verrou ; si la sélection automatique trouve un appareil indisponible, libérer sa réservation provisoire seulement après nettoyage connu, puis essayer le suivant. Un échec après mutation du device peut exiger une quarantaine.
3. Publier la lease sous verrou après startup réussi. Une requête annulée, une exception ou l’arrêt du serveur doit aussi traiter son entrée `pending`. Les sondes concurrentes ne doivent jamais attribuer le même appareil.
4. Utiliser une sonde ADB `get-state` courte pour l’inventaire. Ne pas connecter UIAutomator2 ni démarrer son serveur depuis `GET /v1/devices` ou `doctor` ; afficher séparément disponibilité ADB et backend installé.
5. Garder le verrou par lease pour actions, renouvellement et fermeture. Les actions sur deux appareils distincts doivent réellement se chevaucher. Ne pas tenir le verrou global pendant un screenshot, un processus scrcpy ou un job.
6. Le nettoyage arrête d’abord les viewers et le worker associé, attend leur fin, puis revient à HOME. Ne libérer la place qu’après résultat connu. `close()` doit être idempotent et borné. Un échec conserve `cleanup_failed` et l’exclusivité.
7. **Annuler un subprocess hôte n’annule pas forcément une commande déjà reçue par Android.** En cas de timeout/annulation avec résultat distant inconnu, marquer une quarantaine distincte nécessitant réconciliation opérateur ; ne pas la lever automatiquement parce que HOME a réussi. La relance automatique existante reste valable pour les simples erreurs de transport/nettoyage connues, pas pour un worker dont l’action est incertaine.
8. Les `CancelledError` et l’arrêt lifespan doivent passer par un `finally` avec nettoyage protégé et attendu. Une tâche de nettoyage créée puis oubliée ne suffit pas. Les retries automatiques d’actions mutantes sont interdits.
9. Le registre général reste mono-processus en mémoire. Pour les quarantaines incertaines, ajouter un petit registre local atomique privé des IDs bloqués, sans tokens/contenu, chargé au démarrage ; cela ne transforme pas les leases en système durable. Une commande opérateur explicite de réconciliation peut lever le blocage après contrôle matériel ; elle ne promet pas d’annuler une action passée. Aucune suppression via API agent.

## 4. UIAutomator2 réel et facultatif

Nouveau `strowger_env/uiautomator.py` pour l’adaptateur async et `strowger_env/uiautomator_worker.py` pour les appels synchrones au SDK. Dépendance optionnelle `[android]` avec `uiautomator2==3.7.0` (version officielle vérifiée pendant le plan) ; conserver l’installation browser/ADB sans cette dépendance. Ajouter un lock séparé reproductible pour l’extra et contrôler son installation dans l’environnement de test.

Le worker tourne dans un **processus séparé par lease**, lancé via `sys.executable -m ...`, serial provenant exclusivement de l’inventaire. Échange JSON borné sur stdin/stdout, un appel à la fois, identifiants de réponse vérifiés ; pas de token/API key dans argv. Réserver stdout au protocole, couper les logs détaillés de la bibliothèque et ne jamais relayer stderr brut aux clients. Pas de `eval`, pickle réseau, nom de méthode arbitraire ou paramètres de shell fournis par l’agent. Injecter une factory/transport pour les tests.

APIs officielles vérifiées pour la version : `u2.connect(serial)`, `d.dump_hierarchy(...)`, `d.screenshot()` (image Pillow), `d(**selector).click(...)`, `.exists`, `.set_text(text)`, `d.press(...)`, `d.app_start(package)`. Réutiliser les actions ADB existantes pour gestes, touches, lancement et capture si cela réduit les changements ; UIAutomator2 apporte surtout l’arbre et les sélecteurs. `observe` conserve `png_base64` et peut ajouter une hiérarchie XML bornée ; `screenshot` garde la réponse PNG actuelle.

Ajouter :

- `hierarchy` → `{xml, truncated}` ; limite explicite, p. ex. 256 KiB. Une troncature n’est pas un XML complet ; l’annoncer clairement.
- `ui_click` avec `selector` ;
- `ui_exists` avec `selector` → `{exists: bool}` ;
- `ui_set_text` avec `selector` et texte Unicode de 1 à 2 000 caractères.

Sélecteurs structurés autorisés seulement : `resourceId`, `text`, `description`, `className`, `packageName` (chaînes non vides bornées), `clickable`, `enabled` (booléens stricts), `instance` (entier borné). Au moins un critère significatif ; refuser toute clé supplémentaire, XPath libre, regex, attribut Python ou méthode dynamique. L’absence d’un élément n’est pas un crash matériel : retourner une erreur contrôlée sans fermer la lease ; `ui_exists` reste false. Fixer un budget de recherche court inférieur au budget d’action et au TTL. Un argument invalide est 422 avant tout appel au matériel.

Le worker garde sa connexion et termine normalement par fermeture contrôlée de sa session. Vérifier le comportement réel de `stop_uiautomator` dans le SDK épinglé : son retour seul n’est pas une preuve générale d’arrêt d’un service qu’il n’a pas lancé. En timeout : terminer, escalader kill si nécessaire, attendre la sortie, puis appliquer la quarantaine incertaine ci-dessus. Un simple `asyncio.wait_for(asyncio.to_thread(...))` est exclu : il laisse le thread poursuivre l’action.

## 5. scrcpy : vraie observation native liée à la lease

Nouveau `strowger_env/scrcpy.py`, transport subprocess injecté. scrcpy reste un programme hôte facultatif ; version officielle consultée `v5.0.1`. Détecter sa présence et sa version par `doctor`, ne pas le télécharger lors d’une action API.

Ajouter à une lease phone autorisée des endpoints `POST /v1/leases/{id}/viewer` et `DELETE .../viewer`, protégés exactement par Bearer + `X-Lease-Token`. Un seul viewer par lease. Ils sont désactivés sauf opt-in opérateur `ENV_SCRCPY_ENABLED=1`, et destinés à un broker local avec session graphique. Aucun argument de ligne de commande libre.

Commande construite en tableau : `scrcpy --serial <serial inventorié> --no-control --no-audio --no-clipboard-autosync --max-size 1280 --max-fps 20`. Le titre peut utiliser l’ID public du device, jamais un token. Une fermeture volontaire de fenêtre arrête seulement l’observation, pas la tâche en cours. L’expiration, release, échec ou annulation du job doit tuer et attendre le viewer ; interdire sa réutilisation pour une nouvelle lease.

Le viewer est **lecture seule** pour qu’un opérateur ne contourne pas la sérialisation des actions du bot. Les contrôles de la console continuent via les actions du broker. Aucune option de mirroring interactif direct n’est ajoutée à cette livraison.

Le SDK ajoute `lease.start_viewer()` et `stop_viewer()`. La console affiche « Observer avec scrcpy sur l’hôte » uniquement si la capacité est active ; elle explique que la fenêtre s’ouvre sur la machine du broker. Le screenshot toutes les deux secondes reste un rafraîchissement, pas une vidéo. Aucun lien ADB/WebRTC brut ni port de streaming n’est renvoyé au navigateur.

## 6. Jobs parallèles et agents externes

Extraire seulement le service partagé nécessaire de `server.py` vers `strowger_env/leases.py` si indispensable. Préserver `create_app(...)` et ses factories. Nouveau `strowger_env/jobs.py` : workflow de phone uniquement dans ce lot, 1 job → 1 lease → 1 téléphone ; plusieurs jobs indépendants en parallèle dans la limite de la capacité. Pas de réservation atomique de plusieurs téléphones par job.

Contrat proposé : `POST /v1/jobs` avec `device_id` facultatif, `ttl`, `steps` (1 à 100 objets `{action,args}`) et nom facultatif borné. Autoriser uniquement les actions phone publiées ; refuser shell/script/import/network URL. Réponse 202 : ID opaque + `job_token` retourné une seule fois. `GET /v1/jobs/{id}` et `POST /v1/jobs/{id}/cancel` exigent Bearer + `X-Job-Token` ; un owner étranger, un token absent ou erroné reçoit 404. Le job détient le token de sa lease en interne, jamais dans les statuts publics.

États : `queued`, `running`, `cancelling`, `succeeded`, `failed`, `cancelled`, et statut de nettoyage séparé `released` / `quarantined`. Succès uniquement si toutes les étapes et la libération réussissent. Une annulation ou un échec ne doit pas abandonner la lease. `cancel` est idempotent et coupe l’attente en file ou l’action en cours avec les règles de quarantaine déjà définies.

Queue en mémoire bornée (p. ex. 64 jobs total en attente/actifs, 16 par owner, configuration opérateur possible). Allocation réutilisant le service commun, polling court ou condition bornée : attendre pour capacité/device occupé jusqu’à un délai d’attente maximal (p. ex. 60 s) ; erreur définitive ACL/arguments sans retry ; offline → échec contrôlé dans cette v1. Ne pas réserver toutes les places aux jobs en attente. Éviter qu’un premier job visant un appareil occupé bloque les jobs visant d’autres appareils ; fair round-robin simple par owner ou workers distincts avec limites documentées.

Le TTL commence à l’acquisition, pas à la soumission. Pas de renouvellement infini : les workflows s’arrêtent au budget prévu. À l’arrêt du serveur, annuler la queue, arrêter les jobs actifs et attendre les nettoyages. Limiter aussi la rétention des jobs terminés (nombre et durée) ; aucun historique durable annoncé.

Statuts publics : progression, nombre d’étapes, erreur normalisée, timestamps, device autorisé ; pas de texte saisi, XML, screenshot, arguments, tokens ni trace SDK. Les résultats d’action détaillés peuvent rester accessibles par le SDK direct ; ne pas inventer un stockage de captures pour les jobs. Journaliser seulement IDs/owner/action générique/état, comme le journal actuel.

Ajouter `AsyncRuntime` et context managers async à `client.py` ou `async_client.py` sans casser `Runtime`. Exemple `examples/parallel_phone_jobs.py` : deux clés chargées depuis variables privées, deux tâches distinctes, poll statut et annulation/nettoyage en `finally`. Exemple `examples/phone_agent_loop.py` : boucle observation → décision Python fournie par l’utilisateur → action autorisée, budget d’étapes ; aucune fausse connexion à un LLM. Le modèle externe n’obtient ni serial ni commande système.

Console : panneau de jobs simple (formulaire JSON validé ou choix d’un scénario HOME/capture, liste des jobs de l’onglet, progression, annuler). Conserver les tokens dans le mécanisme de session d’onglet existant ; ne pas les mettre dans URL, titre, logs ou liens. Utiliser `textContent` pour toutes données d’un device ou d’un job, jamais HTML injecté.

## 7. Cuttlefish : fournisseur pool et préparation réelle

`provider=cuttlefish` est une entrée de pool Android joignable par ADB. Son adaptateur utilise les mêmes actions et le même système de leases ; il peut employer UIAutomator2. Ses métadonnées permettent le diagnostic opérateur, pas une nouvelle autorité d’accès. `start()` vérifie ADB et, si nécessaire, `getprop sys.boot_completed` avec timeout. `close()` arrête ses workers/viewer et revient à HOME ; **il ne détruit pas la VM ni ses données**.

Nouveau `strowger_env/cuttlefish.py` : adaptateur du pool et wrapper CLI opérateur limité. Commandes proposées :

- `strowger cuttlefish doctor` : OS, accès lecture/écriture `/dev/kvm` pour un hôte local, présence/version des outils, état ADB. Sur Mac : « client possible, hôte KVM indisponible », jamais prêt par simple présence de Docker Desktop.
- `strowger cuttlefish list --config <fichier>` → exécute réellement `cvdr list`, avec `CVDR_USER_CONFIG_PATH` vers un fichier existant fourni par l’opérateur. Sortie destinée à l’opérateur local, pas à l’API agent.
- `strowger cuttlefish create --config ... --host ... --build-id ... --build-target ... --count N` → `cvdr create --host=<hôte> --build_id=<id> --build_target=<cible> --num_instances=N --auto_connect=true`. Un hôte explicite existant réduit les créations imprévues et distingue hôte cloud et CVD. Options validées, count borné, tableau argv, aucune concaténation shell. Exiger un build ID précis pour reproduction ; ne pas choisir automatiquement « latest ».
- `strowger enroll --provider cuttlefish --automation uiautomator2 --owner client-a --serial <serial exact>` réutilise l’inscription existante, vérifie ADB et crée une entrée privée. Inscription explicite après `cvdr create` : la sortie officielle est humaine, pas un contrat JSON à inventer. Ne pas déduire arbitrairement à quel tenant appartiennent tous les nouveaux appareils.

`cvdr` est un vrai outil de Cloud Android Orchestration, dont les commandes et noms de flags ci-dessus ont été lus dans le code officiel. Son tunnel ADB peut être entretenu par des sous-processus ; sa gestion est opérateur et indépendante de la lease. Ne pas exposer 5037/5555/8080/8443 sur Internet. L’accès de Mac au broker Linux passe par SSH/VPN privé, ou l’opérateur utilise `cvdr` depuis un hôte supporté.

Livrer `scripts/prepare-cuttlefish-host.sh` et `docs/CUTTLEFISH.md` :

1. Mode par défaut diagnostic/plan sans mutation ; `--apply` explicite pour préparer une machine Linux Debian/Ubuntu supportée. Refuser les autres OS et l’absence d’accès KVM pour le rôle hôte.
2. Préparer dépendances/outils via les instructions officielles, épingler les révisions téléchargées, garder les droits administrateur uniquement dans le script opérateur. Ne pas lancer de reboot automatiquement ; annoncer les groupes/session/reboot nécessaires.
3. Utiliser la configuration officielle Cloud Android Orchestration et `cvdr` pour le chemin orchestré. Expliquer distinctement l’alternative AOSP `launch_cvd` avec images et host package issus du même build, sans reconstruire cette orchestration dans notre API. Ne pas modifier la variable système HOME dans nos scripts ; si un guide AOSP l’utilise pour son lancement, renvoyer vers sa procédure et conserver notre chemin cvdr comme chemin intégré.
4. Pour construire `cvdr`, la commande officielle est `go build ./cmd/cvdr`. Fournir un emplacement projet privé configurable, fichiers de configuration 0600 et aucune clé enregistrée dans Git. Ne pas automatiser l’ajout de comptes cloud ou des coûts récurrents cachés.
5. Documenter que le guide officiel on-premises signale actuellement une limite multi-conteneurs x86_64 liée à `vhost_user_vsock` et l’absence d’accélération GPU dans cette configuration. Utiliser un groupe multi-instance sur hôte compatible ou plusieurs hôtes séparés après validation ; ne pas promettre une densité de ferme non mesurée.
6. Les commandes de suppression `cvdr delete --host=HOST GROUP` sont documentées comme maintenance opérateur explicite. Aucun delete/reset automatique au release ; ne supprimer ni hôte ni CVD de préexistants en cas d’erreur de provisioning dont l’issue est inconnue. Consigner « état inconnu, vérifier via list » sans inventer un succès.

Pas d’API REST Google devinée. Pas d’URL de console WebRTC native exposée aux tenants : elle pourrait contourner lease/ACL. Sa sécurisation et intégration vidéo seront un lot distinct.

## 8. Fichiers et ordre de réalisation pour Luna

| Lot | Fichiers principaux | Critère de fin |
|---|---|---|
| A | `fleet.py`, `server.py`, éventuellement `leases.py`, `config.py`, tests flotte/protocole | anciens contrats verts ; startup hors verrou global ; pending et quarantaine sûrs |
| B | `uiautomator.py`, `uiautomator_worker.py`, `pyproject.toml`, lock Android, tests dédiés | appels SDK réels câblés ; sélecteurs validés ; processus et annulations testés |
| C | `scrcpy.py`, routes viewer, SDK, CLI doctor, console | vraie commande ciblée et lecture seule ; viewer arrêté avant réattribution |
| D | `jobs.py`, routes jobs, SDK async, exemples, console | au moins deux jobs sur deux appareils se chevauchent ; ACL/cancel/TTL/nettoyage verts |
| E | `cuttlefish.py`, CLI, script Linux, `docs/CUTTLEFISH.md` | pool réellement utilisable par ADB ; wrapper cvdr documenté et testé par injection |
| F | README, `PROTOCOL.md`, `PHYSICAL_FLEET.md`, `ARCHITECTURE.md`, `SOURCES.md`, CI | aucune fausse validation matérielle ; recettes explicites et liens d’attribution |

Préférer ces petits modules à une réécriture générale. Luna choisit les détails locaux cohérents avec les tests, mais ne retire pas les invariants pour simplifier l’implémentation. Garder le site commercial hors du lot.

## 9. Validation obligatoire

### Tests sans hardware, exécutés par défaut

- Régression complète des 52 cas existants, browser compris si Chromium installé. Test Docker toujours opt-in.
- Inventaires anciens inchangés, nouveaux providers valides, doublons inter-provider refusés, champs inconnus/types stricts/owners inconnus refusés, secret/serial absent des réponses.
- Deux startups distincts se chevauchent ; la même cible ne peut être réservée deux fois même pendant startup lent ; capacité inclut pending ; cancellation et erreur de startup ne perdent pas de réservation.
- UIAutomator2 : faux SDK injecté vérifie sérial exact, mapping sélecteurs et Unicode, résultats bornés, protocole invalide refusé, dépendance absente sans casser ADB/browser. Processus factice bloqué : timeout/kill/wait, pas d’action ultérieure, quarantaine incertaine conservée après redémarrage du registre local.
- Un mauvais argument et élément absent n’envoient pas de commande dangereuse ; aucune méthode arbitraire, shell, XPath ou options CLI libres.
- scrcpy : argv exact, aucun contrôle/presse-papiers/audio, mauvais owner/token/lease expirée refusés, absence binaire gérée, démarrage échoué nettoyé, fenêtre fermée et release simultanés idempotents, arrêt viewer avant nouvelle attribution.
- Jobs : queue bornée, deux appareils réellement en parallèle avec barrière/event plutôt qu’un simple chronomètre ; actions sur un appareil sérialisées ; progression ; réussite ; échec ; annulation queued/running ; TTL ; arrêt lifespan ; nettoyage en échec ; propriétaire/token étrangers ; absence de fuite dans statuts, erreurs et audit.
- Une réservation directe et un job concurrent sur la même cible ne peuvent contourner l’exclusivité. Un job bloqué sur A ne bloque pas un job possible sur B.
- Cuttlefish : factory injectée et subprocess cvdr factice contrôlent `create/list` et erreurs/timeouts ; options exactes ; aucun provisionnement lors d’acquire/release/list_devices ; vérification KVM distincte du rôle client ; inscription explicite. Un test de construction argv n’est pas présenté comme une VM démarrée.
- Console et SDK : routes/cookies same-origin inchangés, contrôles UI selon capacités, SDK sync inchangé, context managers async libèrent en exception/annulation, aucune clé/token en URL/log.
- Script : `sh -n` ou `bash -n` selon shebang, mode diagnostic sur Mac qui refuse proprement le rôle hôte sans modifier le système.

### Recettes opt-in, à livrer mais ne pas simuler comme réussies

Ajouter `tests/test_android_hardware.py` protégé par `ENV_ANDROID_TEST=1`, IDs explicitement configurés, et `tests/test_cuttlefish_hardware.py` protégé par `ENV_CUTTLEFISH_TEST=1`. Pas de découverte globale suivie de pilotage automatique. Après opt-in, absence de prérequis doit être un échec clair de recette, pas un faux passage.

Recette Android : deux téléphones dédiés, deux tenants ; réservation simultanée, HOME/capture et hiérarchie ; ouverture de Réglages sans modification de réglages, recherche d’un élément observé, refus des clés croisées, viewer local volontaire, jobs parallèles, TTL, déconnexion d’un appareil pendant que l’autre continue. Saisie Unicode seulement sur une application/formulaire de test explicitement préparé. Résultats privés et modèles/versions notés.

Recette Cuttlefish : hôte Linux KVM réel ; créer un groupe par la commande opérateur, relever explicitement les transports, inscrire deux CVD, exécuter les mêmes tests de lease/jobs/ACL, vérifier qu’une libération ne détruit pas le CVD. Nettoyer ensuite seulement les ressources de test nommées et confirmées par l’opérateur. Consigner build, host package, versions et captures privées ; ne jamais prétendre tester cela sur le Mac actuel.

Rapport final attendu : fichiers implémentés, commandes de validation et compte réel des tests, fonctionnalités testées par doubles, recettes matérielles non exécutées, chemin concret du premier essai. « Support Cuttlefish implémenté, recette Linux à exécuter » est acceptable ; « ferme cloud multiclient publique prête » ne l’est pas.

## 10. Sources officielles consultées et attribution

Consultation le 23 octobre 2026 ; préserver les licences et distinguer consultation, dépendance et intégration. Le code de notre adaptateur ne recopie pas les projets entiers.

- [UIAutomator2 README](https://github.com/openatx/uiautomator2/blob/3.7.0/README.md), [code SDK](https://github.com/openatx/uiautomator2/blob/3.7.0/uiautomator2/__init__.py), [cycle du serveur](https://github.com/openatx/uiautomator2/blob/3.7.0/uiautomator2/core.py), [MIT](https://github.com/openatx/uiautomator2/blob/3.7.0/LICENSE). Dépendance Python prévue ; les API et la version 3.7.0 ont été contrôlées.
- [scrcpy sélection d’appareil](https://github.com/Genymobile/scrcpy/blob/v5.0.1/doc/connection.md), [lecture seule et presse-papiers](https://github.com/Genymobile/scrcpy/blob/v5.0.1/doc/control.md), [vidéo](https://github.com/Genymobile/scrcpy/blob/v5.0.1/doc/video.md), [Apache-2.0](https://github.com/Genymobile/scrcpy/blob/v5.0.1/LICENSE). Exécutable externe, pas un lecteur web intégré.
- [AOSP Cuttlefish Get started](https://source.android.com/docs/devices/cuttlefish/get-started) : KVM, images/host package de même build, accès ADB.
- [android-cuttlefish](https://github.com/google/android-cuttlefish), révision consultée `47f39f4dfe4fec442a59a099d8d5b61087119a61` : outils d’hôte, packages, groupes KVM ; [README](https://github.com/google/android-cuttlefish/blob/47f39f4dfe4fec442a59a099d8d5b61087119a61/README.md).
- [Cloud Android Orchestration](https://github.com/google/cloud-android-orchestration), révision consultée `4de2e0453682f91d6beb39b29f7c3fb06b9cb094`, Apache-2.0 ; [cvdr](https://github.com/google/cloud-android-orchestration/blob/4de2e0453682f91d6beb39b29f7c3fb06b9cb094/docs/cvdr.md), [code des commandes et flags](https://github.com/google/cloud-android-orchestration/blob/4de2e0453682f91d6beb39b29f7c3fb06b9cb094/pkg/cli/cli.go), [configuration cvdr](https://github.com/google/cloud-android-orchestration/blob/4de2e0453682f91d6beb39b29f7c3fb06b9cb094/scripts/on-premises/single-server/cvdr.toml), [limites on-premises](https://github.com/google/cloud-android-orchestration/blob/4de2e0453682f91d6beb39b29f7c3fb06b9cb094/scripts/on-premises/single-server/README.md). Outils externes réellement appelés ; aucune API REST supposée.
