# Aywhoula : code source de l'interface

Ce dépôt contient le code source de l'interface web d'[Aywhoula](https://aywhoula.com), l'application de prévisions de vagues et de vent ([app.aywhoula.com](https://app.aywhoula.com)). Il est publié sous licence GNU GPL version 2 (fichier `LICENSE`).

## Pourquoi ce code est public

L'interface intègre le lecteur de grilles d'Open-Meteo (`@openmeteo/file-reader` et `@openmeteo/file-format-wasm`), distribué sous licence GPL-2.0-only. Le code de l'interface envoyé aux navigateurs est donc publié sous la même licence.

## Contenu

`src/`, `public/`, `scripts/` et les fichiers de construction (Vite). Le serveur d'Aywhoula, la vitrine aywhoula.com et les services tiers ne font pas partie de ce dépôt. L'interface attend son API sous `/api`, sur la même origine.

Chaque commit correspond à une version mise en ligne.

## Construire

Node 22 ou plus récent :

```bash
npm ci
npm run build   # sortie dans dist/
```

## Données et marque

- Prévisions : [Open-Meteo](https://open-meteo.com), sous licence CC BY 4.0.
- Fond de carte : © les contributeurs d'OpenStreetMap (ODbL), tuiles servies par OpenFreeMap.
- Le nom Aywhoula, le logo et les icônes ne sont pas couverts par la licence du code : ils restent la propriété de l'éditeur.

Copyright (C) 2026 Guillaume Zehren.
