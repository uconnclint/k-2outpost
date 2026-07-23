// ============================================================
// SPACE BUILDERS — kid UI (K-2 free-build edition)
//
// Big pictures, few words, huge tap targets. Pure DOM.
//   • pick a category, tap a picture, then tap the moon to build
//   • Move / Turn / Erase tool buttons
//   • BLAST OFF a rocket, mute the sound, clear everything
// No numbers, no goals — just a friendly builder for little hands.
// ============================================================

import { state, events, demolish, buildingAt } from '../core/state.js';
import { CATEGORIES, BUILDINGS, BUILDINGS_BY_ID } from '../core/catalog.js';
import { audio } from '../core/audio.js';
import { voice } from '../core/voice.js';

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) {
    if (k === 'text') n.textContent = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else n.setAttribute(k, attrs[k]);
  }
  return n;
}

// ---- hand-made low-poly art icons (shared with the Outpost game) ----
// Vite bundles every png under assets/icons and hands back hashed URLs.
const ICON_URLS = import.meta.glob('../assets/icons/*.png', { eager: true, query: '?url', import: 'default' });
function iconUrl(name) {
  const hit = Object.entries(ICON_URLS).find(([k]) => k.endsWith('/' + name + '.png'));
  return hit ? hit[1] : null;
}
// An <img> for the named icon, or null if we don't have that art.
function iconImg(name, cls) {
  const url = name && iconUrl(name);
  if (!url) return null;
  const img = el('img', cls, { src: url, alt: '', draggable: 'false' });
  return img;
}
// Which art fronts each kid category tab.
const CAT_ICON = {
  homes: 'cat-habitat', power: 'cat-power', plants: 'cat-life', space: 'victory-rocket',
  fun: 'cat-civic', work: 'cat-industry', science: 'cat-science', roads: 'cat-transport',
};

