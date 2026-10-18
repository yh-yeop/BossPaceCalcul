// 오프라인 캐시. 정적 파일을 설치 때 미리 받아 두고(precache), 이후 요청은
// 캐시를 먼저 돌려주면서 뒤에서 새로 받아 갱신한다(stale-while-revalidate).
// 파일을 바꿔 배포할 때 VERSION 을 올리면 activate 때 옛 캐시를 지운다.
const VERSION = 'v1';
const CACHE = `bpc-${VERSION}`;
const PRECACHE = [
  './index.html', './style.css', './app.js', './calc.js', './share.js', './data.js',
  './icon.svg', './manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('bpc-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // 폰트 CDN 등 외부 요청은 건드리지 않는다
  // 공유 링크(?b=&r=&t=)도 같은 페이지이므로 쿼리를 뗀 키로 캐시한다
  const key = url.pathname.endsWith('/') ? new Request(url.pathname + 'index.html') : new Request(url.origin + url.pathname);

  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(key);
      const network = fetch(request)
        .then(res => {
          if (res && res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        e.waitUntil(network); // 뒤에서 갱신
        return cached;
      }
      const res = await network;
      if (res) return res;
      // 오프라인이고 캐시도 없으면 페이지 요청은 index.html 로
      if (request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }),
  );
});
