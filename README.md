# Budgeny by Genyus Labs

Suivi de budget mensuel selon la règle **50 / 30 / 20** (besoins / envies / épargne), pensé pour le mobile.

- **Saisie rapide** des dépenses (pavé numérique, deux touches pour la catégorie).
- **Import du CSV BoursoBank** : aperçu, dédoublonnage automatique, classement mémorisé.
- **Base de données = un seul fichier JSON** que tu choisis (téléphone ou Google Drive) et qui est synchronisé automatiquement après chaque action. Plusieurs appareils peuvent partager le même fichier : la fusion se fait ligne par ligne.
- **Mises à jour** : l'appli vérifie les releases GitHub (réglages).

## Stack

HTML / CSS / JavaScript sans framework, empaqueté avec [Capacitor](https://capacitorjs.com) (Android maintenant, iOS possible plus tard).
Un plugin Java (`native/android/BudgenyFilePlugin.java`) fournit l'accès au fichier via le Storage Access Framework et l'ouverture du site de la banque dans le navigateur sans déclencher l'appli bancaire.

## Développement

```
npm test            # tests de la logique (modèle, import CSV, fusion)
npm run build:web   # copie l'appli dans www/
```

Le projet Android n'est pas versionné : il est généré à chaque build (`npx cap add android` puis `npm run android:setup`).

## Publier une version

Le workflow *Release APK* se déclenche sur un tag :

```
git tag v0.1.0
git push origin v0.1.0
```

Secrets GitHub pour un APK signé (sinon un APK debug est produit) : `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`.
Garde une copie de la clé de signature en dehors de GitHub : sans elle, impossible de mettre à jour l'appli installée.

## Confidentialité

Le dépôt est public : aucune donnée personnelle ne doit y figurer (exports CSV et fichiers `Budgeny_*.json` sont ignorés par Git). Les données ne vivent que dans le fichier JSON que tu choisis.
