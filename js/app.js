/* ==========================================================================
   Invitation de mariage - logique applicative
   --------------------------------------------------------------------------
   Reconstruction locale de https://invitation-jerome-melissa.vercel.app/

   Le script d'origine (8 Ko minifies, inline dans le <body>) est reecrit ici
   en modules lisibles, sans changer le comportement observable :

     1. Configuration      : chargement de config.json (source unique des
                             donnees : prenoms, date, programme, lieu, medias).
     2. Applcation DOM     : projection de la configuration sur la page.
     3. Audio              : bascule son + contournement autoplay.
     4. Scene d'ouverture  : video d'enveloppe -> fondu -> carte.
     5. Compte a rebours   : Jours / Heures / Minutes / Secondes.
     6. Animations scroll  : IntersectionObserver + rose qui suit le programme.
     7. RSVP               : <dialog> native + persistance localStorage.
     8. Rejouer            : reinitialisation complete de l'ouverture.

   Aucune dependance externe : le site d'origine n'en a aucune non plus.
   ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   1. Configuration
   --------------------------------------------------------------------------
   Source unique de verite : config.json.
   Priorite de chargement :
     1. window.__INVITATION_CONFIG__  (genere par tools/inline_config.py,
        pour un deploiement statique ou une ouverture en file://)
     2. fetch('config.json')           (serveur local, mode developpement)
   Si aucun des deux ne repond, le script continue sur les valeurs deja
   presentes dans le HTML (marqueurs "fallback") afin que la page ne soit
   jamais cassee.
   -------------------------------------------------------------------------- */

const CONFIG_URL = 'config.json';

/** Configuration effective, completee au fur et a mesure du chargement. */
const CONFIG = {};

/** Valeurs techniques de repli (utilisees seulement si la config est absente). */
const FALLBACK = {
  countdownTarget: '2027-09-27T15:00:00-04:00',
  countdownLabels: ['JOURS', 'HEURES', 'MINUTES', 'SECONDES'],
  revealDurationMs: 550,
  blendStartSeconds: 2.3,
  blendEndSeconds: 3.3,
  watchdogMs: 8000,
  musicVolume: 0.55,
  storageKey: 'jm-rsvp',
  soundIconOn: '🔊',
  soundIconOff: '🔇'
};

/**
 * Lecture d'une valeur par chemin point ("couple.partnerOne").
 * @param {string} path
 * @returns {*} Valeur trouvee ou undefined.
 */
function configValue(path) {
  return path.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return acc[key];
  }, CONFIG);
}

/**
 * Fusion profonde de la configuration chargee dans CONFIG.
 * Les sections deja presentes sont conservees si la source n'en fournit pas.
 * @param {object} source
 * @param {object} [target] Cible de la fusion (CONFIG par defaut).
 * @returns {object} La cible fusionnee.
 */
function mergeConfig(source, target = CONFIG) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      mergeConfig(value, target[key]);
    } else {
      target[key] = value;
    }
  }
  return target;
}

/**
 * Charge config.json (ou la version inlinee) puis projette la configuration
 * sur le DOM. Ne leve jamais : en cas d'echec, les valeurs fallback du HTML
 * restent affichees.
 * @returns {Promise<void>}
 */
