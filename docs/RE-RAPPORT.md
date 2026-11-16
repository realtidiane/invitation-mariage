# Rapport de rétro-ingénierie — invitation Jérôme & Mélissa

**Cible** : `https://invitation-jerome-melissa.vercel.app/` (page unique, Vercel, CSS + JS inline)
**Date** : 16 novembre 2026
**Outils** : `curl` (extraction réseau), REA / Reverse Engineer Anything (analyse statique du bundle JS), Chrome headless + puppeteer-core (vérification runtime et comparaison pixel), Pillow (métriques pixel)

---

## 1. Phase 1 — Extraction des assets

Le site d'origine est une **page unique** : un seul `index.html` de 37 858 octets contenant un bloc `<style>` inline (23 195 octets) et un bloc `<script>` inline (8 073 octets). Aucune dépendance externe, aucun framework, aucune police Google Fonts.

### 1.1 Inventaire des ressources

| Fichier | Type | Taille | Dimensions | Référencé par |
|---|---|---|---|---|
| `opening-mobile.mp4` | MP4 (H.264) | 302 752 o | — | `<source>` du clip d'ouverture |
| `envelope-poster.jpg` | JPEG | 42 699 o | 716×1280 | `poster` du clip d'ouverture |
| `interior-mobile.mp4` | MP4 (H.264) | 733 295 o | — | `<video>` du hero (`?v=7`) |
| `interior-poster.jpg` | JPEG | 61 717 o | 540×958 | `poster` du hero |
| `music-from-36.mp3` | MP3 64 kbps | 4 834 025 o | 223 s | `<audio id="wedding-music">` |
| `timeline-rose.png` | PNG RGBA | 1 744 114 o | 1275×1234 | `.timeline-rose` |
| `couple-africain.png` | PNG RGB | 3 070 593 o | 1024×1536 | `.couple-photo img` |
| `garden.png` | PNG RGB | 3 142 502 o | 1024×1536 | `url()` dans `.hero` (couché) |
| `floral-corner.png` | PNG RGBA | 1 961 673 o | 1536×1024 | `url()` dans `.closing-flowers` |
| `envelope-realistic.png` | PNG RGB | 2 971 731 o | 852×1846 | `url()` dans `.paper`/`.fold` (couches mortes) |
| `paper-grain.svg` | SVG | 342 o | — | `background-image` des `.paper-panel` |
| `beau-rivage.woff` | WOFF | 128 812 o | — | `@font-face` `BeauRivage` |
| `imperial-script.woff` | WOFF | 79 580 o | — | `@font-face` `ImperialScript` |
| `ovo.woff2` | WOFF2 | 18 800 o | — | `@font-face` `Ovo` |

**Total : 19 Mo, 14 fichiers.**

### 1.2 Vérifications de complétude

