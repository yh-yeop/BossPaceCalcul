import { LIMIT_MIN, analyze, predict, requiredControl, minRatio, clamp, fmtTime, fmtTimeKo } from './calc.js';
import { renderCard } from './share.js';

const $ = id => document.getElementById(id);
const el = {
  boss: $('boss'), ratio: $('ratio'), min: $('clearMin'), sec: $('clearSec'), hp: $('hpLeft'),
  clearBox: $('clearInputs'), failBox: $('failInputs'),
  btnClear: $('modeClear'), btnFail: $('modeFail'),
  track: $('track'), fill: $('fill'), mark: $('idealMark'),
  ctrlPct: $('ctrlPct'), ctrlNote: $('ctrlNote'), minRatio: $('minRatio'), verdict: $('verdict'),
  ctrlIn: $('ctrlIn'), ctrlSync: $('ctrlSync'),
  tabRatio: $('tabRatio'), tabTime: $('tabTime'), paneRatio: $('paneRatio'), paneTime: $('paneTime'),
  goalRatio: $('goalRatio'), goalMin: $('goalMin'), goalSec: $('goalSec'),
  outRatio: $('outRatio'), outTime: $('outTime'),
  presetPickRow: $('presetPickRow'), presetChips: $('presetChips'),
  presetForm: $('presetForm'), pName: $('pName'), pRatio: $('pRatio'), presetList: $('presetList'),
  toast: $('toast'),
};

const STATE_KEY = 'bpc:state';
const PRESET_KEY = 'bpc:presets';

let mode = 'clear';
let goalTab = 'ratio';
let ctrlOverride = false; // 기준 컨트롤을 직접 입력했는지
let presets = [];
let last = null; // 마지막 기록 분석 결과

const num = e => { const v = parseFloat(e.value); return isFinite(v) ? v : 0; };
const f1 = v => v.toFixed(1);
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function save(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 저장 불가 환경 무시 */ }
}

/* ---------- 모드 / 탭 ---------- */
function setMode(m) {
  mode = m;
  el.clearBox.hidden = m !== 'clear';
  el.failBox.hidden = m !== 'fail';
  el.btnClear.setAttribute('aria-pressed', m === 'clear');
  el.btnFail.setAttribute('aria-pressed', m === 'fail');
  update();
}
function setTab(t) {
  goalTab = t;
  el.paneRatio.hidden = t !== 'ratio';
  el.paneTime.hidden = t !== 'time';
  for (const [b, on] of [[el.tabRatio, t === 'ratio'], [el.tabTime, t === 'time']]) {
    b.setAttribute('aria-pressed', on);
    b.setAttribute('aria-selected', on);
  }
  save(STATE_KEY, readState());
}

/* ---------- 입력 상태 ---------- */
function readState() {
  return {
    boss: el.boss.value.trim(), ratio: el.ratio.value, mode,
    min: el.min.value, sec: el.sec.value, hp: el.hp.value,
    goalRatio: el.goalRatio.value, goalMin: el.goalMin.value, goalSec: el.goalSec.value, goalTab,
  };
}
function applyState(s) {
  if (!s) return;
  if (s.boss != null) el.boss.value = s.boss;
  if (s.ratio != null) el.ratio.value = s.ratio;
  if (s.min != null) el.min.value = s.min;
  if (s.sec != null) el.sec.value = s.sec;
  if (s.hp != null) el.hp.value = s.hp;
  if (s.goalRatio != null) el.goalRatio.value = s.goalRatio;
  if (s.goalMin != null) el.goalMin.value = s.goalMin;
  if (s.goalSec != null) el.goalSec.value = s.goalSec;
  if (s.goalTab) goalTab = s.goalTab;
  if (s.mode === 'clear' || s.mode === 'fail') mode = s.mode;
}