async function loadConfig() {
  let loaded = false;

  // 1. config.json : source de verite. Prioritaire car il est toujours a jour.
  try {
    const response = await fetch(CONFIG_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    mergeConfig(await response.json());
    loaded = true;
  } catch (error) {
    console.warn(
      '[invitation] config.json illisible (' + error.message + '), repli inline puis HTML.'
    );
  }

  // 2. Version inlinee (generee par tools/inline_config.py) : sert a une
  //    ouverture directe en file://, ou fetch() est bloque par le navigateur.
  if (!loaded && window.__INVITATION_CONFIG__) {
    mergeConfig(window.__INVITATION_CONFIG__);
    loaded = true;
  }

  if (!loaded) {
    console.warn('[invitation] aucune configuration chargee, valeurs HTML conservees.');
    return;
  }
  applyConfigToDom();
}

/* --------------------------------------------------------------------------
   2. Application de la configuration sur le DOM
   --------------------------------------------------------------------------
   Trois mechanisms, declenchees par attributs :
     data-cfg="chemin"          -> textContent
     data-cfg-html="chemin"     -> innerHTML (tableaux joints par <br>)
     data-cfg-attr="attr:chemin"-> setAttribute
   -------------------------------------------------------------------------- */

/**
 * Convertit une valeur de configuration en texte affichable (textContent).
 * Un tableau devient une liste de lignes separees par un retour a la ligne.
 * @param {*} value
 * @returns {string}
 */
function toText(value) {
  if (Array.isArray(value)) return value.join('\n');
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Convertit une valeur de configuration en HTML affichable (innerHTML).
 * Un tableau devient des lignes separees par un <br>.
 *
 * Note securite : innerHTML n'est utilise qu'avec le contenu de config.json,
 * fichier local ecrit par le proprietaire du template (jamais une saisie
 * utilisateur ni une donnee distante). Les saisies du formulaire RSVP ne
 * sont jamais injectees en HTML.
 * @param {*} value
 * @returns {string}
 */
function toHtml(value) {
  if (Array.isArray(value)) return value.join('<br>');
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Projette CONFIG sur les elements du document.
 */
function applyConfigToDom() {
  document.querySelectorAll('[data-cfg]').forEach((element) => {
    const value = configValue(element.dataset.cfg);
    if (value !== undefined) element.textContent = toText(value);
  });

  document.querySelectorAll('[data-cfg-html]').forEach((element) => {
    const value = configValue(element.dataset.cfgHtml);
    if (value !== undefined) element.innerHTML = toHtml(value);
  });

  document.querySelectorAll('[data-cfg-attr]').forEach((element) => {
    const [attribute, path] = element.dataset.cfgAttr.split(':');
    const value = configValue(path);
    if (value !== undefined) element.setAttribute(attribute, toText(value));
  });

  // Liste d'elements repetes : config.program.events -> .event
  document.querySelectorAll('[data-cfg-list]').forEach((container) => {
    const items = configValue(container.dataset.cfgList);
    if (!Array.isArray(items)) return;
    const rose = container.querySelector('.timeline-rose');
    container.querySelectorAll('.event').forEach((event) => event.remove());
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'event';
      const time = document.createElement('time');
      time.textContent = item.time;
      const dot = document.createElement('i');
      const label = document.createElement('span');
      label.innerHTML = toHtml(item.label);
      row.append(time, dot, label);
      container.append(row);
    }
    if (rose) container.prepend(rose);
  });

  // Variables CSS d'assets : URL absolues pour fonctionner quel que soit
  // le fichier qui les consomme (css/style.css ou style inline).
  const assetMap = {
    '--asset-garden': 'garden',
    '--asset-paper-grain': 'paperGrain',
    '--asset-envelope': 'envelopeRealistic',
    '--asset-floral': 'floralCorner'
  };
  for (const [variable, key] of Object.entries(assetMap)) {
    const path = configValue('assets.' + key);
    if (path) {
      document.documentElement.style.setProperty(
        variable,
        'url("' + new URL(path, document.baseURI).href + '")'
      );
    }
  }

  // Polices : on regenere les declarations @font-face si la config les change.
  const fonts = configValue('assets.fonts');
  if (fonts && typeof fonts === 'object') {
    const rules = Object.entries(fonts)
      .map(([family, face]) =>
        '@font-face{font-family:' + family + ';src:url("' +
        new URL(face.src, document.baseURI).href + '") format("' + face.format +
        '");font-display:swap;font-weight:400}'
      )
      .join('\n');
    const style = document.createElement('style');
    style.id = 'config-fonts';
    style.textContent = rules;
    document.head.append(style);
  }
}

/* --------------------------------------------------------------------------
   References DOM
   -------------------------------------------------------------------------- */

const envelope = document.getElementById('envelope');
const invitation = document.getElementById('invitation');
const openingVideo = document.getElementById('opening-video');
const openButton = document.getElementById('open');
const skipButton = document.getElementById('skip-opening');
const status = document.getElementById('opening-status');
const interiorVideo = document.getElementById('interior-video');
const music = document.getElementById('wedding-music');
const soundToggle = document.getElementById('sound-toggle');
const dialog = document.getElementById('dialog');
const form = document.getElementById('form');
const successPanel = document.getElementById('success');

/** Drapeaux d'etat de la sequence d'ouverture. */
const state = {
  interiorFrameReady: false,
  interiorStarting: false,
  opening: false,
  revealed: false,
  openingWatchdog: null,
  frameRequest: null
};

/** Interpolation douce (smoothstep) : derivee de 0 a 1 sans rupture de pente. */
const smoothstep = (value) => value * value * (3 - 2 * value);

/* --------------------------------------------------------------------------
   3. Audio : contournement de la politique d'autoplay
   --------------------------------------------------------------------------
   Le click sur l'enveloppe est le seul geste utilisateur admissible : on
   demarre la musique dans ce gestionnaire, ce qui unlock l'element <audio>.
   -------------------------------------------------------------------------- */

/** Volume de la piste musicale. */
music.volume = configValue('sound.volume') ?? FALLBACK.musicVolume;

/**
 * Met a jour l'icone et les attributs ARIA du bouton de son.
 */
function updateSound() {
  const playing = !music.paused && !music.muted;
  soundToggle.textContent = playing
    ? (configValue('sound.iconOn') ?? FALLBACK.soundIconOn)
    : (configValue('sound.iconOff') ?? FALLBACK.soundIconOff);
  soundToggle.setAttribute(
    'aria-label',
    playing
      ? (configValue('sound.ariaLabelOn') ?? 'Couper la musique')
      : (configValue('sound.ariaLabelOff') ?? 'Activer la musique')
  );
  soundToggle.setAttribute('aria-pressed', String(playing));
}

/**
 * Demarre la musique. Appele uniquement depuis un geste utilisateur.
 */
function startMusic() {
  soundToggle.hidden = false;
  music.play().then(updateSound).catch(updateSound);
}

soundToggle.onclick = () => {
  if (music.paused) {
    startMusic();
  } else {
    music.pause();
    updateSound();
  }
};

music.addEventListener('pause', updateSound);
music.addEventListener('play', updateSound);

/* --------------------------------------------------------------------------
   4. Scene d'ouverture : video d'enveloppe -> fondu -> carte
   -------------------------------------------------------------------------- */

// Le lecteur interieur reste muet : il n'estvisible qu'apres le fondu.
for (const element of [interiorVideo]) {
  element.muted = true;
  element.defaultMuted = true;
}

/**
 * Recalcule la position de la scene video pour qu'elle soit alignee
 * exactement sur la carte (hero) situee dans le flux de la page.
 */
function alignScene() {
  const rect = document.querySelector('.card-hero').getBoundingClientRect();
  const style = document.documentElement.style;
  style.setProperty('--scene-x', rect.x + 'px');
  style.setProperty('--scene-y', rect.y + 'px');
  style.setProperty('--scene-width', rect.width + 'px');
  style.setProperty('--scene-height', rect.height + 'px');
}

alignScene();
addEventListener('resize', alignScene);

/**
 * Positionne le fondu entre l'overlay d'ouverture et la carte.
 * @param {number} progress Valeur brute 0..1 (avant smoothstep).
 */
function setBlend(progress) {
  const eased = smoothstep(Math.min(1, Math.max(0, progress)));
  envelope.style.setProperty('--card-progress', eased);
  envelope.style.opacity = 1 - eased;
}

/**
 * Demarre la lecture du video interieur et attend sa premiere image affichee
 * pour ne pas produire de flash noir pendant le fondu.
 */
function startInterior() {
  if (state.interiorStarting) return;
  state.interiorStarting = true;
  interiorVideo.play()
    .then(() => {
      if (interiorVideo.requestVideoFrameCallback) {
        interiorVideo.requestVideoFrameCallback(() => {
          state.interiorFrameReady = true;
        });
      } else {
        state.interiorFrameReady = true;
      }
    })
    .catch(() => {
      state.interiorStarting = false;
    });
}

/**
 * Boucle de fondu : pilote --card-progress depuis le temps de lecture de la
 * video d'ouverture, jusqu'a la bascule vers la carte.
 */
function blendWithVideo() {
  if (!state.opening || state.revealed) return;

  const start = configValue('opening.blendStartSeconds') ?? FALLBACK.blendStartSeconds;
  const end = configValue('opening.blendEndSeconds') ?? FALLBACK.blendEndSeconds;

  if (openingVideo.currentTime >= start) startInterior();

  // On attend la premiere image du clip interieur avant de commencer le fondu.
  if (openingVideo.currentTime >= start && !state.interiorFrameReady) {
    state.frameRequest = requestAnimationFrame(blendWithVideo);
    return;
  }

  setBlend((openingVideo.currentTime - start) / (end - start));

  if (openingVideo.currentTime >= end) {
    completeHandoff();
    return;
  }
  state.frameRequest = requestAnimationFrame(blendWithVideo);
}

/**
 * Bascule definitive : la page devient interactive, l'overlay s'efface.
 */
function completeHandoff() {
  if (state.revealed) return;
  state.revealed = true;
  clearTimeout(state.openingWatchdog);
  cancelAnimationFrame(state.frameRequest);
  setBlend(1);
  invitation.inert = false;
  document.body.classList.remove('locked');
  envelope.classList.add('is-revealed');
  openingVideo.pause();
  interiorVideo.play().catch(() => {});
}

/**
 * Revelation alternative : termine le fondu en cours (fin de video ou
 * bouton "Passer l'animation") sur une duree fixe.
 */
async function revealInvitation() {
  clearTimeout(state.openingWatchdog);
  skipButton.hidden = true;
  status.hidden = true;

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    completeHandoff();
    return;
  }

  const initial = Number(envelope.style.getPropertyValue('--card-progress')) || 0;
  if (initial >= 0.999) {
    completeHandoff();
    return;
  }

  cancelAnimationFrame(state.frameRequest);
  const duration = configValue('opening.revealDurationMs') ?? FALLBACK.revealDurationMs;
  const began = performance.now();

  function settle(now) {
    if (state.revealed) return;
    const progress = Math.min(1, (now - began) / duration);
    const blend = initial + (1 - initial) * smoothstep(progress);
    envelope.style.setProperty('--card-progress', blend);
    envelope.style.opacity = 1 - blend;
    if (progress < 1) {
      state.frameRequest = requestAnimationFrame(settle);
    } else {
      completeHandoff();
    }
  }
  state.frameRequest = requestAnimationFrame(settle);
}

/**
 * Clic sur l'enveloppe : demarre la musique et l'animation d'ouverture.
 */
openButton.onclick = async () => {
  if (state.opening) return;
  state.opening = true;
  document.body.classList.add('invitation-opening');
  startMusic();

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    revealInvitation();
    return;
  }

  envelope.classList.add('is-playing');
  skipButton.hidden = false;

  // Filet de securite : si la video met trop longtemps a demarrer, on
  // propose de passer l'animation.
  state.openingWatchdog = setTimeout(() => {
    status.textContent = configValue('opening.statusLoading')
      ?? 'Le chargement prend un instant. Vous pouvez passer l’animation.';
    status.hidden = false;
  }, configValue('opening.watchdogMs') ?? FALLBACK.watchdogMs);

  try {
    await openingVideo.play();
    blendWithVideo();
  } catch {
    state.opening = false;
    envelope.classList.remove('is-playing');
    status.textContent = configValue('opening.statusRetry')
      ?? 'Touchez l’enveloppe pour réessayer, ou passez l’animation.';
    status.hidden = false;
  }
};