- Les seules références `url()` du CSS sont : `garden.png`, `paper-grain.svg`, `envelope-realistic.png`, `floral-corner.png`, plus les 3 polices. **Toutes récupérées.**
- Pas de variante desktop (`opening-desktop.mp4` / `interior-desktop.mp4` → **404** sur l'original) : le site n'est décliné que pour mobile (largeur 390–393 px).
- Pas de `robots.txt`, `sitemap.xml`, `manifest.json`, `favicon.ico`, ni d'API (`/api/` → 404). Le serveur est un Vercel statique (`X-Vercel-Cache: HIT`, `Access-Control-Allow-Origin: *`).

---

## 2. Phase 2 — Traçage de la machine à états

Source : `extracted.js` (8 073 o), analysé statiquement par REA (`analyze_javascript_application`, evidence `ev_b37bd5de28087e52673c018e66690e27d4c968ad1c4bd97758a304550e1ded6d` — 1 fichier JS parsé, 1 650 nœuds AST, 535 relations data-flow, 134 closures, 5 timers, couverture applicative complète, 427 inconnus sémantiques).

### 2.1 Séquence d'ouverture de l'enveloppe (Intro Gate)

```
État initial
  body.classList = "locked"            → overflow:hidden sur le body
  main#invitation[inert]                → contenu inaccessible (clavier + AT)
  .video-envelope visible (z-index 20)

Clic sur #open
  ├─ opening = true                     (garde anti double-clic)
  ├─ body.classList += "invitation-opening"
  ├─ startMusic()                       → music.play() DANS le handler de clic
  │                                        = contournement de la politique autoplay
  ├─ si prefers-reduced-motion: reduce → revealInvitation() et retour
  ├─ envelope.classList += "is-playing" → masque le bouton (z-index 4)
  ├─ skipButton.hidden = false          → "Passer l'animation"
  └─ openingWatchdog = setTimeout(8000) → message "Le chargement prend un instant..."
       │
       └─ await openingVideo.play()  ──▶  blendWithVideo()   [rAF]
            │
            ├─ t ≥ 2.3 s  → startInterior()
            │                 └─ interiorVideo.play()
            │                    └─ requestVideoFrameCallback → interiorFrameReady = true
            │                       (attend la 1re image peinte : évite le flash noir)
            ├─ setBlend((currentTime − 2.3) / 1)
            │    └─ --card-progress = smoothstep(p) = p²(3−2p)
            │       opacity de .video-envelope = 1 − eased
            └─ t ≥ 3.3 s  → completeHandoff()
```

`completeHandoff()` : `revealed = true`, annule le watchdog et la rAF, `setBlend(1)`, `invitation.inert = false`, `body.classList.remove('locked')`, `envelope.classList.add('is-revealed')` (→ `opacity:0; visibility:hidden`), `openingVideo.pause()`, `interiorVideo.play()`.

**Sorties alternatives** de la séquence :
- `ended` sur la vidéo → `revealInvitation()` : interpolates `--card-progress` de sa valeur courante à 1 sur **550 ms** (`smoothstep`), puis `completeHandoff()`.
- Bouton "Passer l'animation" → même `revealInvitation()`.
- `error` sur la vidéo → message "L'animation est indisponible…" + affichage du bouton de skip.
- Échec de `openingVideo.play()` → `opening = false`, retrait de `is-playing`, message "Touchez l'enveloppe pour réessayer…".

**Détail d'alignement** : `alignScene()` mesure `getBoundingClientRect()` de `.card-hero` et publie `--scene-x/y/width/height` sur `:root`. La `.opening-stage` est positionnée en absolu sur ces variables : l'overlay d'ouverture est ainsi **exactement superposé à la carte** à venir, ce qui rend la transition invisible.

### 2.2 Moteur de compte à rebours

```js
const seconds = Math.max(0, Math.floor((new Date('2027-09-27T15:00:00-04:00') - Date.now()) / 1000));
values = [Jours, Heures%24, Minutes%60, Secondes%60]
```

- Cible : **2027-09-27 à 15:00, décalage −04:00** (Montréal, EDT) — et non la simple date `datetime="2027-09-27"` du `<time>`.
- Rendu : 4 `<div>` contenant `<b>NN</b>` (padding 2 chiffres) + `<small>JOURS|HEURES|MINUTES|SECONDES</small>`, séparés par `:` en CSS (`.count > div:not(:last-child):after`).
- `tick()` immédiat + `setInterval(tick, 1000)`.
- Le compteur tourne **avant** l'ouverture de l'enveloppe (le JS est en fin de `<body>`).

### 2.3 Animations au scroll

- **Apparition des sections** : `IntersectionObserver` à `threshold: 0.1` sur `.reveal` → ajout de `.visible` puis `unobserve` (une seule fois). Transition CSS : `opacity 1s, transform 1s`, depuis `opacity:0; translateY(24px)`.
- **Rose mobile du programme** : `<img class="timeline-rose">` positionnée en absolu (`left:46%`, `transform: translate(-50%,-50%)`). À chaque frame, `updateRose()` :
  1. rejette le calcul si la timeline est hors écran ;
  2. calcule la position verticale de chaque `.event` (`offsetTop + offsetHeight/2`) ;
  3. cible `y = clamp(innerHeight × 0.52 − box.top, premièrePosition, dernièrePosition)` ;
  4. applique `movingRose.style.top = y + 'px'` ;
  5. marque l'événement le plus proche `.is-current` (+ `aria-current="step"`) — le `<i>` (puce losange) disparaît alors en `opacity 0`.
- Déclenchements : `scroll` (passive), `resize`, `load`, et un `ResizeObserver` sur `.timeline`. Réfection coalescée via `requestAnimationFrame` (variable `roseFrame`).
- **Vidéo du hero** : une seconde `IntersectionObserver` sur `.card-hero` (threshold 0) joue/met en pause `interior-video` selon qu'elle entre dans le viewport — la vidéo ne tourne que sur le hero.

### 2.4 Système RSVP (`<dialog>`)

- `<dialog id="dialog">` **natif**, ouvert via `showModal()` depuis `#rsvp`.
- Fermeture : bouton `#close`, bouton `#done` (dans le panneau de succès), et **clic sur le fond** — détecté en comparant `event.clientX/Y` au `getBoundingClientRect()` du dialogue (le clic sur le `<dialog>` lui-même ne suffit pas).
- Champs : `name` (text, required), `attendance` (select `yes`/`no`), `guests` (number 1–12), `song` (text), `message` (textarea).
- `attendance.onchange` → `guests.disabled = (value === 'no')`.
- Soumission : `preventDefault()`, `Object.fromEntries(new FormData(form))`, `localStorage.setItem('jm-rsvp', JSON.stringify(response))`, puis masquage du formulaire et affichage de `#success` (« Merci pour votre petit mot »).
- Format stocké : `{"name":"…","attendance":"yes","guests":"1","song":"…","message":"…"}` — **toutes les valeurs en chaînes**, y compris `guests`.
- En cas d'échec de `localStorage` (navigation privée, quota) : `alert("Le stockage local est indisponible dans ce navigateur…")`.
- Note : l'original **ne relit jamais** `localStorage` au chargement — une réponse déjà enregistrée n'est pas restaurée à la visite suivante.

### 2.5 Design system CSS

Le CSS d'origine est une **cascade de 7 couches appendues** (chaque bloc surcharge le précédent) — c'est la trace d'un développement itératif, pas un design system unifié. Reconstruction conservée à l'identique.

| Couche | Contenu |
|---|---|
| 1 | Design system de base : `--rose:#eedbd5`, `--ink:#654a45`, `--wine:#681d32`, `--gold:#b58c58` ; `main` centré 600 px ; sections `.section` ; `.ornament` (❦) ; `.torn` (clip-path) |
| 2 | Recalages iPhone 14 (390×844) : `main` 390 px, `.hero` en `100svh`, `dialog` 366 px, `input/select/textarea` à 16 px |
| 3 | Scène alignée : `--scene-x/y/width/height`, `.opening-card` en fondu via `--card-progress`, `.card-hero` en `100svh` |
| 4 | Recalages iPhone 14/15 : `main` 393 px, `.sound-toggle` repositionné |
| 5 | Direction artistique finale : `--ivory:#f8efdf`, `--ink:#89725f`, `--gold:#ad842f`, `--wine:#650c23` ; `.paper-panel` avec `clip-path` de 64 points (bords déchirés) ; `.floral-panel` |
| 6 | Lecteur vidéo intérieur persistant |
| 7 | Couverture viewport + crossfade composite iOS (`100dvh`, `overscroll-behavior:none`) |

**Typographie** (3 polices locales, pas de CDN) :
- `Ovo` (WOFF2) — corps de texte, chiffres du compteur
- `ImperialScript` (WOFF) — titres de section (`.script`), lettrage du hero
- `BeauRivage` (WOFF) — prénoms du hero (72 px desktop / mobile)
- `Great Vibes` / `Cormorant Garamond` — déclarées en fallback mais **jamais chargées** (polices système uniquement)

**Palette finale** : ivoire `#f8efdf` (fond), encre `#89725f` (texte), or `#ad842f` (titres, prénoms), bordeaux `#650c23` (bouton submit, sceau), papier `#f0e5d2` (panneaux `.paper-panel`).

**Responsive** : une seule media query de rupture à **600 px**. En dessous : carte 390–393 px centrée, padding réduit, typographie réduite. Au-dessus : carte 600 px max, padding vertical 24 px, hero 844 px, largeur `<dialog>` 92 %/480 px.

---

## 3. Phase 3 — Reconstruction

Dossier `invitation-mariage/` :

```
invitation-mariage/
├── index.html              structure sémantique + liaisons data-cfg
├── config.json             SOURCE UNIQUE des données (16 sections)
├── css/style.css           1 746 lignes, cascade d'origine vérifiée
├── js/app.js               24 ko, dé-minifié et documenté
├── js/config-inline.js     repli file:// (généré)
└── assets/                 14 médias + fonts/ (3 polices)
```

### 3.1 Le template configurable (`config.json`)

Toutes les données en dur de l'original ont été extraites dans **un seul fichier**. Le HTML porte des liaisons declaratives :

| Attribut | Effet |
|---|---|
| `data-cfg="chemin"` | `textContent` |
| `data-cfg-html="chemin"` | `innerHTML` (tableaux joints par `<br>`) |
| `data-cfg-attr="attr:chemin"` | `setAttribute` |
| `data-cfg-list="chemin"` | reconstruit une liste d'éléments (`.event`) |

Sections de `config.json` : `meta`, `couple`, `event`, `hero`, `opening`, `intro`, `program`, `venue`, `details`, `attendance`, `dialog`, `footer`, `sound`, `assets`.

Les chemins d'images référencés par le CSS passent par des variables `--asset-*` (définies en bloc 8 du CSS), redéfinies par `app.js` depuis `config.assets` — le visuel est donc changeable sans toucher au CSS. Les polices sont re-déclarées dynamiquement via une balise `<style>` injectée.

**Double chargement** : `app.js` tente `fetch('config.json')` (source de vérité, toujours à jour) et bascule sur `window.__INVITATION_CONFIG__` (copie générée par `tools/inline_config.py`) quand `fetch` est bloqué — cas d'une ouverture en `file://`. Si les deux échouent, le HTML conserve ses valeurs de repli.

### 3.2 Vérification d'équivalence du CSS

`tools/build_css.py` régénère `css/style.css` depuis le CSS extrait (source/pretty.css), puis **compare le corps normalisé** (espaces et commentaires retirés) à la source :

```
OK : corps CSS genere equivalent a la source (meme ordre de regles)
```

Les seules transformations : chemins d'images → variables `--asset-*`, chemins de polices → `../assets/fonts/…`, commentaires d'origine → en-têtes de section documentés.

---

## 4. Phase 4 — Exécution et vérification

**Serveur local** : `python -m http.server 8123 --bind 127.0.0.1` (le port 8080 était déjà occupé par un autre service sur cette machine).

### 4.1 Ressources HTTP

Les 19 ressources demandées répondent **200** ; les requêtes de_ranges sur les médias renvoient **206 Partial Content** :

```
/                          200      /assets/interior-mobile.mp4?v=7   206
/css/style.css             200      /assets/music-from-36.mp3         206
/config.json               200      /assets/opening-mobile.mp4        200
/js/app.js                 200      /assets/timeline-rose.png         200
/js/config-inline.js       200      /assets/couple-africain.png       200
/assets/envelope-poster.jpg 200    /assets/garden.png                200
/assets/interior-poster.jpg 200    /assets/floral-corner.png         200
/assets/paper-grain.svg    200      /assets/envelope-realistic.png    200
/assets/fonts/*.woff|woff2 200     (3 polices)
```

**Erreurs console : 0.** Le seul `requestfailed` (`music-from-36.mp3 :: net::ERR_ABORTED`) est un range-request interrompu par la boucle du lecteur audio à la fermeture de la page — vérifié : après 4 s, `readyState=4`, `currentTime=3.97 s`, `duration=223 s`, `volume=0.55`, `paused=false`, `error=null`.

> Note : le site d'origine renvoie un **404** sur `/favicon.ico` (2 erreurs console). La reconstruction ajoute un favicon SVG en data-URI → **0 erreur console**, seule différence assumée.

### 4.2 Parcours interactif complet

| Étape | Résultat observé |
|---|---|
| Clic enveloppe | `body="locked invitation-opening"`, `envelope="video-envelope is-playing"`, skip visible, bouton son visible, vidéo d'ouverture en lecture |
| Fin de séquence | `envelope="… is-revealed"`, `main.inert=false`, `opacity=0`, vidéo hero en lecture |
| Compte à rebours | `314 JOURS 20 HEURES 09 MINUTES 05 SECONDES` → `…02 SECONDES` (réel, 1 Hz) |
| Scroll | 6/6 `.reveal` visibles, rose à `top:351px`, étape courante « 21 h La soirée dansante », 1 `aria-current="step"` |
| RSVP | dialogue ouvert, 5 champs, 2 options, stockage `{"name":"Test HERMES","attendance":"yes","guests":"12","song":"Aya Nakamura","message":"…"}`, panneau « Merci pour votre petit mot » |
| Rejouer | retour à `body="locked"`, `main.inert=true`, `envelope="video-envelope"`, `currentTime=0` |
| Bascule son | 🔇 / pause → 🔊 / reprise avec progression du temps |

### 4.3 Comparaison pixel vs site d'origine

Protocole : Chrome headless, viewport **390×844**, les deux pages ouvertes, séquence d'ouverture jouée, puis **clip intra**, **pause du clip intérieur à t=0** (pour que le rendu soit déterministe et ne dépende pas du décodage vidéo), capture de 6 sections.

**Métriques** (Pillow, différence canal par canal) :

| Section | Taille | Pixels comparés | Pixels modifiés | Identique |
|---|---|---|---|---|
| Hero | 390×844 | 329 160 | **0** | ✅ |
| Introduction | 390×390 | 152 100 | **0** | ✅ |
| Programme | 390×580 | 226 200 | **0** | ✅ |
| Lieu | 390×589 | 229 710 | **0** | ✅ |
| Tenue + cadeau | 390×416 | 162 240 | **0** | ✅ |
| RSVP | 390×1257 | 490 230 | **0** | ✅ |
| **Total** | | **1 589 100** | **0** | ✅ |

Les SHA-256 des PNG sont **identiques** pour les 6 paires. Les mesures géométriques (via `getBoundingClientRect()`) concordent aussi exactement : `main` 390×4406.33 px, hero 390×844, prénoms à x=39 / y=295.39, timeline à y=1626.92, lieu à y=2052.92, pied de page à y=4314.64, police `Ovo, Georgia, serif` 16 px, `main` background `rgb(248, 239, 223)`.

> La comparaison REA `compare_web_screenshots` a été sollicitée mais refuse les artefacts transmis inline (« digest or size mismatch ») ; l'équivalence est donc établie par les empreintes SHA-256 et les métriques locales, plus/password fortes que le différentiel pixel.

### 4.4 Test du template configurable

`config.json` modifié (noms, date, programme, lieu, lien Maps, cible du compteur, clé de stockage), page rechargée, puis configuration d'origine restaurée :

| Contrôle | Attendu | Obtenu |
|---|---|---|
| Prénoms | Awa / Moussa | ✅ |
| Date affichée | 14.06.28 | ✅ |
| Titre programme | Déroulé de la fête | ✅ |
| Lieu | Le Château des Palmiers | ✅ |
| Lien Maps | …/Chateau+des+Palmiers+Dakar | ✅ |
| Nombre d'étapes | 3 | ✅ |
| Libellés des étapes | Accueil / Dîner / Bal | ✅ |
| Signature | Awa & Moussa | ✅ |
| Compteur recalé | 314 j → 575 j | ✅ |
| Clé de stockage | `awa-moussa-rsvp` (ancienne clé vide) | ✅ |
| Restauration | retour aux valeurs d'origine | ✅ |

**12 contrôles sur 12.**

---

## 5. Résumé du fonctionnement interne

Le site est une **carte d'invitation statique à page unique**, sans back-end ni analytics. Toute l'interactivité tient dans 8 ko de JavaScript compact, et l'émotion est portée par trois films : une animation d'enveloppe de 3,3 s qui **se dissout exactement sur la carte** (l'overlay est repositionné à chaque `resize` sur la boîte réelle du hero, ce qui rend le fondu de deux plans parfaitement aligné), un clip de jardin animé en fond du hero, et une piste musicale de 223 s débloquée par le premier geste utilisateur.

Le compte à rebours et la rose qui suit le programme sont les deux détails qui donnent au template sa qualité de « papel de carta » : le premier donne l'échelle du temps qui reste, le second guide l'œil le long de la soirée. Le RSVP, lui, reste volontairement local — un `localStorage` sur l'appareil, avec un message d'erreur honnête quand le navigateur refuse.

La reconstruction est **pixel-identique** sur les 6 sections (1 589 100 pixels, 0 écart) et le passage en mode configurable se fait dans **un seul fichier** sans toucher au HTML, au CSS ni au JS.

---

## 6. Limites et inconnus

- L'équivalence pixel a été mesurée à **390×844** (iPhone 14). D'autres largeurs n'ont pas été comparées pixel à pixel, bien que la géométrie du hero, de la timeline et du pied de page concorde exactement.
- Le comparateur REA `compare_web_screenshots` n'a pas pu valider les captures (rejet des artefacts inline) ; l'équivalence repose sur SHA-256 et différentiel pixel local.
- L'analyse REA du bundle remonte 427 inconnus sémantiques sur les relations dynamiques (résolution de propriétés, branches non statiques) : le comportement observé à l'exécution est documenté, mais REA ne prouve pas l'exécution — les constats d'exécution proviennent du navigateur piloté.
- `prefers-reduced-motion: reduce` a été lu dans le code et traité comme une branche, mais les navigateurs headless ne l'activent pas par défaut : cette branche n'a pas été exercée en exécution réelle.
- La restauration d'une réponse RSVP déjà enregistrée (non présente dans l'original) reste optionnelle ; elle n'a pas été ajoutée pour rester fidèle.
