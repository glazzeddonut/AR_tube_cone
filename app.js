const MODEL_SCALE = 0.06;
const PI = Math.PI;
const $ = (id) => document.getElementById(id);

// --- 1. INTRO BOX LOGIC ---
const introBox = $('intro');
const btnStart = $('btn-start');
if (btnStart && introBox) {
  btnStart.addEventListener('click', () => { introBox.classList.add('hidden'); });
}

const radiusSlider = $('radius'), heightSlider = $('height');
const radiusVal = $('radius-val'), heightVal = $('height-val');
const cylVolEl = $('cyl-vol'), cylAreaEl = $('cyl-area');
const coneVolEl = $('cone-vol'), coneAreaEl = $('cone-area');
const statusEl = $('status');
const btnClear = $('btn-clear');

// Marker-anchored shapes (visible when marker is tracked)
const SOLIDS = {
  cyl: {
    group: $('cyl-group'),
    shape: $('cyl'), sweep: $('cyl-sweep'), base: $('cyl-base'),
    rRuler: $('cyl-rruler'), rLabel: $('cyl-rlabel'),
    hRuler: $('cyl-hruler'), hLabel: $('cyl-hlabel'),
    formula: $('cyl-formula'), quiz: $('cyl-quiz'),
    radiusAttr: 'radius',
  },
  cone: {
    group: $('cone-group'),
    shape: $('cone'), sweep: $('cone-sweep'), base: $('cone-base'),
    rRuler: $('cone-rruler'), rLabel: $('cone-rlabel'),
    hRuler: $('cone-hruler'), hLabel: $('cone-hlabel'),
    formula: $('cone-formula'), quiz: $('cone-quiz'),
    radiusAttr: 'radius-bottom',
  },
};

// Ghost world-space entities (shown after marker is lost so you can tilt around)
const GHOSTS = {
  cyl: {
    group: $('ghost-cyl-group'),
    shape: $('ghost-cyl'),
    rRuler: $('ghost-cyl-rruler'), rLabel: $('ghost-cyl-rlabel'),
    hRuler: $('ghost-cyl-hruler'), hLabel: $('ghost-cyl-hlabel'),
    formula: $('ghost-cyl-formula'),
    radiusAttr: 'radius',
  },
  cone: {
    group: $('ghost-cone-group'),
    shape: $('ghost-cone'),
    rRuler: $('ghost-cone-rruler'), rLabel: $('ghost-cone-rlabel'),
    hRuler: $('ghost-cone-hruler'), hLabel: $('ghost-cone-hlabel'),
    formula: $('ghost-cone-formula'),
    radiusAttr: 'radius-bottom',
  },
};

const ghostAnchor = $('ghost-anchor');

const cylinderVolume = (r, h) => PI * r * r * h;
const coneVolume     = (r, h) => (1 / 3) * PI * r * r * h;
const cylinderArea   = (r, h) => 2 * PI * r * r + 2 * PI * r * h;
const coneArea       = (r, h) => PI * r * r + PI * r * Math.hypot(r, h);
const fmt            = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

const state = { wire: false, quiz: false, ghostActive: false, ghostKey: null };

// Copy geometry attributes to ghost so it mirrors the marker shape
function syncGhost(key) {
  const s = SOLIDS[key], g = GHOSTS[key];
  const attrs = ['radius', 'radius-bottom', 'height', 'position', 'width', 'depth', 'value'];
  
  function copyEl(src, dst) {
    if (!src || !dst) return;
    attrs.forEach(attr => {
      const v = src.getAttribute(attr);
      if (v !== null) dst.setAttribute(attr, v);
    });
    // Copy material
    const mat = src.getAttribute('material');
    if (mat) dst.setAttribute('material', mat);
  }

  copyEl(s.shape, g.shape);
  copyEl(s.rRuler, g.rRuler);
  copyEl(s.rLabel, g.rLabel);
  copyEl(s.hRuler, g.hRuler);
  copyEl(s.hLabel, g.hLabel);
  
  // Copy formula text
  const fv = s.formula.getAttribute('value');
  if (fv) g.formula.setAttribute('value', fv);
  
  const fp = s.formula.getAttribute('position');
  if (fp) g.formula.setAttribute('position', fp);
}