openingVideo.addEventListener('ended', revealInvitation);
openingVideo.addEventListener('error', () => {
  skipButton.hidden = false;
  status.textContent = configValue('opening.statusUnavailable')
    ?? 'L’animation est indisponible. Vous pouvez ouvrir la carte directement.';
  status.hidden = false;
});
skipButton.onclick = revealInvitation;

/**
 * Bouton "Revoir l'ouverture" : reinitialise l'ensemble de la sequence.
 */
document.getElementById('replay').onclick = () => {
  clearTimeout(state.openingWatchdog);
  cancelAnimationFrame(state.frameRequest);
  openingVideo.pause();
  openingVideo.currentTime = 0;
  state.opening = false;
  state.revealed = false;
  state.interiorFrameReady = false;
  state.interiorStarting = false;
  interiorVideo.pause();
  interiorVideo.currentTime = 0;
  setBlend(0);
  status.hidden = true;
  skipButton.hidden = true;
  scrollTo({ top: 0, left: 0, behavior: 'instant' });
  invitation.inert = true;
  document.body.classList.remove('invitation-opening');
  document.body.classList.add('locked');
  alignScene();
  envelope.classList.remove('is-revealed', 'is-playing');
  openButton.focus({ preventScroll: true });
};

/* Pause / reprise des videos selon la visibilite de l'onglet et du hero. */
new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!state.revealed) return;
    if (entry.isIntersecting) {
      interiorVideo.play().catch(() => {});
    } else {
      interiorVideo.pause();
    }
  });
}, { threshold: 0 }).observe(document.querySelector('.card-hero'));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    openingVideo.pause();
    interiorVideo.pause();
  } else if (state.opening && !state.revealed) {
    openingVideo.play().then(blendWithVideo).catch(() => {});
  } else if (state.revealed) {
    interiorVideo.play().catch(() => {});
  }
});

