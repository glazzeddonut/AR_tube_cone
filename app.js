/* =================================================================
   GeoLab AR — application logic
   =================================================================
   Responsibilities
     1. Read the Radius / Height sliders and resize BOTH 3D solids
        + their coloured rulers in real time.
     2. Keep the on-screen volume + surface-area read-outs in sync.
     3. Play the "break down the formula" animation (base area -> extrude).
     4. Run quiz mode (hide formulas, random dims, check the guess).
     5. Toggle wireframe so internal dimensions (like a cone's height)
        are visible.
     6. Report which marker is currently being tracked.

   UNITS
     Slider values are real centimetres (used for the maths).
     The 3D model is those centimetres x MODEL_SCALE so it stays the
     size of a marker instead of swallowing the room.
   ================================================================= */

const MODEL_SCALE = 0.06;          // 1 cm  ->  0.06 scene units
const PI = Math.PI;

/* ---------- element handles ---------- */
const $ = (id) => document.getElementById(id);

const radiusSlider = $('radius');
const heightSlider = $('height');
const radiusVal    = $('radius-val');
const heightVal    = $('height-val');

const cylVolEl  = $('cyl-vol');
const cylAreaEl = $('cyl-area');
const coneVolEl = $('cone-vol');
const coneAreaEl= $('cone-area');

/* 3D entities, grouped per solid so the same code drives both */
const SOLIDS = {
  cyl: {
    shape:  $('cyl'),  sweep: $('cyl-sweep'), base: $('cyl-base'),
    rRuler: $('cyl-rruler'), rLabel: $('cyl-rlabel'),
    hRuler: $('cyl-hruler'), hLabel: $('cyl-hlabel'),
    formula:$('cyl-formula'), quiz: $('cyl-quiz'),
    radiusAttr: 'radius',          // a-cylinder uses "radius"
  },
  cone: {
    shape:  $('cone'), sweep: $('cone-sweep'), base: $('cone-base'),
    rRuler: $('cone-rruler'), rLabel: $('cone-rlabel'),
    hRuler: $('cone-hruler'), hLabel: $('cone-hlabel'),
    formula:$('cone-formula'), quiz: $('cone-quiz'),
    radiusAttr: 'radius-bottom',   // a-cone uses "radius-bottom"
  },
};

/* ---------- maths helpers ---------- */
const cylinderVolume = (r, h) => PI * r * r * h;
const coneVolume     = (r, h) => (1 / 3) * PI * r * r * h;
const cylinderArea   = (r, h) => 2 * PI * r * r + 2 * PI * r * h;
const coneArea       = (r, h) => PI * r * r + PI * r * Math.hypot(r, h); // base + lateral (slant = sqrt(r^2+h^2))
const fmt            = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

/* =================================================================
   CORE: push the current (r, h) into the 3D scene + the dashboard.
   ================================================================= */