// 공유 링크: ?b=보스&r=184.6&t=13:00  또는  ?r=184.6&hp=24.7
function stateFromUrl() {
  const q = new URLSearchParams(location.search);
  if (!q.has('r')) return null;
  const s = { ratio: q.get('r'), boss: q.get('b') || '' };
  if (q.has('hp')) {
    s.mode = 'fail'; s.hp = q.get('hp');
  } else if (q.has('t')) {
    const [m, sec = '0'] = q.get('t').split(':');
    s.mode = 'clear'; s.min = m; s.sec = String(parseInt(sec, 10) || 0);
  }
  return s;
}
function shareUrl() {
  const q = new URLSearchParams();
  const boss = el.boss.value.trim();
  if (boss) q.set('b', boss);
  q.set('r', String(num(el.ratio)));
  if (mode === 'clear') q.set('t', fmtTime(num(el.min) + num(el.sec) / 60));
  else q.set('hp', String(num(el.hp)));
  return location.origin + location.pathname + '?' + q.toString();
}

/* ---------- 계산 & 렌더 ---------- */
function update() {
  const ratio = num(el.ratio);
  const timeMin = num(el.min) + clamp(num(el.sec), 0, 59) / 60;
  const hpLeft = clamp(num(el.hp), 0, 100);
  const a = analyze({ ratio, mode, timeMin, hpLeft });
  last = { ...a, ratio, timeMin, hpLeft, valid: ratio > 0 && a.c > 0 };

  renderRecord();
  if (!ctrlOverride) el.ctrlIn.value = last.valid ? f1(a.c * 100) : '';
  el.ctrlSync.hidden = !ctrlOverride;
  renderGoal();
  renderPresets();
  save(STATE_KEY, readState());
}

function renderRecord() {
  const { ratio, ideal, actual, c, cleared, timeMin, hpLeft, valid } = last;
  const minR = minRatio(c);

  el.ctrlPct.innerHTML = valid ? f1(c * 100) + '<small>%</small>' : '—';
  el.minRatio.textContent = valid ? f1(minR) : '—';
  el.ctrlNote.textContent = valid
    ? `배율이 요구하는 분당 ${ideal.toFixed(2)}% 중 ${actual.toFixed(2)}%를 뽑음`
    : '';

  // 트랙: 20분 대비 위치
  const myPct = cleared ? clamp(timeMin / LIMIT_MIN * 100, 0, 100) : 100;
  const idealPct = ideal > 0 ? clamp(100 / ideal / LIMIT_MIN * 100, 0, 100) : 100;
  el.fill.style.width = myPct + '%';
  el.mark.style.left = `calc(${idealPct}% - 1px)`;
  el.fill.className = 'fill ' + (cleared ? 'done' : 'short');

  const v = el.verdict;
  if (ratio <= 0) { v.className = 'verdict'; v.textContent = '배율을 입력하면 결과가 나옵니다.'; return; }
  if (!valid) { v.className = 'verdict'; v.textContent = '기록을 입력하면 결과가 나옵니다.'; return; }
  if (cleared) {
    v.className = 'verdict ok';
    const over = timeMin > LIMIT_MIN ? ' (20분 초과 기록이라 참고용입니다)' : '';
    v.innerHTML = `배율 ${f1(ratio)}을 <b>${fmtTimeKo(timeMin)}</b>에 클리어. 이 컨트롤이면 배율 <b>${f1(minR)}</b>까지 20분 안에 잡힙니다.${over}`;
  } else {
    v.className = 'verdict no';
    v.innerHTML = `배율 ${f1(ratio)}에서 <b>${f1(hpLeft)}%</b> 남기고 종료. 20분 컷하려면 배율이 <b>${f1(minR)}</b> 이상이어야 합니다.`;
  }
}

function baseControl() {
  if (!ctrlOverride) return last?.valid ? last.c : 0;
  const v = num(el.ctrlIn) / 100;
  return v > 0 ? v : 0;
}

function kv(label, value, unit = '', note = '', cls = '') {
  return `<dl class="kv"><dt>${label}</dt><dd class="${cls}">${value}${unit ? `<small>${unit}</small>` : ''}</dd>${note ? `<p>${note}</p>` : ''}</dl>`;
}