// Snapshot the marker's world matrix into the ghost anchor so it stays in place
function freezeGhostAt(markerEl, key) {
  // Wait a tick for the marker world matrix to be ready
  setTimeout(() => {
    if (!markerEl.object3D) return;
    const markerWorld = new THREE.Matrix4();
    markerEl.object3D.updateWorldMatrix(true, false);
    markerWorld.copy(markerEl.object3D.matrixWorld);

    // Extract position, quaternion, scale from the marker's world transform
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    markerWorld.decompose(pos, quat, scale);

    ghostAnchor.object3D.position.copy(pos);
    ghostAnchor.object3D.quaternion.copy(quat);
    // Don't copy marker scale — it can be weird; use fixed world scale
    ghostAnchor.object3D.scale.set(1, 1, 1);
    ghostAnchor.object3D.matrixWorldNeedsUpdate = true;

    // Hide marker shape, show ghost
    SOLIDS[key].group.setAttribute('visible', false);
    
    syncGhost(key);
    
    // Hide both ghost groups, then show only the right one
    GHOSTS.cyl.group.setAttribute('visible', false);
    GHOSTS.cone.group.setAttribute('visible', false);
    GHOSTS[key].group.setAttribute('visible', true);

    state.ghostActive = true;
    state.ghostKey = key;
  }, 30);
}

function updateGeometry(r, h) {
  const mr = r * MODEL_SCALE, mh = h * MODEL_SCALE;

  for (const key of Object.keys(SOLIDS)) {
    const s = SOLIDS[key];
    s.shape.setAttribute(s.radiusAttr, mr);
    s.shape.setAttribute('height', mh);
    s.shape.setAttribute('position', `0 ${mh / 2} 0`);

    s.rRuler.setAttribute('width', mr);
    s.rRuler.setAttribute('position', `${mr / 2} 0.025 0`);
    s.rLabel.setAttribute('position', `${mr / 2} 0.075 0`);

    s.hRuler.setAttribute('height', mh);
    s.hRuler.setAttribute('position', `${-(mr + 0.06)} ${mh / 2} 0`);
    s.hLabel.setAttribute('position', `${-(mr + 0.12)} ${mh / 2} 0`);

    const top = mh + 0.18;
    s.formula.setAttribute('position', `0 ${top} 0`);
    s.quiz.setAttribute('position', `0 ${top} 0`);
  }

  // Also update ghost geometry if active
  if (state.ghostActive && state.ghostKey) {
    const key = state.ghostKey;
    const g = GHOSTS[key];
    g.shape.setAttribute(g.radiusAttr, mr);
    g.shape.setAttribute('height', mh);
    g.shape.setAttribute('position', `0 ${mh / 2} 0`);
    g.rRuler.setAttribute('width', mr);
    g.rRuler.setAttribute('position', `${mr / 2} 0.025 0`);
    g.rLabel.setAttribute('position', `${mr / 2} 0.075 0`);
    g.hRuler.setAttribute('height', mh);
    g.hRuler.setAttribute('position', `${-(mr + 0.06)} ${mh / 2} 0`);
    g.hLabel.setAttribute('position', `${-(mr + 0.12)} ${mh / 2} 0`);
    g.formula.setAttribute('position', `0 ${mh + 0.18} 0`);
  }

  if (!state.quiz) {
    cylVolEl.textContent  = fmt(cylinderVolume(r, h));
    cylAreaEl.textContent = fmt(cylinderArea(r, h));
    coneVolEl.textContent = fmt(coneVolume(r, h));
    coneAreaEl.textContent= fmt(coneArea(r, h));
  }
}

function readSliders() {
  const r = parseFloat(radiusSlider.value);
  const h = parseFloat(heightSlider.value);
  radiusVal.textContent = r.toFixed(1) + ' cm';
  heightVal.textContent = h.toFixed(1) + ' cm';
  return { r, h };
}
function refresh() { const { r, h } = readSliders(); updateGeometry(r, h); }

radiusSlider.addEventListener('input', () => { cancelBreakdown(); refresh(); });
heightSlider.addEventListener('input', () => { cancelBreakdown(); refresh(); });

const visible = new Set();
let lastSeen = 'cyl';
const cardEmpty = $('card-empty');
const cards = { cyl: $('card-cyl'), cone: $('card-cone') };

function renderCards() {
  const any = visible.size > 0 || state.ghostActive;
  cardEmpty.hidden = any;
  cards.cyl.hidden  = !(visible.has('cyl') || (state.ghostActive && state.ghostKey === 'cyl'));
  cards.cone.hidden = !(visible.has('cone') || (state.ghostActive && state.ghostKey === 'cone'));

  if (!any) {
    statusEl.textContent = 'Mencari marker...';
    statusEl.classList.remove('found');
  } else if (state.ghostActive) {
    const name = state.ghostKey === 'cyl' ? 'Tabung' : 'Kerucut';
    statusEl.textContent = name + ' — gerakkan kamera bebas';
    statusEl.classList.add('found');
  } else {
    const names = [...visible].map((k) => (k === 'cyl' ? 'Tabung' : 'Kerucut'));
    statusEl.textContent = names.join(' + ') + ' aktif di layar';
    statusEl.classList.add('found');
  }
}

let hideTimeout = null;
const TIMEOUT_DURATION_MS = 3 * 60 * 1000; // 3 minutes

