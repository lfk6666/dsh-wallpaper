/**
 * @local/dsh-wallpaper — client half.
 *
 * Renders a full-viewport background layer behind the DSH web UI and a small
 * settings panel to configure it. Supports:
 *   - static image wallpapers (URL or uploaded file)
 *   - dynamic video wallpapers (URL or uploaded file, muted loop by default)
 *   - built-in animated gradient scenes (no file needed)
 *   - per-wallpaper opacity / blur / dim adjustments, persisted in localStorage
 *
 * Uploaded media is stored in IndexedDB so it survives reloads; URL sources
 * store no local copy at all.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-wallpaper',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    // ------------------------------------------------------------------ //
    // Settings store (localStorage persisted, tiny pub/sub)              //
    // ------------------------------------------------------------------ //
    const LS_KEY = 'dsh-wallpaper:settings:v1';

    const DEFAULTS = {
      mode: 'none',            // none | builtin | image | video
      builtin: 'aurora',       // aurora | sunset | ocean
      srcKind: 'url',          // url | upload  (for image/video)
      url: '',
      mediaId: null,           // IndexedDB key of the uploaded blob
      mediaName: '',
      opacity: 1,              // media element opacity 0..1
      blur: 0,                 // px
      dim: 0,                  // black overlay alpha 0..0.9
      muted: true,             // video audio
      rate: 1,                 // video playback rate
      transparentApp: true,    // make app containers transparent
      extraCss: '',
    };

    function readSettings() {
      try {
        const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
        // One-time self-heal: recover states that render nothing at all —
        // transparency off, image/video mode with no source, or opacity so
        // low the wallpaper is invisible. Restores a visible built-in scene.
        const noSource = (s.mode === 'image' || s.mode === 'video') && !(
          (s.srcKind === 'url' && s.url) || (s.srcKind === 'upload' && s.mediaId)
        );
        const broken = !s.transparentApp || noSource || s.opacity < 0.3;
        if (broken && !localStorage.getItem(LS_KEY + ':migrated1')) {
          if (noSource) { s.mode = 'builtin'; s.builtin = 'aurora'; }
          s.transparentApp = true;
          if (s.opacity < 0.3) s.opacity = 1;
          try {
            localStorage.setItem(LS_KEY, JSON.stringify(s));
            localStorage.setItem(LS_KEY + ':migrated1', '1');
          } catch {}
        }
        return s;
      } catch { return { ...DEFAULTS }; }
    }

    function createStore() {
      let state = readSettings();
      const subs = new Set();
      return {
        get: () => state,
        set(patch) {
          state = { ...state, ...patch };
          try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {}
          subs.forEach((f) => { try { f(state); } catch {} });
        },
        replace(next) { this.set(next); },
        sub(f) { subs.add(f); return () => subs.delete(f); },
      };
    }
    const store = createStore();

    function useSettings() {
      const [s, setS] = React.useState(store.get());
      React.useEffect(() => store.sub((next) => { setS(next); }), []);
      return s;
    }

    // ------------------------------------------------------------------ //
    // IndexedDB blob store for uploaded media                            //
    // ------------------------------------------------------------------ //
    const IDB_NAME = 'dsh-wallpaper-media';
    const IDB_STORE = 'media';

    function idbOpen() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    async function idbPut(key, blob) {
      const db = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(blob, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }
    async function idbGet(key) {
      const db = await idbOpen();
      const blob = await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const r = tx.objectStore(IDB_STORE).get(key);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
      });
      db.close();
      return blob;
    }
    async function idbDel(key) {
      if (!key) return;
      const db = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }

    // ------------------------------------------------------------------ //
    // Styles                                                             //
    // ------------------------------------------------------------------ //
    const STYLE_ID = 'dsh-wallpaper-style';
    const LAYER_ID = 'dsh-wallpaper-layer';

    const BASE_CSS = `
#${LAYER_ID} {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;
  background: transparent;
}
#${LAYER_ID} .dsh-wp-media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform-origin: center;
}
#${LAYER_ID} .dsh-wp-dim {
  position: absolute;
  inset: 0;
  background: #000;
}
/* Built-in animated scenes */
#${LAYER_ID} .dsh-wp-scene { position: absolute; inset: -20%; }
#${LAYER_ID} .dsh-wp-scene > div { position: absolute; inset: 0; }
@keyframes dshWpDrift1 {
  0%   { transform: translate3d(-6%, -4%, 0) scale(1.1) rotate(0.001deg); }
  50%  { transform: translate3d(6%, 5%, 0) scale(1.25) rotate(0.001deg); }
  100% { transform: translate3d(-6%, -4%, 0) scale(1.1) rotate(0.001deg); }
}
@keyframes dshWpDrift2 {
  0%   { transform: translate3d(5%, 6%, 0) scale(1.2) rotate(0.001deg); }
  50%  { transform: translate3d(-5%, -6%, 0) scale(1.05) rotate(0.001deg); }
  100% { transform: translate3d(5%, 6%, 0) scale(1.2) rotate(0.001deg); }
}
@keyframes dshWpHue {
  0%   { filter: hue-rotate(0deg) saturate(1); }
  50%  { filter: hue-rotate(24deg) saturate(1.15); }
  100% { filter: hue-rotate(0deg) saturate(1); }
}
#${LAYER_ID} .dsh-wp-scene > div:nth-child(1) { animation: dshWpDrift1 26s ease-in-out infinite, dshWpHue 34s ease-in-out infinite; }
#${LAYER_ID} .dsh-wp-scene > div:nth-child(2) { animation: dshWpDrift2 32s ease-in-out infinite; opacity: 0.85; }
#${LAYER_ID} .dsh-wp-scene.dsh-wp-aurora > div:nth-child(1) {
  background: radial-gradient(60% 80% at 20% 20%, rgba(38, 208, 124, 0.55), transparent 60%),
              radial-gradient(50% 70% at 80% 30%, rgba(87, 92, 230, 0.6), transparent 65%),
              linear-gradient(160deg, #07111f 10%, #0c1e33 55%, #10263f 100%);
}
#${LAYER_ID} .dsh-wp-scene.dsh-wp-aurora > div:nth-child(2) {
  background: radial-gradient(45% 60% at 60% 75%, rgba(46, 230, 180, 0.35), transparent 60%),
              radial-gradient(35% 45% at 30% 60%, rgba(120, 80, 255, 0.4), transparent 65%);
}
#${LAYER_ID} .dsh-wp-scene.dsh-wp-sunset > div:nth-child(1) {
  background: radial-gradient(70% 60% at 70% 25%, rgba(255, 176, 86, 0.65), transparent 62%),
              linear-gradient(180deg, #2a1140 0%, #63205c 45%, #b0483f 85%, #e2793f 100%);
}
#${LAYER_ID} .dsh-wp-scene.dsh-wp-sunset > div:nth-child(2) {
  background: radial-gradient(40% 50% at 25% 70%, rgba(255, 105, 140, 0.4), transparent 60%),
              radial-gradient(30% 40% at 80% 60%, rgba(255, 210, 120, 0.45), transparent 60%);
}
#${LAYER_ID} .dsh-wp-scene.dsh-wp-ocean > div:nth-child(1) {
  background: radial-gradient(60% 70% at 75% 20%, rgba(40, 160, 220, 0.55), transparent 62%),
              linear-gradient(170deg, #04121f 0%, #07293f 50%, #0a3d55 100%);
}
#${LAYER_ID} .dsh-wp-scene.dsh-wp-ocean > div:nth-child(2) {
  background: radial-gradient(50% 45% at 25% 75%, rgba(30, 220, 220, 0.35), transparent 60%),
              radial-gradient(35% 40% at 70% 80%, rgba(60, 110, 255, 0.4), transparent 65%);
}
/* Settings panel */
.dsh-wp-panel {
  position: fixed;
  top: 64px;
  right: 16px;
  z-index: 900000;
  width: 320px;
  max-height: calc(100vh - 96px);
  overflow: auto;
  padding: 14px;
  border-radius: 14px;
  background: rgba(24, 26, 32, 0.92);
  color: #e8eaf0;
  font-size: 13px;
  line-height: 1.5;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(10px);
}
.dsh-wp-panel h3 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
.dsh-wp-row { margin: 10px 0; }
.dsh-wp-row label { display: block; margin-bottom: 4px; opacity: 0.85; }
.dsh-wp-btns { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-wp-panel button {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  font: inherit;
  padding: 4px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.dsh-wp-panel button:hover { background: rgba(255, 255, 255, 0.16); }
.dsh-wp-panel button.dsh-wp-on { background: #4f7cff; border-color: #4f7cff; color: #fff; }
.dsh-wp-panel input[type="text"] {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  color: inherit;
  font: inherit;
  padding: 5px 8px;
}
.dsh-wp-panel input[type="range"] { width: 100%; }
.dsh-wp-panel textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 56px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  color: inherit;
  font: 12px/1.45 ui-monospace, Consolas, monospace;
  padding: 6px 8px;
}
.dsh-wp-panel .dsh-wp-muted { opacity: 0.6; font-size: 12px; }
.dsh-wp-toggle-btn {
  appearance: none;
  border: none;
  background: transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  opacity: 0.72;
  padding: 2px 6px;
  border-radius: 8px;
  font: inherit;
}
.dsh-wp-toggle-btn:hover { opacity: 1; background: rgba(128, 128, 128, 0.18); }
`;

    /**
     * Selectors of full-bleed structural containers whose solid backgrounds
     * would hide the wallpaper. Verified against the current DSH build; the
     * settings panel exposes an "extra CSS" escape hatch for future builds.
     */
    const TRANSPARENT_SELECTORS = [
      'html', 'body', '#root', '#root > div',
      '[class$="_frame"]',
      '[class$="_centerCol"]',
      '[class$="_centerCol"] > *',
      '[class$="_centerCol"] [class$="_root"]',
      '[class$="_scrollBody"]', '[class$="_body"]',
    ];

    // ------------------------------------------------------------------ //
    // Runtime auto-transparency: find elements that cover the viewport   //
    // and paint a fully opaque background, and clear them. Makes the     //
    // wallpaper work regardless of theme, page or DSH build changes.     //
    // ------------------------------------------------------------------ //
    const autoCleared = new WeakSet();
    let autoTimer = null;

    function autoTransparentPass() {
      const rootEl = document.getElementById('root');
      if (!rootEl) return;
      const vw = innerWidth, vh = innerHeight;
      if (!vw || !vh) return;
      const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_ELEMENT);
      let n;
      while ((n = walker.nextNode())) {
        if (autoCleared.has(n)) continue;
        const tag = n.tagName;
        if (tag !== 'DIV' && tag !== 'MAIN' && tag !== 'SECTION' && tag !== 'ASIDE' && tag !== 'HEADER' && tag !== 'NAV') continue;
        const cs = getComputedStyle(n);
        if (cs.position === 'fixed') continue;
        const bg = cs.backgroundColor;
        if (!bg || bg === 'transparent' || bg.startsWith('rgba(0, 0, 0, 0)')) continue;
        // only fully opaque colors (alpha === 1); translucent tints are welcome
        const m = bg.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
        if (!m) continue;
        if (m[4] !== undefined && parseFloat(m[4]) < 0.999) continue;
        if (cs.backgroundImage && cs.backgroundImage !== 'none') continue;
        const r = n.getBoundingClientRect();
        // sidebar/rightbar typically take 20-40% of the width, so the main
        // content column sits around 60-80% of the viewport — use 0.55
        if (r.width < vw * 0.55 || r.height < vh * 0.8) continue;
        // skip our own panel tree
        if (n.closest && n.closest('.dsh-wp-panel')) continue;
        n.style.setProperty('background-color', 'transparent', 'important');
        autoCleared.add(n);
      }
    }

    function startAutoTransparent() {
      if (autoTimer) return;
      let ticks = 0;
      autoTimer = setInterval(() => {
        try { autoTransparentPass(); } catch {}
        ticks++;
        if (ticks >= 40) { clearInterval(autoTimer); autoTimer = null; }
      }, 500);
      window.addEventListener('resize', () => { try { autoTransparentPass(); } catch {} });
    }

    function useInjectedStyle(settings) {
      React.useEffect(() => {
        let el = document.getElementById(STYLE_ID);
        if (!el) {
          el = document.createElement('style');
          el.id = STYLE_ID;
          document.head.appendChild(el);
        }
        el.textContent = buildCss(settings);
        return () => { el.textContent = ''; };
      }, [settings.transparentApp, settings.extraCss]);
      // auto scan while the wallpaper is on and transparency is enabled
      React.useEffect(() => {
        if (settings.mode !== 'none' && settings.transparentApp) {
          startAutoTransparent();
          startDiag();
          try { autoTransparentPass(); } catch {}
        }
      }, [settings.mode, settings.transparentApp]);
    }

    // ------------------------------------------------------------------ //
    // Diagnostics: dump visibility analysis into localStorage so the     //
    // state of a real page can be inspected from outside the browser.    //
    // ------------------------------------------------------------------ //
    const DIAG_KEY = 'dsh-wallpaper:diag';
    let diagTimer = null;

    function writeDiag() {
      try {
        const layer = document.getElementById(LAYER_ID);
        const stackAt = (fx, fy) => {
          const x = Math.round(innerWidth * fx), y = Math.round(innerHeight * fy);
          return document.elementsFromPoint(x, y).slice(0, 8).map((el) => {
            const cs = getComputedStyle(el);
            return {
              t: el.tagName, c: (el.className || '').toString().slice(0, 40),
              bg: cs.backgroundColor, bi: cs.backgroundImage !== 'none' ? 1 : 0,
              z: cs.zIndex, pos: cs.position,
            };
          });
        };
        const offenders = [];
        const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
        let n;
        while ((n = walker.nextNode())) {
          const cs = getComputedStyle(n);
          const bg = cs.backgroundColor;
          if (!bg || bg === 'transparent' || bg.startsWith('rgba(0, 0, 0, 0)')) continue;
          const r = n.getBoundingClientRect();
          if (r.width >= innerWidth * 0.5 && r.height >= innerHeight * 0.5) {
            offenders.push({ t: n.tagName, c: (n.className || '').toString().slice(0, 50), bg, w: Math.round(r.width), h: Math.round(r.height) });
          }
        }
        const diag = {
          at: new Date().toISOString(),
          vw: innerWidth, vh: innerHeight,
          layer: layer ? {
            parent: layer.parentElement ? layer.parentElement.tagName : null,
            z: getComputedStyle(layer).zIndex,
            rect: (() => { const r = layer.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
            scene: !!layer.querySelector('.dsh-wp-scene'),
            media: !!layer.querySelector('.dsh-wp-media'),
          } : null,
          styleLen: (document.getElementById(STYLE_ID) || { textContent: '' }).textContent.length,
          offenders: offenders.slice(0, 12),
          stackCenter: stackAt(0.5, 0.4),
          stackTopLeft: stackAt(0.3, 0.2),
        };
        localStorage.setItem(DIAG_KEY, JSON.stringify(diag));
      } catch {}
    }

    function startDiag() {
      if (diagTimer) return;
      let ticks = 0;
      diagTimer = setInterval(() => {
        try { writeDiag(); } catch {}
        ticks++;
        if (ticks >= 30) { clearInterval(diagTimer); diagTimer = null; }
      }, 3000);
    }

    function buildCss(settings) {
      const parts = [BASE_CSS];
      if (settings.transparentApp) {
        parts.push(
          `${TRANSPARENT_SELECTORS.join(', ')} { background: transparent !important; }`
        );
      }
      if (settings.extraCss && settings.extraCss.trim()) parts.push(settings.extraCss);
      return parts.join('\n\n');
    }

    // ------------------------------------------------------------------ //
    // Media source resolution                                            //
    // ------------------------------------------------------------------ //
    function useMediaSrc(settings) {
      const [src, setSrc] = React.useState(null);
      React.useEffect(() => {
        let dead = false;
        let objectUrl = null;
        (async () => {
          if (settings.mode !== 'image' && settings.mode !== 'video') { setSrc(null); return; }
          if (settings.srcKind === 'url') {
            if (!dead) setSrc(settings.url || null);
          } else if (settings.mediaId) {
            try {
              const blob = await idbGet(settings.mediaId);
              if (!dead && blob) {
                objectUrl = URL.createObjectURL(blob);
                setSrc(objectUrl);
              } else if (!dead) setSrc(null);
            } catch { if (!dead) setSrc(null); }
          } else if (!dead) setSrc(null);
        })();
        return () => { dead = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
      }, [settings.mode, settings.srcKind, settings.url, settings.mediaId]);
      return src;
    }

    // ------------------------------------------------------------------ //
    // Background layer — registered into the always-mounted              //
    // 'shell.overlay' slot; content is portaled to documentElement so    //
    // host layout, stacking contexts and pages cannot clip or unmount it.//
    // ------------------------------------------------------------------ //
    function WallpaperLayer() {
      const s = useSettings();
      useInjectedStyle(s);
      const src = useMediaSrc(s);

      const mediaStyle = {
        opacity: s.opacity,
        filter: s.blur > 0 ? `blur(${s.blur}px)` : undefined,
        // scale slightly so blurred edges never show a hard cutoff
        transform: s.blur > 0 ? 'scale(1.06)' : undefined,
      };

      let media = null;
      if (s.mode === 'builtin') {
        media = h('div', { className: `dsh-wp-scene dsh-wp-${s.builtin}` },
          h('div'), h('div'));
      } else if (s.mode === 'image' && src) {
        media = h('img', { className: 'dsh-wp-media', src, alt: '', style: mediaStyle, draggable: false });
      } else if (s.mode === 'video' && src) {
        media = h('video', {
          className: 'dsh-wp-media',
          src,
          autoPlay: true,
          loop: true,
          muted: s.muted,
          playsInline: true,
          style: mediaStyle,
          ref: (el) => { if (el) { try { el.playbackRate = s.rate; } catch {} } },
        });
      }

      return h('div', { id: LAYER_ID, 'aria-hidden': true },
        media,
        s.dim > 0 ? h('div', { className: 'dsh-wp-dim', style: { opacity: s.dim } }) : null
      );
    }

    // ------------------------------------------------------------------ //
    // Settings panel                                                     //
    // ------------------------------------------------------------------ //
    function Panel({ onClose }) {
      const s = useSettings();
      const [urlDraft, setUrlDraft] = React.useState(s.srcKind === 'url' ? s.url : '');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');

      const fileRef = React.useRef(null);

      async function onFile(e) {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        setError('');
        setBusy(true);
        try {
          const key = `media-${Date.now()}`;
          await idbPut(key, file);
          const old = s.mediaId;
          store.set({
            mediaId: key,
            mediaName: file.name,
            srcKind: 'upload',
            mode: file.type.startsWith('video/') ? 'video' : 'image',
          });
          if (old && old !== key) await idbDel(old);
        } catch (err) {
          setError('保存文件失败: ' + (err && err.message ? err.message : err));
        } finally {
          setBusy(false);
        }
      }

      function applyUrl() {
        const url = urlDraft.trim();
        if (!url) { setError('请输入 URL'); return; }
        if (!/^(https?:)?\/\//i.test(url)) { setError('仅支持 http(s) 直链'); return; }
        setError('');
        const isVideo = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(url);
        store.set({ url, srcKind: 'url', mode: isVideo ? 'video' : 'image' });
      }

      function resetAll() {
        store.replace({ ...DEFAULTS });
        setUrlDraft('');
        setError('');
      }

      const num = (v) => Number(v);
      const pct = (v) => Math.round(v * 100) + '%';

      return h('div', { className: 'dsh-wp-panel', onClick: (e) => e.stopPropagation() },
        h('h3', null, 'DSH 壁纸设置'),

        h('div', { className: 'dsh-wp-row' },
          h('label', null, '壁纸类型'),
          h('div', { className: 'dsh-wp-btns' },
            ['none', 'builtin', 'image', 'video'].map((m) =>
              h('button', {
                key: m,
                className: s.mode === m ? 'dsh-wp-on' : '',
                onClick: () => store.set({ mode: m }),
              }, { none: '关闭', builtin: '内置动画', image: '图片', video: '视频' }[m]))
          )
        ),

        s.mode === 'builtin' && h('div', { className: 'dsh-wp-row' },
          h('label', null, '动画场景'),
          h('div', { className: 'dsh-wp-btns' },
            ['aurora', 'sunset', 'ocean'].map((b) =>
              h('button', {
                key: b,
                className: s.builtin === b ? 'dsh-wp-on' : '',
                onClick: () => store.set({ builtin: b }),
              }, { aurora: '极光', sunset: '晚霞', ocean: '深海' }[b]))
          )
        ),

        (s.mode === 'image' || s.mode === 'video') && h('div', { className: 'dsh-wp-row' },
          h('label', null, '来源'),
          h('div', { className: 'dsh-wp-btns' },
            h('button', {
              className: s.srcKind === 'url' ? 'dsh-wp-on' : '',
              onClick: () => store.set({ srcKind: 'url' }),
            }, 'URL 直链'),
            h('button', {
              className: s.srcKind === 'upload' ? 'dsh-wp-on' : '',
              onClick: () => fileRef.current && fileRef.current.click(),
            }, busy ? '保存中…' : '上传文件'),
            h('input', {
              ref: fileRef, type: 'file',
              accept: s.mode === 'video' ? 'video/*' : 'image/*',
              style: { display: 'none' }, onChange: onFile,
            })
          ),
          s.srcKind === 'upload' && s.mediaName
            ? h('div', { className: 'dsh-wp-muted', style: { marginTop: 4 } }, `当前: ${s.mediaName}`)
            : null,
          s.srcKind === 'url' && h('div', { style: { marginTop: 6, display: 'flex', gap: 6 } },
            h('input', {
              type: 'text',
              placeholder: 'https://…(图片或视频直链)',
              value: urlDraft,
              onChange: (e) => setUrlDraft(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') applyUrl(); },
            }),
            h('button', { onClick: applyUrl }, '应用')
          )
        ),

        (s.mode === 'image' || s.mode === 'video') && !(
          (s.srcKind === 'url' && s.url) || (s.srcKind === 'upload' && s.mediaId)
        ) && h('div', { className: 'dsh-wp-row', style: { color: '#ffd76e' } },
          '尚未设置图片来源:请输入 URL 直链或上传文件。'),

        s.mode !== 'none' && !s.transparentApp && h('div', { className: 'dsh-wp-row', style: { color: '#ffd76e' } },
          '"应用透明化"未开启:壁纸会被应用背景完全遮挡,请开启它才能看到壁纸。'),

        s.mode !== 'none' && s.opacity < 0.3 && h('div', { className: 'dsh-wp-row', style: { color: '#ffd76e' } },
          '不透明度只有 ' + Math.round(s.opacity * 100) + '%:壁纸几乎不可见,建议调回 80%-100%。'),

        s.mode !== 'none' && h(React.Fragment, null,
          h('div', { className: 'dsh-wp-row' },
            h('label', null, `不透明度 ${pct(s.opacity)}`),
            h('input', {
              type: 'range', min: 0.1, max: 1, step: 0.05,
              value: s.opacity,
              onChange: (e) => store.set({ opacity: num(e.target.value) }),
            })
          ),
          h('div', { className: 'dsh-wp-row' },
            h('label', null, `模糊 ${s.blur}px`),
            h('input', {
              type: 'range', min: 0, max: 40, step: 1,
              value: s.blur,
              onChange: (e) => store.set({ blur: num(e.target.value) }),
            })
          ),
          h('div', { className: 'dsh-wp-row' },
            h('label', null, `压暗 ${pct(s.dim)}`),
            h('input', {
              type: 'range', min: 0, max: 0.9, step: 0.05,
              value: s.dim,
              onChange: (e) => store.set({ dim: num(e.target.value) }),
            })
          )
        ),

        s.mode === 'video' && h(React.Fragment, null,
          h('div', { className: 'dsh-wp-row' },
            h('label', null, '视频'),
            h('div', { className: 'dsh-wp-btns' },
              h('button', {
                className: s.muted ? 'dsh-wp-on' : '',
                onClick: () => store.set({ muted: !s.muted }),
              }, s.muted ? '静音' : '有声'),
              h('button', { onClick: () => store.set({ rate: 0.5 }) }, '0.5x'),
              h('button', { onClick: () => store.set({ rate: 1 }) }, '1x'),
              h('button', { onClick: () => store.set({ rate: 1.5 }) }, '1.5x')
            )
          ),
          !s.muted && h('div', { className: 'dsh-wp-muted' },
            '注意:浏览器可能阻止有声自动播放,切换后点一下页面即可。')
        ),

        h('div', { className: 'dsh-wp-row' },
          h('div', { className: 'dsh-wp-btns' },
            h('button', {
              className: s.transparentApp ? 'dsh-wp-on' : '',
              onClick: () => store.set({ transparentApp: !s.transparentApp }),
            }, '应用透明化'),
            h('button', { onClick: resetAll }, '恢复默认')
          )
        ),

        h('div', { className: 'dsh-wp-row' },
          h('label', null, '补充 CSS(可选,修复未来版本选择器变化)'),
          h('textarea', {
            value: s.extraCss,
            placeholder: '例如: .some-class { background: transparent !important; }',
            onChange: (e) => store.set({ extraCss: e.target.value }),
          })
        ),

        error && h('div', { className: 'dsh-wp-row', style: { color: '#ff8a8a' } }, error),

        h('div', { className: 'dsh-wp-row', style: { textAlign: 'right' } },
          h('button', { onClick: onClose }, '完成')
        )
      );
    }

    /** Always-mounted host: contributes only the portaled background layer. */
    function WallpaperLayerHost() {
      return ReactDOM.createPortal(h(WallpaperLayer), document.documentElement);
    }

    // ------------------------------------------------------------------ //
    // Toggle button (registered into 'sidebar.footer.action')            //
    // ------------------------------------------------------------------ //
    function WallpaperToggle() {
      const [open, setOpen] = React.useState(false);
      React.useEffect(() => {
        if (!open) return;
        const onDown = (e) => {
          const t = e.target;
          if (t && t.closest && (t.closest('.dsh-wp-panel') || t.closest('.dsh-wp-toggle-btn'))) return;
          setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
      }, [open]);

      return h(React.Fragment, null,
        h('button', {
          className: 'dsh-wp-toggle-btn',
          title: 'DSH 壁纸设置 / Wallpaper',
          onClick: () => setOpen((v) => !v),
        },
          h('svg', { width: 14, height: 14, viewBox: '0 0 64 64', 'aria-hidden': true },
            h('rect', { x: 4, y: 4, width: 56, height: 56, rx: 14, fill: '#4f7cff' }),
            h('circle', { cx: 42, cy: 22, r: 7, fill: '#ffd76e' }),
            h('path', { d: 'M12 46 L26 28 L36 41 L42 34 L52 46 Z', fill: '#eaf1ff' })),
          h('span', null, '壁纸')
        ),
        open ? h(Panel, { onClose: () => setOpen(false) }) : null
      );
    }

    // ------------------------------------------------------------------ //
    // Plugin entry                                                       //
    // ------------------------------------------------------------------ //
    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          ctx.slots.inject('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay', id: 'dsh-wallpaper-layer', order: -100,
          }, WallpaperLayerHost));
          ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
            name: 'sidebar.footer.action', id: 'dsh-wallpaper-toggle', order: 50,
          }, WallpaperToggle));
        } catch (e) {
          console.error('[dsh-wallpaper] slots.inject failed:', e);
          throw e;
        }
      },
    };
  },
});
