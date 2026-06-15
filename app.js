/* =================================================================
   SyLab AR — WebXR Markerless (hit-test) + tap-to-spawn + gestur jari
   ================================================================= */

const MODEL_SCALE = 0.02;   // 1 cm (slider) -> 0.02 m di dunia AR (ukuran meja)
const PI = Math.PI;
const $ = (id) => document.getElementById(id);

/* -----------------------------------------------------------------
   KOMPONEN 1: gesture-handler
   Mengubah usapan SATU jari di layar menjadi rotasi/kemiringan model.
   ----------------------------------------------------------------- */
AFRAME.registerComponent('gesture-handler', {
  init: function () {
    this.target = null;          // entity yang sedang diputar
    this.active = false;
    this.rotX = 0;               // kemiringan (sumbu X)
    this.rotY = 0;               // putaran (sumbu Y)
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.SENS = 0.4;             // derajat per piksel

    this._start = this.onStart.bind(this);
    this._move  = this.onMove.bind(this);
    this._end   = this.onEnd.bind(this);

    window.addEventListener('touchstart', this._start, { passive: false });
    window.addEventListener('touchmove',  this._move,  { passive: false });
    window.addEventListener('touchend',   this._end);
    // Dukungan mouse untuk uji coba di desktop
    window.addEventListener('mousedown', this._start);
    window.addEventListener('mousemove', this._move);
    window.addEventListener('mouseup',   this._end);
  },

  // Abaikan usapan yang dimulai di atas elemen UI (tombol, slider, drawer)
  fromUI: function (e) {
    const t = e.target;
    return t && t.closest && t.closest('button, input, .dock, .spawn-bar, #intro, .place-hint, .status');
  },

  point: function (e) {
    if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  },

  onStart: function (e) {
    if (!this.active || !this.target) return;
    if (this.fromUI(e)) return;
    const p = this.point(e);
    this.dragging = true;
    this.lastX = p.x;
    this.lastY = p.y;
  },

  onMove: function (e) {
    if (!this.dragging || !this.active || !this.target) return;
    if (e.cancelable) e.preventDefault();
    const p = this.point(e);
    const dx = p.x - this.lastX;
    const dy = p.y - this.lastY;
    this.lastX = p.x;
    this.lastY = p.y;

    this.rotY += dx * this.SENS;               // geser kiri/kanan -> berputar
    this.rotX += dy * this.SENS;               // geser atas/bawah -> miring
    this.rotX = Math.max(-90, Math.min(90, this.rotX)); // batasi agar tidak terbalik

    this.target.setAttribute('rotation', { x: this.rotX, y: this.rotY, z: 0 });
  },

  onEnd: function () { this.dragging = false; },

  // Dipanggil JS utama saat memunculkan / mengganti bentuk
  setTarget: function (el) {
    this.target = el;
    this.active = !!el;
  },

  // Reset kemiringan ke tegak lurus (0 0 0)
  reset: function () {
    this.rotX = 0;
    this.rotY = 0;
    if (this.target) this.target.setAttribute('rotation', { x: 0, y: 0, z: 0 });
  }
});

/* -----------------------------------------------------------------
   KOMPONEN 2: surface-placement
   Penjejakan permukaan asli browser (WebXR hit-test). Menampilkan
   reticle di permukaan & menempatkan #ar-anchor saat diminta.
   ----------------------------------------------------------------- */
