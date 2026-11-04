# Charte d'OpenFlyover : « Ligne de crête »

Votre sortie, vue d'en haut.

OpenFlyover transforme une trace GPS en film de survol en 3D : le relief, la météo du jour, la caméra, les textes et la musique, montés sur une timeline puis exportés en vidéo. La charte part de ce que le logiciel fait et de son logo, une ligne de crête tracée d'un seul trait avec un point de balise au sommet.

## L'idée : la ligne de crête

Le logo tient en quatre éléments, et la charte n'en ajoute pas d'autre.

| Élément du logo | Couleur | Ce qu'il devient dans l'interface |
| --- | --- | --- |
| Le fond, une tuile aux coins arrondis | Encre `#1C2A33` | Les barres, le rail, la timeline : le cadre sombre autour de l'image |
| La crête, un trait continu | Crème `#F5F2EA` | Les panneaux de réglages, le texte posé sur l'encre |
| L'itinéraire, un trait plus fin dans la vallée | Glacier `#A9CCD9` | Ce qui accompagne : texte secondaire sur l'encre, plans de la timeline, sélection discrète |
| Le point au sommet | Balise `#FF5A36` | Ce qui compte maintenant : l'action principale, la tête de lecture, le repère, la sélection |

## Principes

1. **Une seule balise.** L'orange marque un point, jamais une surface : l'action principale d'un écran, la tête de lecture, le repère sur la trace, l'onglet ouvert. Une zone de l'écran porte une balise, pas plusieurs. Un bloc orange plein n'existe que pour le bouton principal (« Exporter »).
2. **Le trait plutôt que la surface.** Comme le logo, l'interface dessine avec des lignes de 2 px aux bouts arrondis : icônes, profils d'altitude, traces, filets. Peu d'ombres, aucun dégradé décoratif.
3. **Lisible comme une carte.** Les étiquettes et les chiffres empruntent aux cartes topographiques : capitales condensées pour les titres de section, chiffres tabulaires, unités normalisées avec leur espace (12,6 km, 2 394 m, 30°, 01:11).
4. **L'image d'abord.** L'encre s'efface autour de la vue 3D ; la couleur est réservée au film et à la balise. Les couleurs des traces et l'accent choisi dans « Réglages » restent ceux de la personne.

## Couleurs

Chaque rôle a une valeur en thème clair (panneaux crème) et en thème sombre (panneaux encre) ; les variables sont listées à la fin (« Dans le code »). Les barres, le rail et la timeline sont en encre dans les deux thèmes.

- **Encre** (`encre`, `encre-relief`) : le cadre. `encre-relief` pour ce qui flotte au-dessus (menus, bulles, messages).
- **Crème** (`surface`, `surface-carte`, `creme`) : les panneaux et le texte sur l'encre.
- **Glacier** (`glacier`, `glacier-profond`) : l'accompagnement. `glacier-profond` pour un lien ou une information sur la crème.
- **Balise** (`balise`, `balise-action`, `sur-balise`) : l'action. `balise` sur l'encre (contraste 4,7:1), `balise-action` pour un bouton ou un texte d'action sur la crème (5,2:1), `sur-balise` pour le texte posé dessus.
- **États** (`mousse`, `ambre`, `erreur`) : réussi, attention (réglage lourd, valeur modifiée), erreur. Jamais pour décorer.

Tout texte atteint 4,5:1 sur son fond, dans les deux thèmes. Deux couleurs qu'il faut distinguer diffèrent par leur clarté, pas seulement par leur teinte.

## Typographie

Deux familles, chacune à sa place : IBM Plex pour l'interface, Barlow pour ce qui se lit sur la carte.

- **IBM Plex Sans** : toute l'interface (corps 14 px, aides 12 px, titres de réglage 16 px semi-gras).
- **IBM Plex Sans Condensed** : les titres de section en capitales espacées (comme les noms de massifs sur une carte), les étiquettes courtes, les chiffres des lectures (temps, distance, altitude), toujours en chiffres tabulaires.

