/* =================================================================
   SyLab AR — application logic
   =================================================================
   1. Resize BOTH solids + their coloured rulers from the sliders.
   2. Keep the on-screen volume / surface-area read-outs in sync.
   3. Show ONLY the card for the marker currently in view (none -> hide).
   4. Bottom-sheet drawer: tap the handle to expand / collapse.
   5. Formula breakdown, quiz mode, wireframe toggle.
   6. Reliable camera start: auto-dismiss intro when the feed is live,
      show an error instead of a silent black screen.

   UNITS: slider values are real centimetres (used for the maths);
   the 3D model is those cm x MODEL_SCALE so it stays marker-sized.
   ================================================================= */

const MODEL_SCALE = 0.06;
const PI = Math.PI;
const $ = (id) => document.getElementById(id);

/* ---------- handles ---------- */
const radiusSlider = $('radius'), heightSlider = $('height');
const radiusVal = $('radius-val'), heightVal = $('height-val');
const cylVolEl = $('cyl-vol'), cylAreaEl = $('cyl-area');
const coneVolEl = $('cone-vol'), coneAreaEl = $('cone-area');
const statusEl = $('status');

const SOLIDS = {
  cyl: {
    shape: $('cyl'), sweep: $('cyl-sweep'), base: $('cyl-base'),
    rRuler: $('cyl-rruler'), rLabel: $('cyl-rlabel'),
    hRuler: $('cyl-hruler'), hLabel: $('cyl-hlabel'),
    formula: $('cyl-formula'), quiz: $('cyl-quiz'),
    radiusAttr: 'radius',
  },
  cone: {
    shape: $('cone'), sweep: $('cone-sweep'), base: $('cone-base'),
    rRuler: $('cone-rruler'), rLabel: $('cone-rlabel'),
    hRuler: $('cone-hruler'), hLabel: $('cone-hlabel'),
    formula: $('cone-formula'), quiz: $('cone-quiz'),
    radiusAttr: 'radius-bottom',
  },
};

/* ---------- maths ---------- */
const cylinderVolume = (r, h) => PI * r * r * h;
const coneVolume     = (r, h) => (1 / 3) * PI * r * r * h;
const cylinderArea   = (r, h) => 2 * PI * r * r + 2 * PI * r * h;
const coneArea       = (r, h) => PI * r * r + PI * r * Math.hypot(r, h);
const fmt            = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

const state = { wire: false, quiz: false };

/* =================================================================
   CORE — push (r, h) into the 3D scene + the dashboard numbers.
   ================================================================= */
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

/* =================================================================
   MARKER-DEPENDENT CARDS — show only the visible solid's card.
   ================================================================= */
const visible = new Set();   // which markers are currently tracked
let lastSeen = 'cyl';        // breakdown targets the most recent one
const cardEmpty = $('card-empty');
const cards = { cyl: $('card-cyl'), cone: $('card-cone') };

function renderCards() {
  const any = visible.size > 0;
  cardEmpty.hidden = any;
  cards.cyl.hidden  = !visible.has('cyl');
  cards.cone.hidden = !visible.has('cone');

  if (!any) { statusEl.textContent = 'Searching for a marker…'; statusEl.classList.remove('found'); }
  else {
    const names = [...visible].map((k) => (k === 'cyl' ? 'Cylinder' : 'Cone'));
    statusEl.textContent = names.join(' + ') + ' detected';
    statusEl.classList.add('found');
  }
}

function wireMarker(id, key) {
  const m = $(id);
  if (!m) return;
  m.addEventListener('markerFound', () => { visible.add(key); lastSeen = key; renderCards(); });
  m.addEventListener('markerLost',  () => { visible.delete(key); renderCards(); });
}
wireMarker('marker-cyl', 'cyl');
wireMarker('marker-cone', 'cone');

/* =================================================================
   BOTTOM-SHEET DRAWER — tap the handle to expand / collapse.
   ================================================================= */
const dock = $('dock');
const dockHandle = $('dock-handle');
function setExpanded(open) {
  dock.classList.toggle('expanded', open);
  dockHandle.setAttribute('aria-expanded', String(open));
}
dockHandle.addEventListener('click', () => setExpanded(!dock.classList.contains('expanded')));

/* =================================================================
   WIREFRAME
   ================================================================= */
const btnWire = $('btn-wire');
btnWire.addEventListener('click', () => {
  state.wire = !state.wire;
  btnWire.setAttribute('aria-pressed', String(state.wire));
  for (const key of Object.keys(SOLIDS)) SOLIDS[key].shape.setAttribute('material', 'wireframe', state.wire);
});

