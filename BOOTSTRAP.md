# Projet : RPG HD-2D voxel — Étapes 1 & 2 (socle + map multi-niveaux)

## Contexte
Jeu de rôle 2.5D, terrain en blocs multi-niveaux (avec des hauteurs qui se chevauchent : ponts, tunnels, grottes), sprites 2D HD en billboard plus tard.
Cible : navigateur d'abord, puis natif toutes plateformes.
Périmètre ici : étapes 1 et 2 uniquement. PAS de pathfinding, PAS de tokens, PAS de règles.

## Façon de travailler
- Avance étape par étape et ARRÊTE-TOI à la fin de chaque étape pour validation.
- Explique tes choix d'architecture avant de coder une étape, en quelques lignes.
- Tests unitaires sur tout ce qui est dans `core/`.

## Stack suggérée
- pnpm, Vite, TypeScript en mode strict
- Vue 3 pour la coquille de l'app (canvas + petit HUD de debug) => pas arrêté, si tu as mieux a proposer pour de l'UI de jeu vidéo je prends, mais moderne et maintenu
- Three.js avec `WebGPURenderer` (import depuis `three/webgpu`), bascule auto en WebGL 2 => Idem si tu as mieux j'écoute (babylon ?)
- Vitest, ESLint + Prettier

## Architecture (règle stricte)
- `src/core/` : TypeScript pur, ZÉRO import de three ou de vue (à faire respecter par une règle ESLint no-restricted-imports). Contient les données de map, les coordonnées, les générateurs de maps de test.
- `src/render/` : tout ce qui touche à Three (scène, caméra, meshing, picking). Lit `core`, ne le modifie jamais directement.
- `src/app/` : coquille, HUD, branchement des entrées.

## Conventions fixées
- Repère Three : Y vers le haut. Plan horizontal = (x, z).
- 1 case horizontale = 1 unité monde.
- Hauteur d'un voxel = 0,5 unité (demi-marche). Un « mur plein » d'une case de haut = 2 voxels empilés.
- Coordonnées voxel entières (x, y, z) ; y = niveau vertical (index de demi-hauteur).
- Chunks de 16 × 16 × 16 voxels, stockage creux (seuls les chunks non vides existent).
- Chaque voxel tient sur 16 bits : 8 bits matériau (0 = air), 4 bits forme, 4 bits orientation.
- Formes pour l'instant : PLEIN et PENTE (pente qui monte de 0,5 sur 1 case, 4 orientations N/E/S/O). Architecture prête pour ajouter d'autres formes ensuite.

## Étape 1 — Socle
1. Scaffolding du projet (stack ci-dessus), scripts dev / build / test / lint.
2. Scène Three avec WebGPURenderer, redimensionnement, boucle de rendu. Afficher dans le HUD le backend réellement utilisé (WebGPU ou WebGL 2).
3. Caméra orbitale façon RO : inclinaison verrouillée (~40°, réglable en config), rotation autour de la cible (libre + touches pour crans de 45°), zoom borné, déplacement de la cible (clic molette ou ZQSD).
4. Grille plate de 32 × 32 cases, lumière directionnelle + ambiante.
5. Picking : au survol, surbrillance de la case visée ; coordonnées affichées dans le HUD.

Critères d'acceptation :
- `pnpm dev` ouvre la scène, la caméra est agréable à manipuler.
- Le HUD indique le backend et la case survolée.
- Lint et tests passent.

## Étape 2 — Map en blocs multi-niveaux
1. `core` : structure de map chunkée (lecture/écriture d'un voxel par coordonnée monde, création paresseuse des chunks, itération sur les chunks non vides). Tests : lecture/écriture aux frontières de chunks, coordonnées négatives.
2. `core` : générateur de la MAP DE RÉFÉRENCE (déterministe), qui contient :
   - un sol de base
   - une rivière en tranchée, avec un chemin praticable le long de la berge basse
   - un pont qui enjambe la rivière ET passe au-dessus du chemin de berge (deux surfaces marchables sur la même colonne x,z : c'est LE cas à valider)
   - une falaise avec une rampe en pentes pour y monter
   - un tunnel traversant un relief
3. `render` : meshing par chunk avec suppression des faces cachées (greedy meshing plus tard, prévoir l'interface). Couleur par matériau (pas de textures pour l'instant). Les pentes ont leur propre géométrie.
4. `render` : picking par raycast sur les meshes de chunks. À partir du point d'impact et de la normale, retrouver le voxel touché et la SURFACE visée (dessus du voxel). Surbrillance de cette surface, coordonnées voxel dans le HUD.
5. Rebuild ciblé : modifier un voxel ne reconstruit que son chunk (et les voisins s'il est en bordure). Raccourci de debug : clic droit = retirer le voxel visé, Maj+clic = poser un voxel au-dessus.

Critères d'acceptation :
- La map de référence s'affiche, la caméra peut tourner autour.
- En visant le pont puis le chemin dessous, le HUD affiche deux surfaces différentes pour la même colonne (x, z).
- Le picking fonctionne sur les pentes et à l'intérieur du tunnel.
- Ajout/retrait de voxels à la souris, rebuild limité au chunk concerné.
- Tests `core` verts, lint vert.

## Hors périmètre (ne pas anticiper)
Graphe de navigation, A*, tokens, sprites, fondu d'occlusion, post-processing, éditeur, sauvegarde/chargement.

Ne pas tenir compte du nom du répertoire de travail, ce n'est PAS le nom du projet, il n'est pas encore défini.