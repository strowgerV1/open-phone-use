# Banc téléphones — prêt pour le premier essai

Préparation logicielle : 22 octobre 2026. Premier essai prévu le 23 octobre 2026.

Le pilote est préparé pour **jusqu’à six Android**, sans annoncer une capacité matérielle déjà validée. Les iPhone nécessiteront un autre adaptateur. Les téléphones restent débranchés pendant la préparation logicielle.

## Sur ce Mac

Le dossier contient le lanceur **Banc-telephones.command**. Double-cliquer pour ouvrir le menu dans Terminal. Le logiciel et les clés sont locaux ; aucune clé ne doit être copiée sur le site public ou dans GitHub.

Menu :

1. Diagnostic logiciel et USB, sans action sur l’écran.
2. Enregistrement des Android autorisés dans l’inventaire privé.
3. Ouverture de la console et démarrage du broker local sur `127.0.0.1:8876` (laisser ce Terminal ouvert).
4. Test volontaire de deux appareils : réservation, HOME, capture et libération.
5. Même test sur jusqu’à six appareils disponibles.
6. Construction et activation du bureau Linux (Docker requis), puis redémarrage du broker.

Les options 4 et 5 doivent être lancées dans un **second Terminal** après le démarrage du broker. Elles ramènent les appareils à l’écran d’accueil et enregistrent des captures : les lancer seulement quand les téléphones de laboratoire sont prêts.

## Disponible immédiatement

Option 3 ouvre la console connectée automatiquement. Réserver un navigateur, ouvrir la démonstration locale, remplir `#name`, cliquer sur `button`, puis libérer. Avec Docker prêt, l’option 6 active aussi le bureau Linux. La liste des téléphones reste vide jusqu’à leur enregistrement.

Dans une session Android, cliquer dans la capture envoie un tap ; glisser envoie un swipe. Les boutons Accueil/Retour et la saisie ASCII agissent sur le téléphone réservé. L’image peut se rafraîchir toutes les 2 secondes. Libérer les sessions avant l’arrêt.

## Demain, dans l’ordre

1. Brancher **deux Android dédiés** avec des câbles USB de données et un hub alimenté. Les déverrouiller et autoriser le débogage USB sur chacun.
2. Ouvrir le lanceur, option 1 : vérifier qu’ils apparaissent en état `device`. `unauthorized` demande une validation sur le téléphone, `offline` une vérification de connexion.
3. Option 2 : les nouveaux appareils reçoivent `phone-01`, `phone-02`, etc. Les identifiants et permissions déjà configurés sont conservés. Aucun appareil `unauthorized` n’est enregistré.
4. Option 3 : démarrer le broker. Dans un autre Terminal, relancer le lanceur et choisir 4.
5. Voir le résultat dans `data/runs/<date>/report.json` et ouvrir les images PNG pour vérifier visuellement quel téléphone a répondu.
6. Si le test de deux appareils réussit, arrêter proprement le broker (Ctrl+C), brancher les autres Android, refaire les options 1 et 2, redémarrer, puis choisir 5.
7. Vérifier le nombre **réellement testé** dans le rapport : `--limit 6` signifie « jusqu’à six disponibles », pas « six obligatoirement testés ». Une réservation garde un appareil exclusif le temps du test. Les données et connexions existantes ne sont pas effacées à la libération.

Aucune SIM, aucun compte client ni application personnelle n’est nécessaire pour HOME et capture. Ne pas mettre de comptes de clients dans ce premier banc. Les tests de déconnexion et de longue durée viendront après le premier passage sur deux appareils.

## Commandes équivalentes

Depuis ce dossier, le lanceur évite de saisir ces commandes :

```sh
.venv/bin/strowger doctor
.venv/bin/strowger enroll --owner alice --limit 6
.venv/bin/strowger serve --capacity 6 --port 8876 --open
# Dans un second terminal :
.venv/bin/strowger smoke --url http://127.0.0.1:8876 --limit 2
# Puis, après ajout des appareils et redémarrage :
.venv/bin/strowger smoke --url http://127.0.0.1:8876 --limit 6
```

Pour choisir un téléphone précis à l’enregistrement, ajouter `--serial IDENTIFIANT_USB` (option répétable). Le serial est un identifiant de matériel ; il reste dans `data/fleet.json`, ignoré par Git. Les états destinés aux agents utilisent les noms `phone-01` etc. sans exposer les serials.

## Reproduire sur un autre Mac

```sh
git clone https://github.com/strowgerV1/strowger-env.git
cd strowger-env
# Installer Android SDK Platform Tools depuis la source officielle
# ou avec Homebrew : brew install --cask android-platform-tools
sh scripts/preparer-pilote.sh
```

Le script crée l’environnement Python et les clés privées, conserve une configuration existante et installe Chromium. Le diagnostic peut être prêt côté logiciel avec zéro téléphone connecté : cela ne valide pas le matériel.

## Ce qui reste à prouver

Les tests automatisés simulent six appareils pour l’exclusivité, les droits et la restitution. Le diagnostic local vérifie l’installation d’ADB. Aucun appareil physique n’a été piloté pendant cette préparation. Le broker est mono-processus et son registre de leases est en mémoire ; ce banc n’est pas encore une offre cloud multi-client.
