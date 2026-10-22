# Sources et attribution

Consultées le 22 octobre 2026 :

Intégrations du runtime 0.4.0, consultées le 23 octobre 2026 :

- [UIAutomator2 3.7.0](https://github.com/openatx/uiautomator2/tree/3.7.0), [README](https://github.com/openatx/uiautomator2/blob/3.7.0/README.md), [code SDK](https://github.com/openatx/uiautomator2/blob/3.7.0/uiautomator2/__init__.py), [licence MIT](https://github.com/openatx/uiautomator2/blob/3.7.0/LICENSE) : dépendance Python facultative utilisée dans un worker distinct par lease pour l’arbre UI et les sélecteurs. Le code du projet ne copie pas le SDK.
- [scrcpy v5.0.1](https://github.com/Genymobile/scrcpy/tree/v5.0.1), [connexion et sélection d’appareil](https://github.com/Genymobile/scrcpy/blob/v5.0.1/doc/connection.md), [contrôle et presse-papiers](https://github.com/Genymobile/scrcpy/blob/v5.0.1/doc/control.md), [licence Apache-2.0](https://github.com/Genymobile/scrcpy/blob/v5.0.1/LICENSE) : exécutable hôte externe appelé avec une commande fixe en mode sans contrôle. Aucun flux web n’est intégré.
- [AOSP Cuttlefish — démarrage](https://source.android.com/docs/devices/cuttlefish/get-started) et [android-cuttlefish](https://github.com/google/android-cuttlefish) : références de l’hôte KVM, des images et des transports ADB. Consultation seulement pour le projet.
- [Cloud Android Orchestration](https://github.com/google/cloud-android-orchestration/tree/4de2e0453682f91d6beb39b29f7c3fb06b9cb094), [cvdr](https://github.com/google/cloud-android-orchestration/blob/4de2e0453682f91d6beb39b29f7c3fb06b9cb094/docs/cvdr.md), [codes des commandes](https://github.com/google/cloud-android-orchestration/blob/4de2e0453682f91d6beb39b29f7c3fb06b9cb094/pkg/cli/cli.go) et [limites on-premises](https://github.com/google/cloud-android-orchestration/blob/4de2e0453682f91d6beb39b29f7c3fb06b9cb094/scripts/on-premises/single-server/README.md) : wrapper opérateur autour de `cvdr list/create` et fournisseur de pool préprovisionné. Le dépôt est Apache-2.0. Le CLI a été compilé et ses options de création vérifiées; aucune VM Cuttlefish n’a été créée pendant cette recette.

Ces projets sont des dépendances externes ou des références documentaires; les licences ne sont pas transférées aux composants externes.

- [Playwright — browser contexts](https://playwright.dev/python/docs/browser-contexts) : bibliothèque réellement intégrée pour Chromium ; Apache-2.0. Le runtime crée ici un processus par lease avec son contexte.
- [Android Debug Bridge](https://developer.android.com/tools/adb) : outil externe requis pour l’adaptateur Android ; aucune copie d’ADB embarquée.
- [AIO Sandbox](https://github.com/agent-infra/sandbox) : référence d’environnement combiné, Apache-2.0 déclaré dans le dépôt ; consulté, pas cloné ni intégré.
- [Stagehand](https://github.com/browserbase/stagehand) : SDK navigateur, MIT déclaré ; consulté, pas intégré.
- [Maestro](https://github.com/mobile-dev-inc/Maestro) : automatisation mobile, Apache-2.0 déclaré ; consulté, pas intégré.
- Desktop : image Debian + Xvfb + Fluxbox + xterm + xdotool + ImageMagick. Les logiciels de l’image conservent leurs licences respectives ; le Dockerfile ne les relicencie pas. Image construite localement sur ARM64 ; build AMD64 non exécuté ici.
- [PhoneUse](https://www.phoneuse.com/) : référence du site explicitement demandée. Crawl Firecrawl du domaine principal : quatre pages, plus inventaire de cinq URL. Les sous-domaines docs/console et les parcours authentifiés ne sont pas un crawl exhaustif. HTML/CSS/modules/modèle GLB/polices/assets téléchargés pour reproduction locale. Les vidéos et la marque source appartiennent à leurs titulaires. Aucune licence libre de la création PhoneUse n’a été établie ; ne pas redistribuer ce miroir comme du code STROWGER sous MIT.

La présence d’un fichier accessible publiquement ne vaut pas autorisation de réutilisation ou de redistribution. La nouvelle implémentation du broker et du SDK est distincte du miroir visuel.