function updateGeometry(r, h) {
  const mr = r * MODEL_SCALE;     // model radius
  const mh = h * MODEL_SCALE;     // model height

  for (const key of Object.keys(SOLIDS)) {
    const s = SOLIDS[key];

    // resize the solid and keep its base sitting on the marker plane
    s.shape.setAttribute(s.radiusAttr, mr);
    s.shape.setAttribute('height', mh);
    s.shape.setAttribute('position', `0 ${mh / 2} 0`);

    // radius ruler runs from centre to edge along +x
    s.rRuler.setAttribute('width', mr);
    s.rRuler.setAttribute('position', `${mr / 2} 0.025 0`);
    s.rLabel.setAttribute('position', `${mr / 2} 0.075 0`);

    // height ruler stands beside the solid along the y-axis
    s.hRuler.setAttribute('height', mh);
    s.hRuler.setAttribute('position', `${-(mr + 0.06)} ${mh / 2} 0`);
    s.hLabel.setAttribute('position', `${-(mr + 0.12)} ${mh / 2} 0`);

    // lift the floating text above the (possibly taller) solid
    const top = mh + 0.18;
    s.formula.setAttribute('position', `0 ${top} 0`);
    s.quiz.setAttribute('position', `0 ${top} 0`);
  }

  // dashboard read-outs (only meaningful outside quiz mode)
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

function refresh() {
  const { r, h } = readSliders();
  updateGeometry(r, h);
}

radiusSlider.addEventListener('input', () => { cancelBreakdown(); refresh(); });
heightSlider.addEventListener('input', () => { cancelBreakdown(); refresh(); });

/* =================================================================
   WIREFRAME toggle — reveals internal dimensions (e.g. cone height).
   ================================================================= */
const state = { wire: false, quiz: false, target: 'cyl' };
const btnWire = $('btn-wire');

btnWire.addEventListener('click', () => {
  state.wire = !state.wire;
  btnWire.setAttribute('aria-pressed', String(state.wire));
  for (const key of Object.keys(SOLIDS)) {
    SOLIDS[key].shape.setAttribute('material', 'wireframe', state.wire);
  }
});

/* =================================================================
   FORMULA BREAKDOWN
   Step 1 — highlight the circular base:   A = πr²
   Step 2 — extrude that area up by h to "sweep out" the volume.
   We animate a translucent copy of the solid growing from 0 -> full
   height so students literally see "area × height".
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
  const key = state.target;               // animate whichever solid is in view
  const s = SOLIDS[key];
  const { r, h } = readSliders();
  const mr = r * MODEL_SCALE, mh = h * MODEL_SCALE;
  const isCone = key === 'cone';

  // sweep geometry matches the real solid
  s.sweep.setAttribute(s.radiusAttr, mr);
  s.sweep.setAttribute('height', mh);
  s.base.setAttribute('radius', mr);

  // --- Step 1: flash the base, show A = πr² ---
  s.base.setAttribute('visible', true);
  s.formula.setAttribute('value',
    `${isCone ? 'CONE' : 'CYLINDER'}\nbase  A = pi r^2`);

  // --- Step 2: grow the translucent sweep from 0 -> full height ---
  breakdownTimers.push(setTimeout(() => {
    s.sweep.setAttribute('visible', true);
    s.sweep.object3D.scale.y = 0.001;
    s.sweep.setAttribute('animation__grow',
      'property: object3D.scale.y; from: 0.001; to: 1; dur: 1500; easing: easeOutCubic');
    s.sweep.setAttribute('animation__rise',
      `property: object3D.position.y; from: 0; to: ${mh / 2}; dur: 1500; easing: easeOutCubic`);
    s.formula.setAttribute('value',
      isCone ? 'extrude up by h\nthen take 1/3'
             : 'extrude area up by h');
  }, 900));

  // --- Step 3: land on the full formula again ---
  breakdownTimers.push(setTimeout(() => {
    s.formula.setAttribute('value',
      isCone ? 'CONE\nV = (1/3) pi r^2 h'
             : 'CYLINDER\nV = pi r^2 h');
  }, 2800));

  // --- auto clean-up ---
  breakdownTimers.push(setTimeout(cancelBreakdown, 4600));
}

btnBreak.addEventListener('click', runBreakdown);

/* =================================================================
   QUIZ MODE
   Hides the formulas, sets random dimensions, asks for the volume of
   one randomly chosen solid, then reveals formula + answer.
   ================================================================= */
const btnQuiz     = $('btn-quiz');
const quizPanel   = $('quiz');
const controls    = $('controls');
const quizPrompt  = $('quiz-prompt');
const quizAnswer  = $('quiz-answer');
const quizSubmit  = $('quiz-submit');
const quizNext    = $('quiz-next');
const quizFeedback= $('quiz-feedback');

let current = null;   // { key, r, h, answer }

function newQuestion() {
  cancelBreakdown();
  const key = Math.random() < 0.5 ? 'cyl' : 'cone';
  const r = +(Math.random() * 5 + 2).toFixed(1);   // 2.0 – 7.0 cm
  const h = +(Math.random() * 8 + 3).toFixed(1);   // 3.0 – 11.0 cm
  const answer = key === 'cyl' ? cylinderVolume(r, h) : coneVolume(r, h);
  current = { key, r, h, answer };

  // drive the model to those dims (rulers still show r and h)
  radiusSlider.value = r; heightSlider.value = h;
  updateGeometry(r, h);
  readSliders();

  // hide BOTH 3D formulas, show a neutral quiz label on the target
  for (const s of Object.values(SOLIDS)) {
    s.formula.setAttribute('visible', false);
    s.quiz.setAttribute('visible', false);
  }
  const name = key === 'cyl' ? 'cylinder' : 'cone';
  SOLIDS[key].quiz.setAttribute('visible', true);
  SOLIDS[key].quiz.setAttribute('value', `find V of this ${name}`);

  quizPrompt.innerHTML =
    `Read the dimensions off the model, then find the volume of the ` +
    `<b>${name}</b>.<br>r = ${r} cm, h = ${h} cm`;
  quizAnswer.value = '';
  quizFeedback.textContent = '';
  quizFeedback.className = 'quiz-feedback';
  quizNext.hidden = true;
  quizAnswer.focus();
}

function enterQuiz() {
  state.quiz = true;
  btnQuiz.setAttribute('aria-pressed', 'true');
  controls.hidden = true;
  quizPanel.hidden = false;
  newQuestion();
}

function exitQuiz() {
  state.quiz = false;
  btnQuiz.setAttribute('aria-pressed', 'false');
  controls.hidden = false;
  quizPanel.hidden = true;
  for (const s of Object.values(SOLIDS)) {
    s.formula.setAttribute('visible', true);
    s.quiz.setAttribute('visible', false);
  }
  refresh();   // restore live read-outs
}

btnQuiz.addEventListener('click', () => state.quiz ? exitQuiz() : enterQuiz());
quizNext.addEventListener('click', newQuestion);

function checkAnswer() {
  if (!current) return;
  const guess = parseFloat(quizAnswer.value);
  if (Number.isNaN(guess)) {
    quizFeedback.className = 'quiz-feedback no';
    quizFeedback.textContent = 'Type a number first.';
    return;
  }
  const { key, r, h, answer } = current;
  const within = Math.abs(guess - answer) <= answer * 0.02 + 0.05; // 2% tolerance
  const name = key === 'cyl' ? 'cylinder' : 'cone';
  const formula = key === 'cyl'
    ? `V = π r² h = π·${r}²·${h}`
    : `V = ⅓ π r² h = ⅓·π·${r}²·${h}`;

  // reveal the formula on the 3D model again
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
   MARKER STATUS — tells the student which solid is live, and lets the
   breakdown button target the solid actually in view.
   ================================================================= */
const statusEl = $('status');

function wireMarker(id, key, label) {
  const m = $(id);
  if (!m) return;
  m.addEventListener('markerFound', () => {
    state.target = key;
    statusEl.textContent = `${label} detected`;
    statusEl.classList.add('found');
  });
  m.addEventListener('markerLost', () => {
    statusEl.textContent = 'Searching for a marker…';
    statusEl.classList.remove('found');
  });
}
wireMarker('marker-cyl',  'cyl',  'Cylinder (Hiro)');
wireMarker('marker-cone', 'cone', 'Cone (Kanji)');

/* =================================================================
   DOCK collapse + intro card
   ================================================================= */
const dock = $('dock');
$('dock-handle').addEventListener('click', () => {
  const collapsed = dock.classList.toggle('collapsed');
  $('dock-handle').setAttribute('aria-expanded', String(!collapsed));
});

$('intro-start').addEventListener('click', () => {
  // Tapping here is the user gesture some browsers require before the
  // camera stream starts; AR.js then prompts for permission.
  $('intro').classList.add('hidden');
});

/* ---------- first paint ---------- */
refresh();
