import {
  LIMIT_MIN, analyze, predict, requiredControl, minRatio, clamp, fmtTime, fmtTimeKo,
} from './calc.js';
import { renderCard } from './share.js';

const $ = id => document.getElementById(id);
const el = {
  boss: $('boss'), ratio: $('ratio'),
  min: $('clearMin'), sec: $('clearSec'), hp: $('hpLeft'),
  clearBox: $('clearInputs'), failBox: $('failInputs'),
  btnClear: $('modeClear'), btnFail: $('modeFail'),
  track: $('track'), fill: $('fill'), mark: $('idealMark'),
  ctrlPct: $('ctrlPct'), ctrlNote: $('ctrlNote'), minRatio: $('minRatio'), verdict: $('verdict'),
  ctrlIn: $('ctrlIn'), ctrlSync: $('ctrlSync'),
  tabRatio: $('tabRatio'), tabTime: $('tabTime'), paneRatio: $('paneRatio'), paneTime: $('paneTime'),
  goalRatio: $('goalRatio'), goalMin: $('goalMin'), goalSec: $('goalSec'),
  outRatio: $('outRatio'), outTime: $('outTime'),
  feelList: $('feelList'), toast: $('toast'),
};

const STATE_KEY = 'bpc:state';

let mode = 'clear';
let goalTab = 'ratio';
let ctrlOverride = false; // 기준 컨트롤을 직접 입력했는지
let last = null;          // 마지막 기록 분석 결과

const num = e => { const v = parseFloat(e.value); return isFinite(v) ? v : 0; };
const f1 = v => v.toFixed(1);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  persist();
}
/* ---------- 입력 상태 ---------- */
function readState() {
  return {
    boss: el.boss.value.trim(), ratio: el.ratio.value, mode,
    min: el.min.value, sec: el.sec.value, hp: el.hp.value,
    goalRatio: el.goalRatio.value, goalMin: el.goalMin.value, goalSec: el.goalSec.value, goalTab,
  };
}
function persist() { save(STATE_KEY, readState()); }
function applyState(s) {
  if (!s) return;
  const map = { boss: el.boss, ratio: el.ratio, min: el.min, sec: el.sec, hp: el.hp,
    goalRatio: el.goalRatio, goalMin: el.goalMin, goalSec: el.goalSec };
  for (const [k, e] of Object.entries(map)) if (s[k] != null) e.value = s[k];
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
  renderFeel();
  persist();
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
      kv('예상 클리어 타임', fmtTime(p.timeMin), '', `체감 배율 ${f1(gr * c)} · 20분보다 ${fmtTimeKo(LIMIT_MIN - p.timeMin)} 여유`, 'ok-text') +
      kv('필요 컨트롤 (20분 컷)', f1(requiredControl(gr, LIMIT_MIN) * 100), '%', `지금보다 ${f1((c - requiredControl(gr, LIMIT_MIN)) * 100)}%p 여유`);
  } else {
    const need = requiredControl(gr, LIMIT_MIN);
    el.outRatio.innerHTML =
      kv('20분 종료 시 남은 hp', f1(p.hpLeft), '%', `체감 배율 ${f1(gr * c)} · 잡으려면 약 ${fmtTime(p.timeMin)} 필요`, 'no-text') +
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

// 배율 단계별 체감 배율 표. 내 기록 배율과 20분 컷 경계도 함께 넣는다
const FEEL_STEPS = [50, 75, 100, 125, 150, 175, 200, 250, 300, 400, 500];

function renderFeel() {
  const c = baseControl();
  if (!(c > 0)) {
    el.feelList.innerHTML = '<li class="empty">기준 컨트롤이 있어야 계산됩니다.</li>';
    return;
  }
  const mine = num(el.ratio);
  const edge = minRatio(c);
  const rows = FEEL_STEPS.map(r => ({ r }));
  if (mine > 0) rows.push({ r: mine, label: '내 기록' });
  rows.push({ r: edge, label: '20분 컷 경계' });
  const seen = new Set();
  const list = rows
    .sort((a, b) => a.r - b.r || (b.label ? 1 : -1))
    .filter(x => { const k = f1(x.r); if (seen.has(k)) return false; seen.add(k); return true; });

  el.feelList.innerHTML = list.map(({ r, label }) => {
    const feel = r * c;
    const p = predict(r, c);
    const pred = p.cleared
      ? `<span class="ok-text">${fmtTime(p.timeMin)}</span>`
      : `<span class="no-text">hp ${f1(p.hpLeft)}%</span>`;
    const cls = label === '내 기록' ? ' class="mine"' : label ? ' class="edge"' : '';
    return `<li${cls}><button type="button" data-r="${f1(r)}">
      <span class="f-ratio">${f1(r)}${label ? `<span class="tag">${label}</span>` : ''}</span>
      <span class="f-feel ${p.cleared ? 'ok-text' : 'no-text'}">${f1(feel)}</span>
      <span class="f-pred">${pred}</span>
    </button></li>`;
  }).join('');
}

el.feelList.addEventListener('click', e => {
  const b = e.target.closest('button[data-r]');
  if (!b) return;
  el.goalRatio.value = b.dataset.r;
  setTab('ratio');
  renderGoal();
  $('goalTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
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

[el.ratio, el.min, el.sec, el.hp, el.goalRatio, el.goalMin, el.goalSec]
  .forEach(e => e.addEventListener('input', update));
el.boss.addEventListener('input', update);
el.ctrlIn.addEventListener('input', () => {
  ctrlOverride = el.ctrlIn.value !== '';
  el.ctrlSync.hidden = !ctrlOverride;
  renderGoal();
  renderFeel();
});
el.ctrlSync.addEventListener('click', () => { ctrlOverride = false; update(); });

const fromUrl = stateFromUrl();
applyState(load(STATE_KEY, null));
applyState(fromUrl);
setTab(goalTab);
setMode(mode);