- **Barlow Semi Condensed**, demi-gras et gras : la police de la carte et de l'habillage. Dessinée d'après la signalétique routière, elle se lit vite, de loin et par-dessus une image ; condensée, elle fait tenir les longs noms (« Pic de la Coumette d'Aygues Tortes »). Elle sert aux étiquettes posées sur le relief (sommets, cols, lacs, repères), aux titres et aux chiffres de l'habillage (compteurs, carte d'ouverture et de clôture, affiche). Toujours sur un fond d'encre ou avec son contour, jamais en corps de texte dans l'interface.

Fraunces quitte l'interface. Elle reste parmi les polices proposées pour les textes des films, qui appartiennent à la personne, comme Barlow, Plex et les autres.

Les tailles suivent la taille de l'écran : une seule échelle, proportionnelle au plus petit côté (`clamp(13px, 10.85px + 0.735vmin, 16px)`), avec des planchers de lisibilité (11 px pour une étiquette, 13 px pour le corps, 36 px pour une cible tactile).

## Formes et motifs

- **Rayons** : 4 px (étiquettes), 6 px (boutons, champs), 8 px (cartes, blocs de la timeline), 12 px (feuilles). La tuile du logo garde son rayon de 22 %.
- **Le profil d'altitude** : le motif propre au logiciel. Il habille le bloc du vol sur la timeline, le bandeau du film, l'affiche.
- **Les courbes de niveau** : quelques lignes fines en glacier sur l'encre, pour l'écran d'accueil et les états vides. Jamais derrière un texte long.
- **Le point de balise** : un disque plein de 10 px, cerclé d'encre sur un fond clair. C'est la tête de lecture, le repère d'un lieu, la pastille d'un onglet.

## Iconographie

Les icônes de Lucide (licence ISC), au trait de 2 px aux bouts arrondis comme le logo, sur une grille de 24 px, affichées à 20 px (18 dans une barre dense). Une icône seule porte toujours un nom accessible. Pas d'icône en couleur pleine, sauf la balise.

## L'icône de l'application

L'icône reprend le logo en verre dépoli : la crête est en verre crème, l'itinéraire en verre glacier, et la balise reste orange. Derrière elles, de fines courbes de niveau très pâles s'effacent vers les bords de la tuile d'encre, sous une lueur douce centrée sur le sommet.

En dessous de 64 px, l'icône redevient le logo plat sur la tuile d'encre, sans courbes ni verre, pour rester lisible dans un onglet ou une barre des tâches. Le verre et les dégradés restent réservés à l'icône : l'interface garde ses aplats.

Les sources sont dans `src-tauri/icons/source/` pour la version pleine et la version Android, et dans `public/favicon.svg` pour la version plate.

## Ton

Le français d'abord, quatre autres langues ensuite. Des phrases courtes, à la voix active, avec le vocabulaire du terrain : trace, survol, arrêt, crête, col, dénivelé. Guillemets français et espaces insécables. Pas de point d'exclamation, pas de promesse : on dit ce que fait le bouton.

- Oui : « Exporter la vidéo », « Ajouter un arrêt à la tête de lecture », « 2 394 m ».
- Non : « Lancez-vous ! », « Super export », « 2394m ».

## À éviter

- L'orange en aplat de surface, ou plus d'une balise dans la même zone.
- Une couleur qui ne vient pas de ces jetons (hors couleurs des traces et accent choisi par la personne).
- Les dégradés, ombres lourdes et effets de verre dans l'interface (seule l'icône de l'application y fait exception).
- Un texte sur une photo ou sur la vue 3D sans fond d'encre.

## Dans le code

| Rôle de la charte | Variable de `src/ui/theme.css` | Valeur |
| --- | --- | --- |
| Encre | `--color-ink` | `#1C2A33` |
| Crème | `--color-paper` | `#F5F2EA` |
| Glacier | `--color-glacier` | `#A9CCD9` |
| Balise sur l'encre | `--color-accent-light` | `#FF5A36` |
| Balise sur la crème (action) | `--color-accent` | `#B8361A` (blanc dessus : 5,9:1) |
| Mousse, ambre | `--color-moss`, `--color-amber` (et `-light`) | voir `ARCHITECTURE.md` |

La police des titres est `--font-heading` (IBM Plex Sans Condensed), celle de la carte et de l'habillage `barlow` dans `OVERLAY_FONT_IDS`. L'accent par défaut est la balise ; « Réglages » › « Apparence » permet toujours d'en choisir un autre. Le logo plat : `public/favicon.svg`. L'icône en verre : `src-tauri/icons/source/`.