AFRAME.registerComponent('surface-placement', {
  init: function () {
    this.hitTestSource = null;
    this.lastHit = null;        // {x,y,z} posisi permukaan terbaru
    this.placed = false;
    this.reticle = $('reticle');
    this.anchor  = $('ar-anchor');
    this._tmpV = new THREE.Vector3();

    const sceneEl = this.el.sceneEl;
    sceneEl.addEventListener('enter-vr', () => this.onEnter());
    sceneEl.addEventListener('exit-vr',  () => this.onExit());
  },

  onEnter: async function () {
    const sceneEl = this.el.sceneEl;
    if (!sceneEl.is('ar-mode')) return;        // hanya untuk mode AR
    const session = sceneEl.renderer.xr.getSession();
    if (!session || !session.requestHitTestSource) return;
    try {
      const viewerSpace = await session.requestReferenceSpace('viewer');
      this.hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
      session.addEventListener('end', () => { this.hitTestSource = null; this.lastHit = null; this.placed = false; });
    } catch (err) {
      console.warn('hit-test tidak tersedia:', err);
    }
  },

  onExit: function () {
    this.hitTestSource = null;
    if (this.reticle) this.reticle.setAttribute('visible', false);
  },

  tick: function () {
    const sceneEl = this.el.sceneEl;
    const frame = sceneEl.frame;
    if (!frame || !this.hitTestSource) return;

    const refSpace = sceneEl.renderer.xr.getReferenceSpace();
    const results = frame.getHitTestResults(this.hitTestSource);
    if (results.length > 0) {
      const pose = results[0].getPose(refSpace);
      if (pose) {
        const p = pose.transform.position;
        this.lastHit = { x: p.x, y: p.y, z: p.z };
        if (this.reticle && !this.placed) {
          this.reticle.object3D.visible = true;
          this.reticle.object3D.position.set(p.x, p.y, p.z);
        }
        if (typeof window.onSurfaceReady === 'function') window.onSurfaceReady();
      }
    }
  },

  // Tempatkan anchor: di reticle (kalau ada permukaan) atau di depan kamera (fallback)
  ensurePlaced: function () {
    if (this.lastHit) {
      this.anchor.object3D.position.set(this.lastHit.x, this.lastHit.y, this.lastHit.z);
    } else {
      const cam = this.el.sceneEl.camera;
      const dir = this._tmpV.set(0, 0, -1).applyQuaternion(cam.quaternion);
      const pos = cam.getWorldPosition(new THREE.Vector3()).add(dir.multiplyScalar(0.8));
      pos.y -= 0.25;
      this.anchor.object3D.position.copy(pos);
    }
    this.placed = true;
    if (this.reticle) this.reticle.setAttribute('visible', false);
  }
});

/* =================================================================
   LOGIKA UTAMA
   ================================================================= */
const sceneEl = document.querySelector('a-scene');
const introBox = $('intro');
const introNote = $('intro-note');
const btnStart = $('btn-start');
const placeHint = $('place-hint');

const radiusSlider = $('radius'), heightSlider = $('height');
const radiusVal = $('radius-val'), heightVal = $('height-val');
const cylVolEl = $('cyl-vol'), cylAreaEl = $('cyl-area');
const coneVolEl = $('cone-vol'), coneAreaEl = $('cone-area');
const statusEl = $('status');
const btnClear = $('btn-clear');
const arAnchor = $('ar-anchor');

const SOLIDS = {
  cyl: {
    group: $('cyl-model'),
    shape: $('cyl'), sweep: $('cyl-sweep'), base: $('cyl-base'),
    rRuler: $('cyl-rruler'), rLabel: $('cyl-rlabel'),
    hRuler: $('cyl-hruler'), hLabel: $('cyl-hlabel'),
    formula: $('cyl-formula'), quiz: $('cyl-quiz'),
    radiusAttr: 'radius',
  },
  cone: {
    group: $('cone-model'),
    shape: $('cone'), sweep: $('cone-sweep'), base: $('cone-base'),
    rRuler: $('cone-rruler'), rLabel: $('cone-rlabel'),
    hRuler: $('cone-hruler'), hLabel: $('cone-hlabel'),
    formula: $('cone-formula'), quiz: $('cone-quiz'),
    radiusAttr: 'radius-bottom',
  },
};

// Teks rumus default (volume + luas permukaan)
const FORMULA_TEXT = {
  cyl:  'TABUNG\nV = pi r^2 h\nL = 2 pi r (r + h)',
  cone: 'KERUCUT\nV = (1/3) pi r^2 h\nL = pi r (r + s)',
};

// ---- Rumus ----
const cylinderVolume = (r, h) => PI * r * r * h;
const coneVolume     = (r, h) => (1 / 3) * PI * r * r * h;
const cylinderArea   = (r, h) => 2 * PI * r * r + 2 * PI * r * h;          // luas permukaan tabung
const coneArea       = (r, h) => PI * r * r + PI * r * Math.hypot(r, h);   // luas permukaan kerucut (s = √(r²+h²))
const fmt            = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

const state = { wire: false, quiz: false, current: null }; // current = bentuk aktif ('cyl'/'cone') atau null
let lastSeen = 'cyl';
const visible = new Set();