/* Apparition des sections au defilement. */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));

/* --------------------------------------------------------------------------
   5. Compte a rebours
   -------------------------------------------------------------------------- */

const countElement = document.getElementById('count');

/**
 * Recalcule et affiche le compte a rebours.
 */
function tick() {
  const target = configValue('event.countdownTarget') ?? FALLBACK.countdownTarget;
  const labels = configValue('event.countdownLabels') ?? FALLBACK.countdownLabels;
  const seconds = Math.max(0, Math.floor((new Date(target) - Date.now()) / 1000));
  const values = [
    Math.floor(seconds / 86400),
    Math.floor(seconds / 3600) % 24,
    Math.floor(seconds / 60) % 60,
    seconds % 60
  ];
  countElement.replaceChildren();
  values.forEach((value, index) => {
    const cell = document.createElement('div');
    const number = document.createElement('b');
    number.textContent = String(value).padStart(2, '0');
    const label = document.createElement('small');
    label.textContent = labels[index];
    cell.append(number, label);
    countElement.append(cell);
  });
}

tick();
setInterval(tick, 1000);

/* --------------------------------------------------------------------------
   6. Rose mobile du programme
   -------------------------------------------------------------------------- */

const roseTimeline = document.querySelector('.timeline');
const movingRose = document.querySelector('.timeline-rose');
let roseFrame = 0;

