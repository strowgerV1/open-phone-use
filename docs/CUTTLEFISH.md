# Utiliser un pool Android Cuttlefish

Strowger sait réserver des Cuttlefish déjà provisionnés et accessibles par ADB. Il ne crée ni ne supprime de VM à l’acquisition ou à la libération d’une lease. La commande `create` appelle le vrai CLI `cvdr` à la demande de l’opérateur ; elle est donc explicite et peut créer des ressources facturées par votre fournisseur d’infrastructure. Relisez le nom de l’hôte, le build ID et le nombre avant de l’exécuter.

## Rôles et limites

Cuttlefish nécessite un hôte Linux avec accélération KVM pour exécuter les appareils. Sur macOS, Strowger peut agir comme client d’un broker accessible par un tunnel privé, mais Docker Desktop ne fournit pas le rôle d’hôte KVM Cuttlefish. `strowger cuttlefish doctor` le signale séparément de la présence d’ADB et de `cvdr`.

La première version utilise un pool préparé à l’avance : l’opérateur configure le service Cloud Android Orchestration, crée un groupe avec `cvdr`, relève les transports ADB réels, puis inscrit manuellement chaque serial dans l’inventaire privé. `cvdr list` affiche une sortie destinée à l’opérateur, pas un format JSON stable que Strowger pourrait importer. Le broker ne déduit pas le tenant d’un appareil. Les appareils inscrits pour un tenant doivent lui être dédiés.

La lease sérialise les actions et sa fermeture renvoie Android à HOME. Elle n’efface pas les données et ne détruit pas le groupe Cuttlefish. Un échec ou un timeout après l’appel de `cvdr create` peut laisser l’état du fournisseur inconnu : vérifiez avec `strowger cuttlefish list` avant toute nouvelle tentative. La suppression éventuelle relève d’une maintenance opérateur explicite.

L’API Strowger reste sur loopback ou derrière un tunnel privé avec authentification. N’exposez pas les ports ADB 5037/5555, l’interface d’orchestration ni la console WebRTC native aux tenants. Une URL WebRTC native peut contourner les leases et les ACL ; aucun flux vidéo direct n’est publié par ce lot.

## Préparer un hôte Linux

Depuis la racine du dépôt, commencez par le diagnostic sans mutation :

```bash
bash scripts/prepare-cuttlefish-host.sh
```

Le script refuse le rôle hôte si `/dev/kvm` manque, distingue KVM présent et droits insuffisants, et affiche le plan avec la révision source épinglée. Sur macOS, il confirme que seul le rôle client est possible et ne modifie pas la machine.

Sur une machine Debian ou Ubuntu avec KVM, l’étape explicite `--apply` installe les outils système Git et curl depuis les dépôts configurés, ajoute l’utilisateur au groupe `kvm` existant si nécessaire, puis télécharge Go 1.27.3 dans le répertoire de build du projet en vérifiant son SHA-256 officiel. Cette version dépasse le minimum Go 1.22 déclaré par le commit source. Le script construit ensuite `cvdr` depuis le commit `4de2e0453682f91d6beb39b29f7c3fb06b9cb094` du dépôt officiel `google/cloud-android-orchestration` avec `go build ./cmd/cvdr`. Le checkout et le toolchain restent dans `build/cuttlefish/`; l’installation finale de `/usr/local/bin/cvdr` utilise `sudo`. Un checkout source existant n’est réutilisé que si son origine, son commit et son état propre correspondent. L’utilisateur doit ouvrir une nouvelle session pour obtenir les droits du groupe. Le script n’effectue aucun redémarrage et ne provisionne aucun hôte cloud ni CVD.

```bash
sudo -v
bash scripts/prepare-cuttlefish-host.sh --apply
```

Ce script prépare l’outil client `cvdr`. Pour déployer le service Cloud Android Orchestration on-premises, suivez le guide officiel de cette révision, qui décrit aussi la configuration KVM, les dépendances et le service. Le guide signale une limite actuelle pour plusieurs conteneurs x86_64 liée à `vhost_user_vsock`, ainsi que l’absence d’accélération GPU dans cette configuration. Validez la densité dans votre environnement ; utilisez un groupe multi-instance sur un hôte compatible ou plusieurs hôtes séparés.

L’alternative AOSP consiste à installer le package hôte et les images issus du même build, puis lancer `launch_cvd` selon la documentation AOSP. Cette voie est indépendante du wrapper `cvdr` intégré à Strowger ; elle ne doit pas mélanger des images et un package hôte de builds différents.

## Configurer cvdr et préparer le pool

Utilisez une configuration `cvdr.toml` correspondant au service d’orchestration choisi. Les exemples officiels se trouvent dans le dépôt `cloud-android-orchestration`, notamment `scripts/on-premises/single-server/cvdr.toml`. Gardez le fichier dans un emplacement privé, avec des droits `0600`, et ne placez aucune clé dans Git. Configurez le chemin sans demander à Strowger de créer ou modifier des comptes fournisseur :