const cardEmpty = $('card-empty');
const cards = { cyl: $('card-cyl'), cone: $('card-cone') };

function updateGeometry(r, h) {
  const mr = r * MODEL_SCALE, mh = h * MODEL_SCALE;

  for (const key of Object.keys(SOLIDS)) {
    const s = SOLIDS[key];
    s.shape.setAttribute(s.radiusAttr, mr);
    s.shape.setAttribute('height', mh);
    s.shape.setAttribute('position', `0 ${mh / 2} 0`);

    s.rRuler.setAttribute('width', mr);
    s.rRuler.setAttribute('position', `${mr / 2} ${mh * 0.05} 0`);
    s.rLabel.setAttribute('position', `${mr / 2} ${mh * 0.05 + 0.02} 0`);

    s.hRuler.setAttribute('height', mh);
    s.hRuler.setAttribute('position', `${-(mr + 0.015)} ${mh / 2} 0`);
    s.hLabel.setAttribute('position', `${-(mr + 0.035)} ${mh / 2} 0`);

    const top = mh + 0.07;
    s.formula.setAttribute('position', `0 ${top} 0`);
    s.quiz.setAttribute('position', `0 ${top} 0`);
  }

  if (!state.quiz) {
    cylVolEl.textContent   = fmt(cylinderVolume(r, h));
    cylAreaEl.textContent  = fmt(cylinderArea(r, h));
    coneVolEl.textContent  = fmt(coneVolume(r, h));
    coneAreaEl.textContent = fmt(coneArea(r, h));
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

/* -----------------------------------------------------------------
   SPAWNING: memunculkan bentuk pilihan secara instan
   ----------------------------------------------------------------- */
function showOnly(key) {
  SOLIDS.cyl.group.setAttribute('visible', key === 'cyl');
  SOLIDS.cone.group.setAttribute('visible', key === 'cone');
}

function spawnShape(key) {
  if (!SOLIDS[key]) return;

  // Tempatkan anchor di permukaan (atau fallback di depan kamera)
  const sp = sceneEl.components['surface-placement'];
  if (sp) sp.ensurePlaced();
  arAnchor.setAttribute('visible', true);

  showOnly(key);

  // Arahkan gestur ke model baru & reset kemiringan ke 0 0 0
  const gh = sceneEl.components['gesture-handler'];
  if (gh) { gh.setTarget(SOLIDS[key].group); gh.reset(); }

  state.current = key;
  lastSeen = key;
  visible.clear(); visible.add(key);
  btnClear.hidden = false;
  hidePlaceHint();
  refresh();
  renderCards();
}
window.spawnShape = spawnShape; // sesuai spesifikasi: dapat dipanggil dari luar

$('btn-spawn-cyl').addEventListener('click', () => spawnShape('cyl'));
$('btn-spawn-cone').addEventListener('click', () => spawnShape('cone'));

function renderCards() {
  const any = visible.size > 0;
  cardEmpty.hidden = any;
  cards.cyl.hidden  = !visible.has('cyl');
  cards.cone.hidden = !visible.has('cone');

  if (!any) return;
  const name = state.current === 'cyl' ? 'Tabung' : 'Kerucut';
  statusEl.textContent = name + ' aktif — usap layar untuk memutar';
  statusEl.classList.add('found');
}

function clearModel() {
  showOnly(null);
  arAnchor.setAttribute('visible', false);
  const gh = sceneEl.components['gesture-handler'];
  if (gh) { gh.setTarget(null); gh.reset(); }
  const sp = sceneEl.components['surface-placement'];
  if (sp) { sp.placed = false; }            // izinkan reticle muncul lagi untuk penempatan baru
  state.current = null;
  btnClear.hidden = true;
  visible.clear();
  statusEl.textContent = 'Cari permukaan datar…';
  statusEl.classList.remove('found');
  showPlaceHint();
  renderCards();
}
btnClear.addEventListener('click', clearModel);

function showPlaceHint() { if (placeHint) placeHint.hidden = false; }
function hidePlaceHint() { if (placeHint) placeHint.hidden = true; }

// Dipanggil komponen saat permukaan pertama terdeteksi
let surfaceAnnounced = false;
window.onSurfaceReady = function () {
  if (surfaceAnnounced || state.current) return;
  surfaceAnnounced = true;
  statusEl.textContent = 'Permukaan siap — pilih bentuk';
  statusEl.classList.add('found');
};

/* --- DOCK UI --- */
const dock = $('dock');
const dockHandle = $('dock-handle');
function setExpanded(open) {
  dock.classList.toggle('expanded', open);
  dockHandle.setAttribute('aria-expanded', String(open));
}
dockHandle.addEventListener('click', () => setExpanded(!dock.classList.contains('expanded')));

/* --- KERANGKA (wireframe) --- */
const btnWire = $('btn-wire');
btnWire.addEventListener('click', () => {
  state.wire = !state.wire;
  btnWire.setAttribute('aria-pressed', String(state.wire));
  const wfVal = state.wire ? 'true' : 'false';
  for (const key of Object.keys(SOLIDS)) {
    SOLIDS[key].shape.setAttribute('material', `wireframe: ${wfVal}`);
  }
});

/* --- URAI RUMUS --- */
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
    if (!state.quiz) {
      s.formula.setAttribute('value', FORMULA_TEXT[key]);
      s.formula.setAttribute('visible', true);
    }
  }
}

