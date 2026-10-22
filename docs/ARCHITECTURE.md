# Architecture et chemin vers un cloud

```text
GETA / STROWGER ou tout orchestrateur
            │ SDK Python / HTTP
            ▼
       Lease Broker (un seul processus)
       identité · capacité · TTL · audit
            │
    ┌───────┼───────────────┐
    ▼       ▼               ▼
Chromium  Docker Linux    ADB Android
processus  conteneur      appareil enregistré
  dédié    éphémère       données persistantes
```

## La valeur du projet

Le contrat de réservation est commun ; les capacités et garanties restent spécifiques à chaque provider. Une lease est une autorisation temporaire, pas une promesse d’isolation matérielle universelle. Éviter de distribuer directement un endpoint CDP, VNC ou ADB : il permettrait de contourner la révocation du broker.

Le code local ne dépend pas du moteur d’un agent : une intégration mince dans GETA/STROWGER suffit. Il ne remplace pas l’orchestrateur, la mémoire ou les outils métier.

## Limites connues de 0.3

- Un seul processus Uvicorn ; pas de `--workers 2`, pas de mode reload pour un service en cours. Plusieurs processus peuvent réserver le même téléphone.
- Le registre des leases est en mémoire. Pas de reprise après crash, de facturation, de file distribuée ou d’idempotency key d’acquisition. Un retry après une réponse perdue peut créer un second lease.
- Un SIGKILL peut laisser un Chromium ou un conteneur orphelin. Les conteneurs portent `strowger.managed=true` : inspection possible avec `docker ps -a --filter label=strowger.managed=true`. Vérifier chaque ressource avant un nettoyage manuel.
- Chromium utilise le réseau et le noyau de l’hôte. Pas de réseau filtré, pas de proxy egress, pas d’isolation contre des agents hostiles. Le desktop a le réseau désactivé mais partage le noyau Docker. Android n’est pas réinitialisé.
- Pas de TLS, de quotas par tenant, de rate limiting ou de protection des très gros corps HTTP. Écoute loopback uniquement dans le quickstart.
- Le journal est synchrone, local et sans rotation. Il n’est pas une preuve infalsifiable. Une erreur d’écriture doit être traitée par l’opérateur.
- Une capacité déclarée comme activée ne signifie pas que le provider est en bonne santé : le provisionnement peut renvoyer 503.
- Le serveur n’est pas un serveur MCP. Les écrans MCP de la maquette PhoneUse sont des éléments visuels, pas un endpoint STROWGER disponible.

## Jalons de réalisation

1. **Socle reproductible (cette version)** : lease/auth/TTL, navigateur réel, desktop Linux réel, adaptateur Android, tests et exemples.
2. **Validation Android** : appareil de laboratoire, session exclusive, capture, tap, déconnexion à mi-action et restitution documentée. Émulateur jetable avant appareils physiques partagés.
3. **Workers séparés** : broker sans accès direct au Docker hôte, registre PostgreSQL, verrou par ressource et fencing token. Provisionnement idempotent et réconciliation après panne.
4. **Isolation** : réseau filtré, limites par tenant, workers en VM/microVM, secrets par mission, images épinglées et chaîne de mise à jour. Windows en VM dédiée avec licences vérifiées.
5. **Cloud fermé puis public** : authentification utilisateur, facturation mesurée, budgets, observabilité, procédures de support, sauvegarde et reprise. Valider ces garanties avant de proposer des SLA.
6. **Téléphone physique robotisé** : hardware original, calibration, contrôleur indépendant, caméra, retour d’action et arrêt d’urgence. La 3D marketing n’est pas une validation de ce matériel. iOS nécessite un chantier distinct.

## Acquisition commerciale proposée

Le runtime gratuit peut servir de point d’entrée : tutoriel reproductible → premier environnement local → intégration d’un agent → besoin réel de parallélisme et d’hébergement → offre cloud gérée. Publier le code et ses limites avant de vendre une flotte. Aucun tarif commercial n’est validé ici ; les prix de la maquette restent du contenu source illustratif.

La console opérateur est servie par le broker sur `/`, avec code de lancement à usage unique et cookie HttpOnly local. Elle utilise les mêmes routes de leases que le SDK. Le verrou du lanceur CLI protège un même dossier de données ; les leases et sessions restent en mémoire.
