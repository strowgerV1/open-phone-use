# Exploiter une flotte par client

La version 0.4.0 sait attribuer un téléphone physique ou un Cuttlefish déjà joignable par ADB à une seule lease. Un job prend une lease et un appareil. Les jobs indépendants peuvent tourner en parallèle selon la capacité disponible. Le même téléphone ne peut pas être attribué à un job et à une lease directe en même temps.

## Deux clients, deux appareils

L’opérateur crée une clé distincte par client et réserve un appareil dédié à chaque clé. Gardez `.env`, `data/fleet.json`, le registre de quarantaine et les rapports de recette sur le broker, avec des permissions privées. Exemple de configuration fictive :

```dotenv
ENV_API_KEYS='{"client-a":"REMPLACER_PAR_UNE_CLE_PRIVEE_LONGUE_A","client-b":"REMPLACER_PAR_UNE_CLE_PRIVEE_LONGUE_B"}'
ENV_ANDROID_DEVICES_FILE='data/fleet.json'
ENV_CAPACITY='6'
ENV_JOB_LIMIT='64'
ENV_JOB_OWNER_LIMIT='16'
```

```json
[
  {"id":"phone-a-01","serial":"SERIAL_USB_A1","owners":["client-a"]},
  {"id":"phone-b-01","serial":"SERIAL_USB_B1","owners":["client-b"]}
]
```

Les exemples de serials sont des placeholders, jamais des valeurs à copier. Gardez un inventaire opérateur séparé qui rapproche chaque ID de l’étiquette du téléphone, du câble, du port et du serial. Pour inscrire des appareils physiques déjà autorisés dans ADB, lancer `strowger enroll --owner client-a --serial SERIAL_USB_A1`, puis répéter pour chaque appareil et son client. Cette commande préserve les IDs et ACL existants. Pour changer explicitement un backend déjà inscrit, ajouter `--update`; les appareils partagés sont refusés pour cette opération.

## Connexion matérielle et accès

Pour cinq ou six appareils, utiliser un hôte dédié avec des hubs USB alimentés qui transportent les données, des câbles testés et des ports étiquetés. Contrôler le débit total USB, l’alimentation, la chaleur et les déconnexions pendant un essai prolongé. Le nombre de ports annoncé par un hub ne prouve pas que le contrôleur hôte peut maintenir tous les transports ADB. La recette de cette version n’a pas été exécutée sur cinq ou six téléphones.

Le broker écoute sur loopback. Pour un agent situé sur un poste client autorisé à joindre le serveur par SSH, ouvrir un tunnel sur ce poste :

```sh
ssh -N -L 8876:127.0.0.1:8876 utilisateur@BROKER_HOST
```

Configurer alors `ENV_BROKER_URL=http://127.0.0.1:8876` pour l’agent. L’accès SSH doit passer par le réseau privé prévu et par des comptes individuels. Un VPN seul ne rend pas joignable un service qui écoute sur loopback; le tunnel aboutit au loopback du broker. Ne publiez pas directement l’API ou les ports ADB. L’opérateur attribue une clé seulement à l’agent prévu, stocke la clé dans l’environnement privé de cet agent et ne la met jamais dans un prompt de modèle. L’agent reçoit un ID public de device, jamais son serial. Le registre des leases est en mémoire et mono-processus ; ce n’est pas une offre SaaS publique ou multi-tenant durcie.

## Jobs déterministes et agents avec modèle externe

Un scénario déterministe peut soumettre un tableau d’étapes via `POST /v1/jobs`. Une étape contient uniquement une action Android publiée et ses arguments validés par le broker ; les scripts, imports, commandes shell et URLs réseau sont refusés. Le client conserve le `job_token` retourné une seule fois, envoie `X-Job-Token` pour lire ou annuler le job, puis supprime ce secret à la fin. Une annulation attend le nettoyage. Une action au résultat incertain laisse l’appareil en quarantaine jusqu’à une réconciliation opérateur.

Les agents qui raisonnent avec un modèle externe utilisent `AsyncRuntime` et appellent leur propre client de modèle dans une fonction de décision. Le modèle reçoit l’observation choisie par l’agent et un schéma d’actions ; il ne reçoit ni clé API, serial ni commande système. La boucle d’observation et d’action consomme le TTL du lease. Aucun fournisseur LLM n’est fourni par Strowger.

Les limites opérateur par défaut sont 64 jobs actifs ou en attente au total et 16 par propriétaire. Les jobs en file ne réservent pas un téléphone. Chaque job attend au plus 60 secondes une place libre après un refus de capacité; un appareil hors ligne échoue directement. La capacité globale est réglable par `ENV_CAPACITY` entre 1 et 64. Il n’existe pas de réservation atomique de plusieurs téléphones pour une mission.

## Cuttlefish préprovisionné

Sur un hôte Linux préparé avec KVM, l’opérateur crée explicitement un groupe à build déterminé via `strowger cuttlefish create`, relève ses serials avec `cvdr list`, puis inscrit chaque serial et son client avec `strowger enroll --provider cuttlefish --automation uiautomator2 --owner client-a --serial SERIAL_EXACT`. Le broker vérifie ADB et le boot Android pendant le démarrage du lease. Release revient à HOME et arrête les workers et viewers associés ; il ne détruit ni ne réinitialise le CVD.

Un groupe Cuttlefish partagé entre entreprises n’est pas une frontière d’isolation entre locataires. Utiliser un groupe ou des hôtes distincts par client et vérifier les limites de densité sur le matériel réel. La création, la facturation cloud, l’administration du tunnel ADB et la suppression des groupes restent des opérations de l’opérateur, pas des actions du bot.

## Validation et état de cette livraison

La suite automatisée utilise des providers factices pour vérifier l’ACL, l’exclusivité, la concurrence, les jobs, les annulations, l’observation locale scrcpy et la quarantaine persistante. Le poste de développement n’avait aucun téléphone connecté et n’est pas un hôte Linux KVM. Les essais avec appareils physiques et pool Cuttlefish sont des recettes opt-in à exécuter avant toute promesse opérationnelle ou commerciale.