function renderGoal() {
  const c = baseControl();
  if (!(c > 0)) {
    const msg = '<p class="empty">기준 컨트롤이 있어야 계산됩니다.</p>';
    el.outRatio.innerHTML = msg; el.outTime.innerHTML = msg;
    return;
  }

  // 다른 배율이면?
  const gr = num(el.goalRatio);
  const p = predict(gr, c);
  if (!p) {
    el.outRatio.innerHTML = '<p class="empty">배율을 입력하세요.</p>';
  } else if (p.cleared) {
    el.outRatio.innerHTML =
      kv('예상 클리어 타임', fmtTime(p.timeMin), '', `20분보다 ${fmtTimeKo(LIMIT_MIN - p.timeMin)} 여유`, 'ok-text') +
      kv('필요 컨트롤 (20분 컷)', f1(requiredControl(gr, LIMIT_MIN) * 100), '%', `지금보다 ${f1((c - requiredControl(gr, LIMIT_MIN)) * 100)}%p 여유`);
  } else {
    const need = requiredControl(gr, LIMIT_MIN);
    el.outRatio.innerHTML =
      kv('20분 종료 시 남은 hp', f1(p.hpLeft), '%', `잡으려면 약 ${fmtTime(p.timeMin)} 필요`, 'no-text') +
      kv('필요 컨트롤 (20분 컷)', f1(need * 100), '%', `지금보다 ${f1((need - c) * 100)}%p 더 필요`);
  }

  // 목표 시간
  const t = num(el.goalMin) + clamp(num(el.goalSec), 0, 59) / 60;
  const ratio = num(el.ratio);
  if (!(t > 0)) {
    el.outTime.innerHTML = '<p class="empty">목표 시간을 입력하세요.</p>';
    return;
  }
  const minR = minRatio(c, t);
  let html = kv(`${fmtTime(t)} 컷 최소 배율`, f1(minR), '', '기준 컨트롤을 유지할 때');
  if (ratio > 0) {
    const need = requiredControl(ratio, t);
    const ok = c >= need;
    html += kv(`배율 ${f1(ratio)}에서 필요 컨트롤`, f1(need * 100), '%',
      ok ? `이미 달성 (${f1((c - need) * 100)}%p 여유)` : `${f1((need - c) * 100)}%p 더 필요`,
      ok ? 'ok-text' : 'no-text');
  }
  el.outTime.innerHTML = html;
}

/* ---------- 프리셋 ---------- */
function savePresets() { save(PRESET_KEY, presets); }

function renderPresets() {
  const ratio = num(el.ratio);
  const boss = el.boss.value.trim();
  const c = baseControl();
  const sorted = [...presets].sort((a, b) => b.ratio - a.ratio);

  el.presetPickRow.hidden = presets.length === 0;
  el.presetChips.innerHTML = sorted.map(p => {
    const on = p.name === boss && p.ratio === ratio;
    return `<button type="button" class="chip" data-id="${p.id}" aria-pressed="${on}">${esc(p.name)}<b>${f1(p.ratio)}</b></button>`;
  }).join('');

  if (!presets.length) {
    el.presetList.innerHTML = '<li class="empty">아직 저장된 보스가 없습니다.</li>';
    return;
  }
  el.presetList.innerHTML = sorted.map(p => {
    const r = c > 0 ? predict(p.ratio, c) : null;
    const pred = !r ? '—'
      : r.cleared ? `<span class="ok-text">${fmtTime(r.timeMin)}</span>`
      : `<span class="no-text">hp ${f1(r.hpLeft)}%</span>`;
    return `<li>
      <button type="button" class="p-load" data-id="${p.id}" title="기록에 불러오기">${esc(p.name)}<span>${f1(p.ratio)}</span></button>
      <span class="p-pred">${pred}</span>
      <button type="button" class="p-del" data-id="${p.id}" aria-label="${esc(p.name)} 삭제">×</button>
    </li>`;
  }).join('');
}

