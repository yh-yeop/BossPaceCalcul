import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMIT_MIN, analyze, predict, requiredControl, minRatio, clamp, fmtTime, fmtTimeKo,
} from '../calc.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('analyze(clear): 배율 200을 10분에 잡으면 컨트롤 1.0 (이상 속도 10%/분)', () => {
  const a = analyze({ ratio: 200, mode: 'clear', timeMin: 10, hpLeft: 0 });
  near(a.ideal, 10);
  near(a.actual, 10);
  near(a.c, 1);
  assert.equal(a.cleared, true);
  assert.equal(a.progress, 100);
  assert.equal(a.elapsed, 10);
});

test('analyze(clear): 배율 100을 정확히 20분에 잡으면 컨트롤 1.0, 더 빠르면 1 초과', () => {
  near(analyze({ ratio: 100, mode: 'clear', timeMin: 20 }).c, 1);
  near(analyze({ ratio: 100, mode: 'clear', timeMin: 10 }).c, 2);
  near(analyze({ ratio: 184.6, mode: 'clear', timeMin: 13 }).c, 100 / 13 / (184.6 / 20));
});

test('analyze(fail): 20분 종료 시 남은 hp로 진행률을 잡는다', () => {
  const a = analyze({ ratio: 150, mode: 'fail', timeMin: 0, hpLeft: 25 });
  assert.equal(a.progress, 75);
  assert.equal(a.elapsed, LIMIT_MIN);
  near(a.actual, 75 / 20);
  near(a.c, (75 / 20) / (150 / 20)); // = 0.5
  assert.equal(a.cleared, false);
  assert.equal(analyze({ ratio: 150, mode: 'fail', hpLeft: 120 }).progress, 0, 'hp는 0~100으로 잘라낸다');
});

test('analyze: 배율 0이나 시간 0이면 컨트롤 0 (NaN/Infinity 없음)', () => {
  assert.equal(analyze({ ratio: 0, mode: 'clear', timeMin: 10 }).c, 0);
  assert.equal(analyze({ ratio: 100, mode: 'clear', timeMin: 0 }).c, 0);
  assert.equal(analyze({ ratio: 100, mode: 'clear', timeMin: 0 }).actual, 0);
});

test('predict: 기록을 다시 넣으면 같은 결과가 나온다 (왕복)', () => {
  const a = analyze({ ratio: 184.6, mode: 'clear', timeMin: 13.5 });
  const p = predict(184.6, a.c);
  assert.equal(p.cleared, true);
  near(p.timeMin, 13.5);
  assert.equal(p.hpLeft, 0);
  const f = analyze({ ratio: 150, mode: 'fail', hpLeft: 24.7 });
  const q = predict(150, f.c);
  assert.equal(q.cleared, false);
  near(q.hpLeft, 24.7);
});

test('predict: 체감 배율 100이 20분 컷 경계', () => {
  const c = 0.5;
  assert.equal(predict(200, c).cleared, true);   // 체감 100
  near(predict(200, c).timeMin, 20);
  assert.equal(predict(199, c).cleared, false);  // 체감 99.5
  assert.ok(predict(199, c).hpLeft > 0 && predict(199, c).hpLeft < 1);
  assert.equal(predict(0, c), null);
  assert.equal(predict(100, 0), null);
});

test('requiredControl / minRatio 는 서로 역함수', () => {
  const ratio = 184.6, t = 15;
  const need = requiredControl(ratio, t);
  near(minRatio(need, t), ratio);
  near(requiredControl(minRatio(0.8, 12), 12), 0.8);
  near(minRatio(1), 100, 1e-9);          // 컨트롤 100% → 배율 100이면 20분 컷
  near(minRatio(0.5), 200);
  near(requiredControl(100, LIMIT_MIN), 1);
  assert.equal(requiredControl(0, 10), 0);
  assert.equal(minRatio(0), 0);
});

test('예상 시간 = 2000 ÷ (배율 × 컨트롤) 과 일치', () => {
  for (const [r, c] of [[150, 0.9], [300, 1.2], [80, 0.6]]) {
    const p = predict(r, c);
    near(p.timeMin, 2000 / (r * c));
  }
});

test('clamp / fmtTime / fmtTimeKo', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(fmtTime(13), '13:00');
  assert.equal(fmtTime(13.5), '13:30');
  assert.equal(fmtTime(0.999), '1:00', '반올림으로 60초가 되면 분이 올라간다');
  assert.equal(fmtTimeKo(13.5), '13분 30초');
  assert.equal(fmtTimeKo(13), '13분');
});