/* =================================================================
   FORMULA BREAKDOWN  (base area  ->  extrude up by h)
   ================================================================= */
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
  s.formula.setAttribute('value', `${isCone ? 'CONE' : 'CYLINDER'}\nbase  A = pi r^2`);

  breakdownTimers.push(setTimeout(() => {
    s.sweep.setAttribute('visible', true);
    s.sweep.object3D.scale.y = 0.001;
    s.sweep.setAttribute('animation__grow', 'property: object3D.scale.y; from: 0.001; to: 1; dur: 1500; easing: easeOutCubic');
    s.sweep.setAttribute('animation__rise', `property: object3D.position.y; from: 0; to: ${mh / 2}; dur: 1500; easing: easeOutCubic`);
    s.formula.setAttribute('value', isCone ? 'extrude up by h\nthen take 1/3' : 'extrude area up by h');
  }, 900));

  breakdownTimers.push(setTimeout(() => {
    s.formula.setAttribute('value', isCone ? 'CONE\nV = (1/3) pi r^2 h' : 'CYLINDER\nV = pi r^2 h');
  }, 2800));

  breakdownTimers.push(setTimeout(cancelBreakdown, 4600));
}
btnBreak.addEventListener('click', () => { setExpanded(true); runBreakdown(); });

/* =================================================================
   QUIZ MODE
   ================================================================= */
const btnQuiz = $('btn-quiz');
const controls = $('controls');      // the peek sliders
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
  const name = key === 'cyl' ? 'cylinder' : 'cone';
  SOLIDS[key].quiz.setAttribute('visible', true);
  SOLIDS[key].quiz.setAttribute('value', `find V of this ${name}`);

  quizPrompt.innerHTML = `Read the dimensions off the model, then find the volume of the <b>${name}</b>.<br>r = ${r} cm, h = ${h} cm`;
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
  if (Number.isNaN(guess)) { quizFeedback.className = 'quiz-feedback no'; quizFeedback.textContent = 'Type a number first.'; return; }
  const { key, r, h, answer } = current;
  const within = Math.abs(guess - answer) <= answer * 0.02 + 0.05;
  const formula = key === 'cyl' ? `V = π r² h = π·${r}²·${h}` : `V = ⅓ π r² h = ⅓·π·${r}²·${h}`;

  SOLIDS[key].quiz.setAttribute('visible', false);
  SOLIDS[key].formula.setAttribute('visible', true);

  quizFeedback.className = 'quiz-feedback ' + (within ? 'ok' : 'no');
  quizFeedback.innerHTML = within
    ? `Correct!  ${formula} ≈ ${fmt(answer)} cm³`
    : `Not quite. ${formula} ≈ ${fmt(answer)} cm³ (you said ${fmt(guess)}).`;
  quizNext.hidden = false;
}
quizSubmit.addEventListener('click', checkAnswer);
quizAnswer.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkAnswer(); });

/* =================================================================
   CAMERA START — auto-dismiss the intro once the feed is live, and
   surface an error instead of a silent black screen.
   ================================================================= */
const intro = $('intro');
const introError = $('intro-error');
function hideIntro() { intro.classList.add('hidden'); }

$('intro-start').addEventListener('click', hideIntro);

let cameraReady = false;
const camPoll = setInterval(() => {
  const v = document.getElementById('arjs-video') || document.querySelector('video');
  if (v && v.videoWidth > 0) {
    cameraReady = true;
    clearInterval(camPoll);
    hideIntro();
    if (!visible.size) statusEl.textContent = 'Camera ready — point at a marker';
  }
}, 400);

// AR.js / getUserMedia failures
function showCameraError(msg) {
  introError.hidden = false;
  introError.textContent = msg;
}
window.addEventListener('camera-error', () => showCameraError('Camera was blocked. Allow camera access in the browser, make sure the page is on https://, and reload.'));
document.addEventListener('camera-error', () => showCameraError('Camera was blocked. Allow camera access in the browser, make sure the page is on https://, and reload.'));

// If nothing has streamed after 9s, tell the user why.
setTimeout(() => {
  if (!cameraReady) showCameraError('No camera feed yet. This needs https:// and camera permission, and some in-app browsers (Instagram, etc.) block the camera — open in Chrome or Safari.');
}, 9000);

/* ---------- first paint ---------- */
refresh();
renderCards();