const MARKERS = { cyl: $('marker-cyl'), cone: $('marker-cone') };

function showModel(key) {
  if (hideTimeout) clearTimeout(hideTimeout);

  // If ghost is showing, hide it — marker is back in view
  if (state.ghostActive) {
    GHOSTS.cyl.group.setAttribute('visible', false);
    GHOSTS.cone.group.setAttribute('visible', false);
    state.ghostActive = false;
    state.ghostKey = null;
  }

  // Show the marker-anchored shape
  SOLIDS[key].group.setAttribute('visible', true);

  btnClear.hidden = false;
  visible.add(key);
  lastSeen = key;
  renderCards();
}

function onMarkerLost(key) {
  // Freeze the shape at its last world position as a ghost
  SOLIDS[key].group.setAttribute('visible', false);
  visible.delete(key);

  const markerEl = MARKERS[key];
  freezeGhostAt(markerEl, key);
  renderCards();

  // Schedule timeout
  scheduleHide();
}

function scheduleHide() {
  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => { clearModel(); }, TIMEOUT_DURATION_MS);
}

function clearModel() {
  if (hideTimeout) clearTimeout(hideTimeout);
  SOLIDS.cyl.group.setAttribute('visible', false);
  SOLIDS.cone.group.setAttribute('visible', false);
  GHOSTS.cyl.group.setAttribute('visible', false);
  GHOSTS.cone.group.setAttribute('visible', false);
  state.ghostActive = false;
  state.ghostKey = null;
  btnClear.hidden = true;
  visible.clear();
  renderCards();
}

btnClear.addEventListener('click', clearModel);

MARKERS.cyl.addEventListener('markerFound', () => showModel('cyl'));
MARKERS.cyl.addEventListener('markerLost', () => onMarkerLost('cyl'));
MARKERS.cone.addEventListener('markerFound', () => showModel('cone'));
MARKERS.cone.addEventListener('markerLost', () => onMarkerLost('cone'));

// --- DOCK UI LOGIC ---
const dock = $('dock');
const dockHandle = $('dock-handle');
function setExpanded(open) {
  dock.classList.toggle('expanded', open);
  dockHandle.setAttribute('aria-expanded', String(open));
}
dockHandle.addEventListener('click', () => setExpanded(!dock.classList.contains('expanded')));

const btnWire = $('btn-wire');
btnWire.addEventListener('click', () => {
  state.wire = !state.wire;
  btnWire.setAttribute('aria-pressed', String(state.wire));
  const wfVal = state.wire ? 'true' : 'false';
  for (const key of Object.keys(SOLIDS)) {
    SOLIDS[key].shape.setAttribute('material', `wireframe: ${wfVal}`);
  }
  if (state.ghostActive && state.ghostKey) {
    GHOSTS[state.ghostKey].shape.setAttribute('material', `wireframe: ${wfVal}`);
  }
});

const btnBreak = $('btn-break');
let breakdownTimers = [];

function cancelBreakdown() {
  breakdownTimers.forEach(clearTimeout);
  breakdownTimers = [];
  for (const key of Object.keys(SOLIDS)) {
    const s = SOLIDS[key];
    s.base.setAttribute('visible', false);
    s.sweep.setAttribute('visible', false);
    s.sweep.removeAttribute('animation__grow');
    s.sweep.removeAttribute('animation__rise');
    if (!state.quiz) s.formula.setAttribute('visible', true);
  }
}

function runBreakdown() {
  cancelBreakdown();
  const key = lastSeen, s = SOLIDS[key];
  const { r, h } = readSliders();
  const mr = r * MODEL_SCALE, mh = h * MODEL_SCALE;
  const isCone = key === 'cone';

  s.sweep.setAttribute(s.radiusAttr, mr);
  s.sweep.setAttribute('height', mh);
  s.base.setAttribute('radius', mr);

  s.base.setAttribute('visible', true);
  s.formula.setAttribute('value', `${isCone ? 'KERUCUT' : 'TABUNG'}\nLuas alas A = pi r^2`);

  breakdownTimers.push(setTimeout(() => {
    s.sweep.setAttribute('visible', true);
    s.sweep.object3D.scale.y = 0.001;
    s.sweep.setAttribute('animation__grow', 'property: object3D.scale.y; from: 0.001; to: 1; dur: 1500; easing: easeOutCubic');
    s.sweep.setAttribute('animation__rise', `property: object3D.position.y; from: 0; to: ${mh / 2}; dur: 1500; easing: easeOutCubic`);
    s.formula.setAttribute('value', isCone ? 'Tarik ke atas setinggi h\nlalu ambil 1/3' : 'Tarik alas ke atas setinggi h');
  }, 900));

  breakdownTimers.push(setTimeout(() => {
    s.formula.setAttribute('value', isCone ? 'KERUCUT\nV = (1/3) pi r^2 h' : 'TABUNG\nV = pi r^2 h');
  }, 2800));

  breakdownTimers.push(setTimeout(cancelBreakdown, 4600));
}
btnBreak.addEventListener('click', () => { setExpanded(true); runBreakdown(); });

