# Sources et attribution

Consultées le 22 octobre 2026 :

- [Playwright — browser contexts](https://playwright.dev/python/docs/browser-contexts) : bibliothèque réellement intégrée pour Chromium ; Apache-2.0. Le runtime crée ici un processus par lease avec son contexte.
- [Android Debug Bridge](https://developer.android.com/tools/adb) : outil externe requis pour l’adaptateur Android ; aucune copie d’ADB embarquée.
- [AIO Sandbox](https://github.com/agent-infra/sandbox) : référence d’environnement combiné, Apache-2.0 déclaré dans le dépôt ; consulté, pas cloné ni intégré.
- [Stagehand](https://github.com/browserbase/stagehand) : SDK navigateur, MIT déclaré ; consulté, pas intégré.
- [Maestro](https://github.com/mobile-dev-inc/Maestro) : automatisation mobile, Apache-2.0 déclaré ; consulté, pas intégré.
- Desktop : image Debian + Xvfb + Fluxbox + xterm + xdotool + ImageMagick. Les logiciels de l’image conservent leurs licences respectives ; le Dockerfile ne les relicencie pas. Image construite localement sur ARM64 ; build AMD64 non exécuté ici.
- [PhoneUse](https://www.phoneuse.com/) : référence du site explicitement demandée. Crawl Firecrawl du domaine principal : quatre pages, plus inventaire de cinq URL. Les sous-domaines docs/console et les parcours authentifiés ne sont pas un crawl exhaustif. HTML/CSS/modules/modèle GLB/polices/assets téléchargés pour reproduction locale. Les vidéos et la marque source appartiennent à leurs titulaires. Aucune licence libre de la création PhoneUse n’a été établie ; ne pas redistribuer ce miroir comme du code STROWGER sous MIT.

La présence d’un fichier accessible publiquement ne vaut pas autorisation de réutilisation ou de redistribution. La nouvelle implémentation du broker et du SDK est distincte du miroir visuel.
