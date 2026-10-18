// 결과 카드를 캔버스로 그려 PNG로 내보낸다.
const C = {
  ink: '#150F1E', panel: '#1F1730', line: '#2E2444',
  text: '#EDE7F7', dim: '#A497C2', faint: '#6F6291',
  gold: '#E8B75C', hp: '#E2574C', mint: '#4FD1A5', violet: '#8E7BE8',
};
const SANS = "'IBM Plex Sans KR', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const DISPLAY = "'Black Han Sans', sans-serif";

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxW, size, family, weight = '') {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${family}`;
    if (ctx.measureText(text).width <= maxW) break;
    s -= 2;
  } while (s > 20);
  return s;
}

/**
 * @param {object} d
 * @param {string} d.title  큰 제목 (보스 이름 또는 "배율 x")
 * @param {string} d.line   결과 요약 한 줄
 * @param {boolean} d.cleared
 * @param {number} d.myPct   트랙 채움 (0~100)
 * @param {number} d.idealPct 이상 지점 (0~100)
 * @param {string} d.ctrl    "87.3"
 * @param {string} d.minRatio "211.5"
 * @param {string} d.url
 * @param {{c:number, cleared:boolean, ts:number}[]} [d.trend]
 *   컨트롤 추이(시간순). 2개 이상이면 카드 아래에 선 그래프를 그린다. 없으면 기존 레이아웃 그대로.
 */
export async function renderCard(d) {
  await document.fonts.ready;
  const trend = Array.isArray(d.trend) && d.trend.length >= 2 ? d.trend.slice(-TREND_MAX) : null;
  const W = 1080, H = trend ? 1240 : 960, P = 88;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = C.ink;
  ctx.fillRect(0, 0, W, H);

  // eyebrow
  ctx.fillStyle = C.gold;
  ctx.font = `500 26px ${MONO}`;
  ctx.textBaseline = 'alphabetic';
  const eb = '20분 기준 · 보스 페이스';
  ctx.fillText(eb, P, P + 26);
  const ebW = ctx.measureText(eb).width;
  const g = ctx.createLinearGradient(P + ebW + 20, 0, W - P, 0);
  g.addColorStop(0, '#8A6C2E'); g.addColorStop(1, 'rgba(138,108,46,0)');
  ctx.fillStyle = g;
  ctx.fillRect(P + ebW + 20, P + 16, W - P * 2 - ebW - 20, 2);

  // 제목
  fitText(ctx, d.title, W - P * 2, 96, DISPLAY);
  ctx.fillStyle = C.text;
  ctx.fillText(d.title, P, P + 170);

  // 요약
  fitText(ctx, d.line, W - P * 2, 36, SANS, '400');
  ctx.fillStyle = d.cleared ? C.mint : C.hp;
  ctx.fillText(d.line, P, P + 236);

  // 트랙
  const ty = P + 320, th = 64, tw = W - P * 2;
  ctx.fillStyle = C.faint;
  ctx.font = `400 22px ${MONO}`;
  ctx.fillText('00:00', P, ty - 44);
  ctx.textAlign = 'right';
  ctx.fillText('20:00', W - P, ty - 44);
  ctx.textAlign = 'left';

  ctx.save();
  roundRect(ctx, P, ty, tw, th, 14);
  ctx.fillStyle = '#0F0A16';
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = C.line;
  [25, 50, 75].forEach(p => ctx.fillRect(P + tw * p / 100, ty, 2, th));
  const fw = tw * d.myPct / 100;
  const fg = ctx.createLinearGradient(P, 0, P + fw, 0);
  const rgb = d.cleared ? '79,209,165' : '226,87,76';
  fg.addColorStop(0, `rgba(${rgb},.25)`); fg.addColorStop(1, `rgba(${rgb},.5)`);
  ctx.fillStyle = fg;
  ctx.fillRect(P, ty, fw, th);
  ctx.fillStyle = d.cleared ? C.mint : C.hp;
  ctx.fillRect(P + fw - 4, ty, 4, th);
  ctx.restore();

  const ix = P + tw * d.idealPct / 100;
  ctx.fillStyle = C.gold;
  ctx.fillRect(ix - 2, ty - 6, 4, th + 12);
  ctx.font = `500 20px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText('이상', Math.min(Math.max(ix, P + 24), W - P - 24), ty - 14);
  ctx.textAlign = 'left';

  // 스탯 박스
  const by = ty + th + 90, bh = 250, gap = 28, bw = (W - P * 2 - gap) / 2;
  const boxes = [
    { label: '배율 대비 컨트롤', value: d.ctrl, unit: '%', bar: C.violet },
    { label: '20분 컷 최소 배율', value: d.minRatio, unit: '', bar: C.gold },
  ];
  boxes.forEach((b, i) => {
    const x = P + i * (bw + gap);
    ctx.save();
    roundRect(ctx, x, by, bw, bh, 24);
    ctx.fillStyle = C.panel;
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = b.bar;
    ctx.fillRect(x, by, 6, bh);
    ctx.restore();

    ctx.fillStyle = C.dim;
    ctx.font = `500 28px ${SANS}`;
    ctx.fillText(b.label, x + 40, by + 66);

    const vs = fitText(ctx, b.value, bw - 110, 96, MONO, '600');
    ctx.fillStyle = C.text;
    ctx.fillText(b.value, x + 40, by + 190);
    if (b.unit) {
      const vw = ctx.measureText(b.value).width;
      ctx.font = `400 ${Math.round(vs * 0.45)}px ${MONO}`;
      ctx.fillStyle = C.dim;
      ctx.fillText(b.unit, x + 44 + vw, by + 190);
    }
  });

  if (trend) drawTrend(ctx, trend, P, by + bh + 70, W - P * 2, 230);

  // 하단
  ctx.fillStyle = C.faint;
  ctx.font = `400 22px ${MONO}`;
  fitText(ctx, d.url, W - P * 2, 22, MONO, '400');
  ctx.fillText(d.url, P, H - P + 10);

  return new Promise(res => cv.toBlob(res, 'image/png'));
}