/**
 * Liste des etapes du programme.
 * Elle est relue a chaque acces : config.json peut reconstruire la liste
 * apres coup, et la rose doit suivre les nouveaux elements.
 * @returns {HTMLElement[]}
 */
function roseEvents() {
  return [...roseTimeline.querySelectorAll('.event')];
}

/**
 * Positionne la rose sur l'etape du programme la plus proche du centre de
 * l'ecran et marque cette etape comme courante.
 */
function updateRose() {
  roseFrame = 0;
  const box = roseTimeline.getBoundingClientRect();
  if (box.bottom < 0 || box.top > innerHeight) return;

  const events = roseEvents();
  if (!events.length) return;

  const positions = events.map((row) => row.offsetTop + row.offsetHeight / 2);
  const first = positions[0];
  const last = positions[positions.length - 1];
  const y = Math.max(first, Math.min(last, innerHeight * 0.52 - box.top));

  movingRose.style.top = y + 'px';

  let nearest = 0;
  positions.forEach((position, index) => {
    if (Math.abs(position - y) < Math.abs(positions[nearest] - y)) nearest = index;
  });
  events.forEach((row, index) => {
    row.classList.toggle('is-current', index === nearest);
    if (index === nearest) {
      row.setAttribute('aria-current', 'step');
    } else {
      row.removeAttribute('aria-current');
    }
  });
}

/**
 * Planifie le recalcul de la rose sur la prochaine frame (anti-spam).
 */
function requestRose() {
  if (!roseFrame) roseFrame = requestAnimationFrame(updateRose);
}

addEventListener('scroll', requestRose, { passive: true });
addEventListener('resize', requestRose);
addEventListener('load', requestRose);
new ResizeObserver(requestRose).observe(roseTimeline);
updateRose();

/* --------------------------------------------------------------------------
   7. RSVP : <dialog> native + persistance locale
   -------------------------------------------------------------------------- */

document.getElementById('rsvp').onclick = () => dialog.showModal();
document.getElementById('close').onclick = () => dialog.close();
document.getElementById('done').onclick = () => dialog.close();

// Fermeture au clic sur le fond (et non dans la boite).
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    const outside =
      event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) dialog.close();
  }
});

// Le nombre d'invites n'a de sens que si la personne vient.
document.getElementById('attendance').onchange = (event) => {
  document.getElementById('guests').disabled = event.target.value === 'no';
};

form.onsubmit = (event) => {
  event.preventDefault();
  const response = Object.fromEntries(new FormData(event.target));
  const key = configValue('dialog.storageKey') ?? FALLBACK.storageKey;
  try {
    localStorage.setItem(key, JSON.stringify(response));
    form.hidden = true;
    successPanel.hidden = false;
  } catch {
    alert(configValue('dialog.storageError')
      ?? 'Le stockage local est indisponible dans ce navigateur.');
  }
};

/* --------------------------------------------------------------------------
   8. Amorcage
   -------------------------------------------------------------------------- */

loadConfig().then(() => {
  // La configuration peut modifier le volume ou les libelles du compte a
  // rebours : on relance un tick et on rafraichit le son.
  music.volume = configValue('sound.volume') ?? FALLBACK.musicVolume;
  tick();
  updateSound();
});