function loadPreset(id) {
  const p = presets.find(x => x.id === id);
  if (!p) return;
  el.boss.value = p.name;
  el.ratio.value = p.ratio;
  update();
}

el.presetForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = el.pName.value.trim();
  const ratio = Math.round(num(el.pRatio) * 10) / 10;
  if (!name || !(ratio > 0)) return;
  const same = presets.find(p => p.name === name);
  if (same) same.ratio = ratio;
  else presets.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, ratio });
  savePresets();
  el.pName.value = ''; el.pRatio.value = '';
  el.pName.focus();
  renderPresets();
  toast(same ? `${name} 배율을 갱신했습니다` : `${name} 추가됨`);
});

el.presetList.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.classList.contains('p-load')) loadPreset(b.dataset.id);
  if (b.classList.contains('p-del')) {
    presets = presets.filter(p => p.id !== b.dataset.id);
    savePresets();
    renderPresets();
  }
});
el.presetChips.addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (b) loadPreset(b.dataset.id);
});

/* ---------- 공유 ---------- */
let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2000);
}

$('copyLink').addEventListener('click', async () => {
  const url = shareUrl();
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    toast('링크를 복사했습니다');
  } catch {
    prompt('아래 링크를 복사하세요', url);
  }
});

$('saveImage').addEventListener('click', async () => {
  if (!last?.valid) { toast('먼저 기록을 입력하세요'); return; }
  const { ratio, c, cleared, timeMin, hpLeft, ideal } = last;
  const boss = el.boss.value.trim();
  const blob = await renderCard({
    title: boss || `배율 ${f1(ratio)}`,
    line: (boss ? `배율 ${f1(ratio)} · ` : '') +
      (cleared ? `${fmtTimeKo(timeMin)} 클리어` : `20분 종료 · hp ${f1(hpLeft)}% 남음`),
    cleared,
    myPct: cleared ? clamp(timeMin / LIMIT_MIN * 100, 0, 100) : 100,
    idealPct: clamp(100 / ideal / LIMIT_MIN * 100, 0, 100),
    ctrl: f1(c * 100),
    minRatio: f1(minRatio(c)),
    url: shareUrl().replace(/^https?:\/\//, ''),
  });
  if (!blob) { toast('이미지를 만들지 못했습니다'); return; }
  const name = `boss-pace-${(boss || f1(ratio)).replace(/[\\/:*?"<>|\s]+/g, '_')}.png`;
  const file = new File([blob], name, { type: 'image/png' });

  // 모바일은 공유 시트, 그 외는 다운로드
  if (matchMedia('(pointer:coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('이미지를 저장했습니다');
});

/* ---------- 초기화 ---------- */
[25, 50, 75].forEach(p => {
  const t = document.createElement('div');
  t.className = 'tick'; t.style.left = p + '%';
  el.track.insertBefore(t, el.track.firstChild);
});

el.btnClear.onclick = () => setMode('clear');
el.btnFail.onclick = () => setMode('fail');
el.tabRatio.onclick = () => setTab('ratio');
el.tabTime.onclick = () => setTab('time');

[el.boss, el.ratio, el.min, el.sec, el.hp, el.goalRatio, el.goalMin, el.goalSec]
  .forEach(e => e.addEventListener('input', update));
el.ctrlIn.addEventListener('input', () => {
  ctrlOverride = el.ctrlIn.value !== '';
  el.ctrlSync.hidden = !ctrlOverride;
  renderGoal();
  renderPresets();
});
el.ctrlSync.addEventListener('click', () => { ctrlOverride = false; update(); });

presets = load(PRESET_KEY, []).filter(p => p && typeof p.name === 'string' && p.ratio > 0);
const fromUrl = stateFromUrl();
applyState(load(STATE_KEY, null));
applyState(fromUrl);
setTab(goalTab);
setMode(mode);
