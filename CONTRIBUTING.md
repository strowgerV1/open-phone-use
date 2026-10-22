# Contribuer

Installer le quickstart puis lancer `pytest -q`. Toute modification d’un provider doit être accompagnée d’une vérification réelle de démarrage, action et nettoyage dans l’environnement concerné. Les tests utilisant `Fake` valident seulement le protocole.

Ouvrir une issue avec le résultat attendu, l’observation et les versions de Python/provider. Ne jamais inclure clés, tokens, screenshots de comptes privés ou contenu du téléphone personnel. Les corrections Android doivent préciser l’appareil utilisé et la procédure de restitution.

Priorités : validation Android, reprise après crash, quotas par identité, contrat de provider documenté, workers isolés. Toute fonctionnalité cloud ou iOS reste annoncée comme non disponible jusqu’à preuve d’exécution.

Le dossier `site/` est une étude de reproduction tierce ; l’utilisateur a confirmé ses autorisations de réutilisation, mais tout nouveau redistributeur doit respecter les droits applicables. La licence MIT du runtime ne s’applique pas à ce dossier.