```bash
chmod 600 /chemin/prive/cvdr.toml
export CVDR_USER_CONFIG_PATH=/chemin/prive/cvdr.toml
strowger cuttlefish doctor
```

`doctor` donne l’état local de l’OS, de KVM, de `cvdr`, d’ADB et des appareils déjà connectés. Il ne fait ni appel cloud ni création de ressource. La commande `list` appelle réellement `cvdr list` et exige un fichier de configuration existant :

```bash
strowger cuttlefish list --config /chemin/prive/cvdr.toml
```

Après avoir choisi un hôte existant, créez explicitement un groupe avec un build ID précis. Le nombre est limité à 64. Ne remplacez pas le build ID par une valeur mouvante telle que `latest`.

```bash
strowger cuttlefish create \
  --config /chemin/prive/cvdr.toml \
  --host cvd-host-prod-01 \
  --build-id 12345678 \
  --build-target aosp_cf_x86_64_phone-trunk_staging-userdebug \
  --count 2
```

Les arguments sont transmis en tableau au vrai exécutable `cvdr`, avec les noms de flags officiels `--host`, `--build_id`, `--build_target`, `--num_instances` et `--auto_connect=true`. L’hôte est obligatoire afin que `cvdr` ne crée pas un hôte implicitement. La réussite de la commande indique seulement que `cvdr` a terminé avec succès ; inspectez ensuite `list` et les transports ADB réellement annoncés.

Connectez les transports indiqués par `cvdr list` avec Android SDK Platform Tools. Pour un port local renvoyé sous la forme `127.0.0.1:33975`, par exemple :

```bash
adb connect 127.0.0.1:33975
adb devices -l
```

Le port de cet exemple n’est pas une valeur par défaut. Utilisez le port effectivement attribué à chaque appareil par votre service et gardez-le accessible uniquement depuis le réseau privé de l’opérateur.

## Inscrire explicitement les appareils

`enroll` ajoute uniquement le serial choisi et vérifie qu’ADB le voit dans l’état `device`. Répétez la commande pour chaque CVD, avec le propriétaire explicite :

```bash
strowger enroll --provider cuttlefish --automation uiautomator2 \
  --owner client-a --serial 127.0.0.1:33975
strowger enroll --provider cuttlefish --automation uiautomator2 \
  --owner client-a --serial 127.0.0.1:33976
```

Strowger crée un inventaire privé à permissions restrictives et préserve les entrées déjà présentes. Vérifiez le fichier `ENV_ANDROID_DEVICES_FILE`, puis redémarrez le broker. Lorsqu’UIAutomator2 est choisi, son adaptateur utilise le serial d’inventaire ; le contrôle de boot Cuttlefish est un contrôle ADB borné avant le démarrage du worker UIA. Avec `--automation adb`, les actions Android existantes sont exécutées par ADB.

La recette matérielle est volontaire et cible uniquement deux serials indiqués explicitement :

```bash
ENV_CUTTLEFISH_TEST=1 \
ENV_CUTTLEFISH_SERIALS='127.0.0.1:33975,127.0.0.1:33976' \
pytest -q tests/test_cuttlefish_hardware.py
```

Elle attend le boot, envoie HOME et vérifie une capture PNG. Elle ne vérifie pas une recette de déploiement de l’orchestrateur, ne supprime pas le groupe et n’efface pas les données. Ce test n’a pas été exécuté sur le Mac de développement ; il faut le lancer sur un client relié à deux Cuttlefish de test dédiés.

## Sources et attribution

Le wrapper appelle le binaire externe `cvdr` ; il ne copie pas le code de Google. Les flags et la variable de configuration suivent la révision officielle indiquée ci-dessous :

- [Cloud Android Orchestration, `cvdr` et configuration](https://github.com/google/cloud-android-orchestration/blob/4de2e0453682f91d6beb39b29f7c3fb06b9cb094/docs/cvdr.md)
- [Code officiel des commandes et flags `cvdr`](https://github.com/google/cloud-android-orchestration/blob/4de2e0453682f91d6beb39b29f7c3fb06b9cb094/pkg/cli/cli.go)
- [Dépôt Cloud Android Orchestration, commit épinglé](https://github.com/google/cloud-android-orchestration/tree/4de2e0453682f91d6beb39b29f7c3fb06b9cb094)
- [Go 1.27.3 et sommes SHA-256 officielles](https://go.dev/dl/)
- [Guide de démarrage AOSP Cuttlefish](https://source.android.com/docs/devices/cuttlefish/get-started)
- [Limites et déploiement on-premises](https://github.com/google/cloud-android-orchestration/blob/4de2e0453682f91d6beb39b29f7c3fb06b9cb094/scripts/on-premises/single-server/README.md)

La bibliothèque Strowger implémente un adaptateur ADB autour du protocole d’outils Android existant. Elle ne revendique ni service fournisseur connecté, ni validation matérielle sur ce poste.