function runBreakdown() {
  cancelBreakdown();
  const key = state.current || lastSeen, s = SOLIDS[key];
  if (!visible.has(key)) return;            // hanya jika bentuk sedang tampil
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
    s.formula.setAttribute('value', FORMULA_TEXT[key]);
  }, 2800));

  breakdownTimers.push(setTimeout(cancelBreakdown, 4600));
}
btnBreak.addEventListener('click', () => { setExpanded(true); runBreakdown(); });

/* --- KUIS --- */
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

  // Pastikan bentuk kuis tampil (spawn otomatis bila perlu)
  spawnShape(key);

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
  for (const key of Object.keys(SOLIDS)) {
    SOLIDS[key].formula.setAttribute('value', FORMULA_TEXT[key]);
    SOLIDS[key].formula.setAttribute('visible', true);
    SOLIDS[key].quiz.setAttribute('visible', false);
  }
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

/* -----------------------------------------------------------------
   MASUK AR + fallback bila perangkat tidak mendukung WebXR AR
   ----------------------------------------------------------------- */
function showIntroNote(msg) {
  if (!introNote) return;
  introNote.hidden = false;
  introNote.textContent = msg;
}

async function startAR() {
  const supported = navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);

  if (supported) {
    introBox.classList.add('hidden');
    statusEl.textContent = 'Cari permukaan datar…';
    showPlaceHint();
    try {
      if (sceneEl.enterAR) sceneEl.enterAR();
      else sceneEl.enterVR(true);
    } catch (e) {
      console.warn(e);
      enterFallback('Tidak bisa memulai sesi AR. Menampilkan mode pratinjau 3D.');
    }
  } else {
    // Perangkat tanpa WebXR AR (mis. iPhone/Safari) -> pratinjau 3D tanpa kamera
    enterFallback('Perangkat ini belum mendukung AR kamera (umum di iPhone/Safari). Menampilkan pratinjau 3D — tombol bentuk, slider, dan gestur tetap berfungsi.');
  }
}

function enterFallback(msg) {
  introBox.classList.add('hidden');
  document.body.classList.add('fallback-bg');
  statusEl.textContent = 'Mode pratinjau 3D — pilih bentuk';
  statusEl.classList.add('found');
  hidePlaceHint();
  if (msg) showStatusToast(msg);
}

function showStatusToast(msg) {
  // tampilkan pesan ringkas sementara di pill status
  const prev = statusEl.textContent;
  statusEl.textContent = msg;
  setTimeout(() => { if (!state.current) statusEl.textContent = prev; }, 5000);
}

btnStart.addEventListener('click', startAR);

// Cek dukungan AR lebih awal untuk memberi tahu di layar intro
(async () => {
  const ok = navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!ok) showIntroNote('Catatan: perangkat ini sepertinya belum mendukung AR kamera. Aplikasi tetap bisa dipakai dalam mode pratinjau 3D.');
})();

sceneEl.addEventListener('exit-vr', () => {
  if (sceneEl.is('vr-mode') || sceneEl.is('ar-mode')) return;
  // kembali dari sesi AR -> tampilkan intro lagi
  introBox.classList.remove('hidden');
});

refresh();
renderCards();
showPlaceHint();