// --- QUIZ LOGIC ---
const btnQuiz = $('btn-quiz');
const controls = $('controls');
const quizPanel = $('quiz');
const quizPrompt = $('quiz-prompt');
const quizAnswer = $('quiz-answer');
const quizSubmit = $('quiz-submit');
const quizNext = $('quiz-next');
const quizFeedback = $('quiz-feedback');
let current = null;

function newQuestion() {
  cancelBreakdown();
  const key = Math.random() < 0.5 ? 'cyl' : 'cone';
  const r = +(Math.random() * 5 + 2).toFixed(1);
  const h = +(Math.random() * 8 + 3).toFixed(1);
  const answer = key === 'cyl' ? cylinderVolume(r, h) : coneVolume(r, h);
  current = { key, r, h, answer };

  radiusSlider.value = r; heightSlider.value = h;
  updateGeometry(r, h); readSliders();

  for (const s of Object.values(SOLIDS)) { s.formula.setAttribute('visible', false); s.quiz.setAttribute('visible', false); }
  const name = key === 'cyl' ? 'tabung' : 'kerucut';
  SOLIDS[key].quiz.setAttribute('visible', true);
  SOLIDS[key].quiz.setAttribute('value', `Cari V dari ${name} ini`);

  quizPrompt.innerHTML = `Baca ukuran pada model 3D, lalu hitung volume dari <b>${name}</b> tersebut.<br>r = ${r} cm, h = ${h} cm`;
  quizAnswer.value = ''; quizFeedback.textContent = ''; quizFeedback.className = 'quiz-feedback';
  quizNext.hidden = true; quizAnswer.focus();
}

function enterQuiz() {
  state.quiz = true; setExpanded(true);
  btnQuiz.setAttribute('aria-pressed', 'true');
  controls.hidden = true; quizPanel.hidden = false;
  newQuestion();
}
function exitQuiz() {
  state.quiz = false;
  btnQuiz.setAttribute('aria-pressed', 'false');
  controls.hidden = false; quizPanel.hidden = true;
  for (const s of Object.values(SOLIDS)) { s.formula.setAttribute('visible', true); s.quiz.setAttribute('visible', false); }
  refresh();
}
btnQuiz.addEventListener('click', () => (state.quiz ? exitQuiz() : enterQuiz()));
quizNext.addEventListener('click', newQuestion);

function checkAnswer() {
  if (!current) return;
  const guess = parseFloat(quizAnswer.value);
  if (Number.isNaN(guess)) { quizFeedback.className = 'quiz-feedback no'; quizFeedback.textContent = 'Masukkan angka terlebih dahulu.'; return; }
  const { key, r, h, answer } = current;
  const within = Math.abs(guess - answer) <= answer * 0.02 + 0.05;
  const formula = key === 'cyl' ? `V = π r² h = π·${r}²·${h}` : `V = ⅓ π r² h = ⅓·π·${r}²·${h}`;

  SOLIDS[key].quiz.setAttribute('visible', false);
  SOLIDS[key].formula.setAttribute('visible', true);

  quizFeedback.className = 'quiz-feedback ' + (within ? 'ok' : 'no');
  quizFeedback.innerHTML = within
    ? `Benar!  ${formula} ≈ ${fmt(answer)} cm³`
    : `Kurang tepat. ${formula} ≈ ${fmt(answer)} cm³ (jawabanmu ${fmt(guess)}).`;
  quizNext.hidden = false;
}
quizSubmit.addEventListener('click', checkAnswer);
quizAnswer.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkAnswer(); });

function showCameraError(msg) {
  statusEl.textContent = msg;
  statusEl.classList.add('found');
  statusEl.style.backgroundColor = '#ef4444';
  statusEl.style.color = 'white';
}

let cameraReady = false;
const camPoll = setInterval(() => {
  const v = document.getElementById('arjs-video') || document.querySelector('video');
  if (v && v.videoWidth > 0) {
    cameraReady = true;
    clearInterval(camPoll);
    if (!visible.size) statusEl.textContent = 'Kamera siap — arahkan ke marker';
  }
}, 400);

window.addEventListener('camera-error', () => showCameraError('Kamera diblokir. Izinkan akses di browser.'));
document.addEventListener('camera-error', () => showCameraError('Kamera diblokir. Izinkan akses di browser.'));

setTimeout(() => {
  if (!cameraReady) showCameraError('Belum ada tampilan kamera.');
}, 9000);

refresh();
renderCards();
