// 순수 계산 로직. 배율 = 20분 동안 뽑아야 할 이상적인 딜량(%).
export const LIMIT_MIN = 20;

// 기록 → 컨트롤 비율(c, 1 = 배율과 정확히 같은 페이스)
export function analyze({ ratio, mode, timeMin, hpLeft }) {
  const ideal = ratio / LIMIT_MIN; // %/분
  let progress, elapsed;
  if (mode === 'clear') {
    progress = 100;
    elapsed = timeMin;
  } else {
    progress = clamp(100 - hpLeft, 0, 100);
    elapsed = LIMIT_MIN;
  }
  const actual = elapsed > 0 ? progress / elapsed : 0;
  const c = ideal > 0 ? actual / ideal : 0;
  return { ideal, actual, progress, elapsed, c, cleared: mode === 'clear' };
}

// 컨트롤 c로 배율 ratio 보스를 상대했을 때 결과
export function predict(ratio, c) {
  const rate = (ratio / LIMIT_MIN) * c; // %/분
  if (!(rate > 0)) return null;
  const timeMin = 100 / rate;
  if (timeMin <= LIMIT_MIN) return { cleared: true, timeMin, hpLeft: 0 };
  return { cleared: false, timeMin, hpLeft: 100 - rate * LIMIT_MIN };
}

// 배율 ratio 보스를 targetMin 안에 잡는 데 필요한 컨트롤
export function requiredControl(ratio, targetMin) {
  return ratio > 0 && targetMin > 0 ? (100 * LIMIT_MIN) / (ratio * targetMin) : 0;
}

// 컨트롤 c로 targetMin 안에 잡으려면 필요한 최소 배율
export function minRatio(c, targetMin = LIMIT_MIN) {
  return c > 0 && targetMin > 0 ? (100 * LIMIT_MIN) / (c * targetMin) : 0;
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

const KO_UNITS = [['경', 1e16], ['조', 1e12], ['억', 1e8], ['만', 1e4]];

// "350조 5000억", "1.2경", "12,345,678" → 숫자. 해석 불가면 NaN
export function parseKoNum(str) {
  const s = String(str).replace(/[,\s]/g, '');
  if (!s) return NaN;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const re = /(\d+(?:\.\d+)?)(경|조|억|만)?/y;
  let total = 0, m;
  while (re.lastIndex < s.length) {
    m = re.exec(s);
    if (!m) return NaN;
    const unit = KO_UNITS.find(u => u[0] === m[2]);
    total += parseFloat(m[1]) * (unit ? unit[1] : 1);
  }
  return total;
}

// 큰 수 → 한글 단위 약식 ("1.26경", "3257조", "8220억")
export function fmtKoShort(n) {
  for (const [u, v] of KO_UNITS) {
    if (n >= v) {
      const x = n / v;
      const d = x >= 1000 ? 0 : x >= 100 ? 1 : 2;
      return parseFloat(x.toFixed(d)).toLocaleString('ko-KR') + u;
    }
  }
  return Math.round(n).toLocaleString('ko-KR');
}

// 분(소수) → "m:ss"
export function fmtTime(min) {
  const total = Math.round(min * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + String(s).padStart(2, '0');
}

// 분(소수) → "m분 s초"
export function fmtTimeKo(min) {
  const total = Math.round(min * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? `${m}분 ${s}초` : `${m}분`;
}