const TREND_MAX = 12;
const pad2 = n => String(n).padStart(2, '0');
const fmtDate = ts => { const dt = new Date(ts); return `${pad2(dt.getMonth() + 1)}.${pad2(dt.getDate())}`; };

// 컨트롤 추이 선 그래프. (x, y)에서 w × h 영역을 쓴다. 앱의 히스토리 그래프와 같은 규칙(100% 기준선, 잡음/못 잡음 색).
function drawTrend(ctx, trend, x, y, w, h) {
  const vals = trend.map(r => r.c * 100);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 4) { lo -= 2; hi += 2; }
  const padY = (hi - lo) * 0.12; lo -= padY; hi += padY;

  ctx.fillStyle = C.dim;
  ctx.font = `500 24px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText(`컨트롤 추이 · 최근 ${trend.length}회`, x, y);

  const top = y + 30, R = 100, bottom = y + h - 34, iw = w - R, ih = bottom - top;
  const px = i => x + (i / (trend.length - 1)) * iw;
  const py = v => top + ih - (v - lo) / (hi - lo) * ih;

  ctx.font = `500 20px ${MONO}`;
  if (100 > lo && 100 < hi) {
    ctx.save();
    ctx.strokeStyle = C.gold; ctx.globalAlpha = 0.7; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.moveTo(x, py(100)); ctx.lineTo(x + iw, py(100)); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = C.gold;
    ctx.fillText('100%', x + iw + 14, py(100) + 7);
  }

  ctx.strokeStyle = C.violet; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  vals.forEach((v, i) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v))));
  ctx.stroke();
  vals.forEach((v, i) => {
    const last = i === vals.length - 1;
    ctx.beginPath();
    ctx.arc(px(i), py(v), last ? 9 : 6, 0, Math.PI * 2);
    ctx.fillStyle = trend[i].cleared ? C.mint : C.hp;
    ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 3; ctx.stroke();
  });

  const vi = vals.length - 1;
  ctx.fillStyle = C.text;
  ctx.font = `600 24px ${MONO}`;
  ctx.fillText(f1(vals[vi]) + '%', x + iw + 14, py(vals[vi]) + 8);

  ctx.fillStyle = C.faint;
  ctx.font = `400 20px ${MONO}`;
  ctx.fillText(fmtDate(trend[0].ts), x, y + h);
  ctx.textAlign = 'right';
  ctx.fillText(fmtDate(trend[vi].ts), x + iw, y + h);
  ctx.textAlign = 'left';
}
const f1 = v => v.toFixed(1);