export function initUI({ placementTool, launchRocket, clearAll }) {
  const root = document.getElementById('ui-root');
  if (!root) return;

  // ===========================================================
  // TOP-LEFT — title + "how many did I build?" star counter
  // ===========================================================
  const topbar = el('div', 'kid-topbar');
  const logo = el('div', 'kid-logo', { html: '🚀 <b>Space</b> Builders' });
  const counter = el('div', 'kid-counter', { title: 'Things you built' });
  const cStar = iconImg('cat-civic', 'kid-counter-star-img') || el('span', 'kid-counter-star', { text: '⭐' });
  const cNum = el('span', 'kid-counter-num', { text: '0' });
  counter.appendChild(cStar); counter.appendChild(cNum);
  topbar.appendChild(logo); topbar.appendChild(counter);
  root.appendChild(topbar);

  // ===========================================================
  // TOP-RIGHT — sound + clear everything
  // ===========================================================
  const actions = el('div', 'kid-actions');
  const soundBtn = el('button', 'kid-round', { 'aria-label': 'Sound on or off' });
  // Icon starts from audio.enabled (now backed by ctx.settings — see
  // core/audio.js), not a hardcoded 🔊: fresh players start MUTED (Q11),
  // so a hardcoded speaker-on icon would lie to a kid about a game that's
  // actually silent until they tap it once.
  function syncSoundBtn(on) {
    soundBtn.textContent = on ? '🔊' : '🔇';
    soundBtn.classList.toggle('off', !on);
  }
  syncSoundBtn(audio.enabled);
  soundBtn.addEventListener('click', () => {
    const on = !audio.enabled;
    audio.setEnabled(on);
    voice.setEnabled(on);
    syncSoundBtn(on);
  });
  const clearBtn = el('button', 'kid-round kid-clear', { 'aria-label': 'Clear everything' });
  clearBtn.textContent = '🧹';
  let clearArmed = false;
  let clearTimer = null;
  clearBtn.addEventListener('click', () => {
    if (clearArmed) {
      clearArmed = false;
      clearBtn.classList.remove('armed');
      clearBtn.textContent = '🧹';
      clearTimer && clearTimeout(clearTimer);
      clearAll();
      placementTool.clear();
      audio.erase();
    } else {
      clearArmed = true;
      clearBtn.classList.add('armed');
      clearBtn.textContent = '❓';
      audio.tap();
      clearTimer = setTimeout(() => {
        clearArmed = false;
        clearBtn.classList.remove('armed');
        clearBtn.textContent = '🧹';
      }, 2600);
    }
  });
  actions.appendChild(soundBtn);
  actions.appendChild(clearBtn);
  root.appendChild(actions);

  // ===========================================================
  // ONBOARDING HINT — fades away after the first build
  // ===========================================================
  const hint = el('div', 'kid-hint', { text: '👇 Tap a picture, then tap the moon!' });
  root.appendChild(hint);
  let hintGone = false;
  function killHint() {
    if (hintGone) return;
    hintGone = true;
    hint.classList.add('gone');
    setTimeout(() => hint.remove(), 600);
  }

  // ===========================================================
  // BOTTOM DOCK — [ tools ] [ build panel ] [ blast off ]
  // ===========================================================
  const dock = el('div', 'kid-dock');
  root.appendChild(dock);

  const tools = el('div', 'kid-tools');
  const moveBtn = toolButton('🖐️', 'Move');
  const turnBtn = toolButton('🔄', 'Turn', 'ui-rotate');
  const eraseBtn = toolButton('🧽', 'Erase', 'ui-demolish');
  tools.appendChild(moveBtn.wrap);
  tools.appendChild(turnBtn.wrap);
  tools.appendChild(eraseBtn.wrap);

  const blast = el('button', 'kid-blast', { 'aria-label': 'Blast off a rocket' });
  blast.appendChild(iconImg('victory-rocket', 'kid-blast-ic-img') || el('span', 'kid-blast-ic', { text: '🚀' }));
  blast.appendChild(el('span', 'kid-blast-tx', { text: 'BLAST\nOFF' }));
  blast.addEventListener('click', () => {
    launchRocket();
    blast.classList.remove('go'); void blast.offsetWidth; blast.classList.add('go');
  });

  function toolButton(emoji, label, iconName) {
    const wrap = el('div', 'kid-tool-wrap');
    const btn = el('button', 'kid-tool', { 'aria-label': label });
    btn.appendChild(iconImg(iconName, 'kid-tool-ic-img') || el('span', 'kid-tool-ic', { text: emoji }));
    const lbl = el('span', 'kid-tool-lbl', { text: label });
    wrap.appendChild(btn); wrap.appendChild(lbl);
    return { wrap, btn };
  }

  moveBtn.btn.addEventListener('click', () => { placementTool.clear(); audio.tap(); });
  turnBtn.btn.addEventListener('click', () => { placementTool.rotate(); audio.tap(); });
  eraseBtn.btn.addEventListener('click', () => {
    if (placementTool.mode === 'demolish') placementTool.clear();
    else placementTool.setDemolish();
    audio.tap();
  });

  // ===========================================================
  // BOTTOM BUILD PANEL — category tabs + big picture cards
  // ===========================================================
  const panel = el('div', 'kid-panel');
  const tabsRow = el('div', 'kid-tabs');
  const cardsRow = el('div', 'kid-cards');
  panel.appendChild(tabsRow);
  panel.appendChild(cardsRow);

  // assemble the dock left-to-right
  dock.appendChild(tools);
  dock.appendChild(panel);
  dock.appendChild(blast);

  let activeCat = CATEGORIES[0].id;
  const tabEls = {};
  for (const cat of CATEGORIES) {
    const tab = el('button', 'kid-tab');
    tab.style.setProperty('--cat', cat.color);
    tab.appendChild(iconImg(CAT_ICON[cat.id], 'kid-tab-ic-img') || el('span', 'kid-tab-ic', { text: cat.emoji }));
    tab.appendChild(el('span', 'kid-tab-nm', { text: cat.name }));
    tab.addEventListener('click', () => {
      activeCat = cat.id;
      audio.tap();
      voice.say('cat-' + cat.id, cat.name); // cat.name is the TTS fallback if the clip is missing/fails
      renderCards();
      updateTabs();
    });
    tabsRow.appendChild(tab);
    tabEls[cat.id] = tab;
  }
  function updateTabs() {
    for (const id in tabEls) tabEls[id].classList.toggle('active', id === activeCat);
  }

  const catColorOf = id => (CATEGORIES.find(c => c.id === id) || {}).color || '#4d96ff';

  function renderCards() {
    cardsRow.innerHTML = '';
    cardsRow.scrollLeft = 0;
    const list = BUILDINGS.filter(b => b.cat === activeCat);
    for (const def of list) {
      const card = el('button', 'kid-card');
      card.dataset.id = def.id;
      card.style.setProperty('--cat', catColorOf(def.cat));
      card.appendChild(el('div', 'kid-card-ic', { text: def.emoji }));
      card.appendChild(el('div', 'kid-card-nm', { text: def.name }));
      card.addEventListener('click', () => {
        if (placementTool.mode === 'build' && placementTool.defId === def.id) {
          placementTool.clear();           // tap the same card again = stop
        } else {
          placementTool.setBuild(def.id);
          audio.tap();
          voice.say('b-' + def.id, def.name); // def.name is the TTS fallback if the clip is missing/fails
        }
      });
      cardsRow.appendChild(card);
    }
    updateCardActive();
  }
  function updateCardActive() {
    cardsRow.querySelectorAll('.kid-card').forEach(c => {
      const on = placementTool.mode === 'build' && placementTool.defId === c.dataset.id;
      c.classList.toggle('active', on);
    });
  }

  // ===========================================================
  // TINY SELECT BUBBLE — tap a building in Move mode to see it /
  // erase just that one (a gentle alternative to Erase mode)
  // ===========================================================
  const bubble = el('div', 'kid-bubble hidden');
  root.appendChild(bubble);
  let bubbleUid = null;
  function showBubble(b) {
    const def = BUILDINGS_BY_ID[b.id];
    if (!def) return;
    bubbleUid = b.uid;
    bubble.innerHTML = '';
    bubble.appendChild(el('span', 'kid-bubble-ic', { text: def.emoji }));
    bubble.appendChild(el('span', 'kid-bubble-nm', { text: def.name }));
    const rm = el('button', 'kid-bubble-rm', { 'aria-label': 'Erase this' });
    rm.textContent = '🧽';
    rm.addEventListener('click', () => { demolish(b.uid); hideBubble(); });
    bubble.appendChild(rm);
    bubble.classList.remove('hidden');
  }
  function hideBubble() { bubble.classList.add('hidden'); bubbleUid = null; }

  events.on('select', b => { if (b) showBubble(b); else hideBubble(); });
  events.on('demolished', b => { if (b && b.uid === bubbleUid) hideBubble(); });
  events.on('cleared', hideBubble);

  // ===========================================================
  // REACTIONS
  // ===========================================================
  function refreshCounter() {
    cNum.textContent = String(state.buildings.length);
  }
  function bumpCounter() {
    refreshCounter();
    cNum.classList.remove('pop'); void cNum.offsetWidth; cNum.classList.add('pop');
  }

  events.on('placed', () => { bumpCounter(); killHint(); hideBubble(); });
  events.on('demolished', refreshCounter);
  events.on('cleared', () => { refreshCounter(); });
  events.on('loaded', refreshCounter);

  // reflect the current tool on the mode buttons + cards
  events.on('tool', () => {
    const mode = placementTool.mode;
    moveBtn.btn.classList.toggle('active', mode === 'idle');
    eraseBtn.btn.classList.toggle('active', mode === 'demolish');
    turnBtn.btn.classList.toggle('show', mode === 'build');
    updateCardActive();
    if (mode !== 'idle') hideBubble();
  });

  // gentle feedback when a spot won't work
  events.on('place-failed', () => {
    audio.tap();
    panel.classList.remove('nope'); void panel.offsetWidth; panel.classList.add('nope');
  });

  // ---- first paint ----
  updateTabs();
  renderCards();
  refreshCounter();
  moveBtn.btn.classList.add('active');
}
