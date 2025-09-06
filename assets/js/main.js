// Main site script: partials loading, member auth (localStorage), comments helpers
(function(){
  const MEMBER_KEY = 'lz_member';
  const DEVICE_KEY = 'lz_device_id';

  function getMember(){
    try{ return JSON.parse(localStorage.getItem(MEMBER_KEY) || 'null'); }catch{ return null; }
  }
  function setMember(member){
    localStorage.setItem(MEMBER_KEY, JSON.stringify(member));
    updateMemberUI();
  }
  function logout(){ localStorage.removeItem(MEMBER_KEY); updateMemberUI(); }

  function getDeviceId(){
    let id = localStorage.getItem(DEVICE_KEY);
    if(id) return id;
    try{
      const arr = new Uint8Array(16);
      (crypto && crypto.getRandomValues) ? crypto.getRandomValues(arr) : arr.forEach((_,i)=> arr[i] = Math.floor(Math.random()*256));
      id = Array.from(arr).map(b=> b.toString(16).padStart(2,'0')).join('');
    }catch(_){ id = 'dev-' + Math.random().toString(16).slice(2) + Date.now().toString(16); }
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  }

  async function loadPartials(){
    const headerEl = document.getElementById('header');
    const footerEl = document.getElementById('footer');
    const base = getBasePrefix();
    if(headerEl){ headerEl.innerHTML = await fetchText(base + 'partials/header.html'); }
    if(footerEl){ footerEl.innerHTML = await fetchText(base + 'partials/footer.html'); }
    fixPartialPaths(base);
    fixDocumentPaths(base);
    // Auto-detect backend health to turn off mock mode
    try{
      const res = await fetch('/api/health', { cache: 'no-cache' });
      if(res.ok){ setMockMode(false); setApiBase(''); }
    }catch(e){ /* keep mock mode */ }
    setActiveNav();
    bindMemberActions();
    initInteractions();
  }

  function setActiveNav(){
    const path = location.pathname.replace(/\\+/g,'/');
    const links = document.querySelectorAll('.nav-links a[data-link]');
    links.forEach(a => {
      const isActive = a.getAttribute('data-link') === path || (path.endsWith('/') && a.getAttribute('data-link') === 'index.html');
      a.classList.toggle('active', !!isActive);
    });
  }

  function updateMemberUI(){
    const badge = document.getElementById('member-badge');
    const action = document.getElementById('member-action');
    const m = getMember();
    if(!badge || !action) return;
    if(m && m.token){
      const roleLabel = m.role === 'premium' ? '高级会员' : (m.role === 'admin' ? '管理员' : '普通会员');
      badge.textContent = roleLabel || '会员';
      action.textContent = '退出';
    }else{
      badge.textContent = '游客';
      action.textContent = '登录/注册';
    }
  }

  function bindMemberActions(){
    updateMemberUI();
    const action = document.getElementById('member-action');
    if(!action) return;
    action.addEventListener('click', async () => {
      const m = getMember();
      if(m && m.token){ logout(); return; }
      try{
        if(!apiState.mockMode){
          const start = await apiGet('/api/auth/wechat/start');
          if(start && start.url){ location.href = start.url; return; }
        }
      }catch(e){ /* fallback to demo login */ }
      const name = prompt('输入昵称以注册/登录 (演示模式)');
      if(!name) return;
      const role = confirm('是否开通高级会员？点击 确认=高级会员/取消=普通会员') ? 'premium' : 'normal';
      setMember({ name, role, time: Date.now() });
      alert('登录成功: ' + name + ' [' + (role==='premium'?'高级会员':'普通会员') + ']');
    });
    // theme toggle
    const toggle = document.getElementById('theme-toggle');
    if(toggle){
      const key='lz_theme';
      const current = localStorage.getItem(key)||'light';
      applyTheme(current);
      toggle.textContent = current==='light'?'浅色':'深色';
      toggle.addEventListener('click', ()=>{
        const now = (localStorage.getItem(key)||'light')==='light'?'dark':'light';
        localStorage.setItem(key, now);
        applyTheme(now);
        toggle.textContent = now==='light'?'浅色':'深色';
      });
    }
  }

  function applyTheme(mode){
    document.documentElement.setAttribute('data-theme', mode);
  }

  async function fetchText(url){
    const res = await fetch(url, { cache: 'no-cache' });
    return await res.text();
  }

  async function fetchJSON(url){
    const res = await fetch(url, { cache: 'no-cache' });
    return await res.json();
  }

  // --- Backend-ready API adapter (prep for future server) ---
  const apiState = {
    baseUrl: '', // e.g. 'http://localhost:8080'
    mockMode: true // true = use static JSONs; false = call backend
  };

  function setApiBase(base){ apiState.baseUrl = base || ''; }
  function setMockMode(on){ apiState.mockMode = !!on; }

  function buildAuthHeaders(){
    const m = getMember();
    const h = { 'X-Device-Id': getDeviceId() };
    if(m && m.token) h['Authorization'] = 'Bearer ' + m.token;
    return h;
  }

  async function handleAuthError(res){
    try{
      const data = await res.json();
      const msg = (data && (data.error || data.message)) || '认证失败，请重新登录';
      logout();
      alert(msg);
    }catch(_){ logout(); }
    location.href = getBasePrefix() + 'index.html';
  }

  async function apiGet(pathOrUrl){
    if(apiState.mockMode){
      // Try real backend first (useful when backend is running during local preview)
      try{
        const urlTry = (apiState.baseUrl || '') + pathOrUrl;
        const resTry = await fetch(urlTry, { credentials: 'include', headers: buildAuthHeaders() });
        if(resTry.ok) return await resTry.json();
      }catch(_){ /* fall back */ }
      // Fallback for API paths in mock mode: return empty collection
      if(String(pathOrUrl||'').startsWith('/api/')) return [];
      // Otherwise fetch static json
      return await fetchJSON(pathOrUrl);
    }
    const url = (apiState.baseUrl || '') + pathOrUrl;
    const res = await fetch(url, { credentials: 'include', headers: buildAuthHeaders() });
    if(res.status === 401 || res.status === 403){ await handleAuthError(res); throw new Error('Auth error'); }
    if(!res.ok) throw new Error('GET failed: ' + res.status);
    return await res.json();
  }

  async function apiPost(path, body, token){
    if(apiState.mockMode){
      // Try real backend even在mock模式（便于本地预览时使用后端）
      try{
        const urlTry = (apiState.baseUrl || '') + path;
        const resTry = await fetch(urlTry, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...buildAuthHeaders(),
            ...(token ? { 'Authorization': 'Bearer ' + token } : {})
          },
          body: JSON.stringify(body || {})
        });
        if(resTry.ok) return await resTry.json();
      }catch(_){ /* fall back to mock */ }
      // fallback: echo
      return { ok: true, mock: true, data: body };
    }
    const url = (apiState.baseUrl || '') + path;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
      },
      body: JSON.stringify(body || {})
    });
    if(res.status === 401 || res.status === 403){ await handleAuthError(res); throw new Error('Auth error'); }
    if(!res.ok) throw new Error('POST failed: ' + res.status);
    return await res.json();
  }

  async function renderAd(targetSelector){
    try{
      const base = getBasePrefix();
      const ad = await fetchJSON(base + 'data/ad.json');
      if(!ad || !ad.enabled) return;
      const root = document.querySelector(targetSelector);
      if(!root) return;
      root.innerHTML = `
        <div class="card">
          <div class="card-body ad">
            <img src="${base}${ad.image}" alt="ad" />
            <div class="ad-meta">
              <div class="row"><span class="badge">${ad.badge||'AD'}</span></div>
              <h3 class="title">${escapeHtml(ad.title||'广告位')}</h3>
              <p class="desc">${escapeHtml(ad.desc||'')}</p>
            </div>
            <div>
              <a class="btn primary" href="${ad.ctaLink||'#'}" target="_blank" rel="noreferrer">${escapeHtml(ad.ctaText||'了解更多')}</a>
            </div>
          </div>
        </div>`;
    }catch(e){ console.warn('ad render failed', e); }
  }

  function ensureAuth(required){
    const m = getMember();
    if(!required) return true;
    if(!m){ alert('请先登录会员'); return false; }
    if(required === 'premium' && m.role !== 'premium'){ alert('需要高级会员权限'); return false; }
    return true;
  }

  function initComments(sectionId, storageKey){
    const root = document.getElementById(sectionId);
    if(!root) return;
    const listEl = root.querySelector('.comments-list');
    const formEl = root.querySelector('form');
    const nameEl = formEl.querySelector('input[name=name]');
    const textEl = formEl.querySelector('textarea[name=text]');
    const render = () => {
      const data = JSON.parse(localStorage.getItem(storageKey) || '[]');
      listEl.innerHTML = data.map(c => `<div class=\"card\"><div class=\"card-body\"><div class=\"row\"><strong>${escapeHtml(c.name)}</strong><span class=\"muted\">${new Date(c.time).toLocaleString()}</span></div><div>${escapeHtml(c.text)}</div></div></div>`).join('');
    };
    formEl.addEventListener('submit', (e)=>{
      e.preventDefault();
      const m = getMember();
      if(!m){ alert('登录后可发表评论'); return; }
      const list = JSON.parse(localStorage.getItem(storageKey) || '[]');
      list.unshift({ name: m.name || '会员', text: textEl.value.trim(), time: Date.now() });
      localStorage.setItem(storageKey, JSON.stringify(list.slice(0,200)));
      textEl.value='';
      render();
    });
    render();
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(ch){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch]);
    });
  }

  function getBasePrefix(){
    const path = location.pathname.replace(/\\+/g,'/');
    // 在 GitHub Pages 项目页中，根路径是 /<repo>，只有 /<repo>/pages/* 才需要返回上一级
    return path.includes('/pages/') ? '../' : './';
  }

  function getRootIndexHref(){
    const path = location.pathname.replace(/\\+/g,'/');
    const seg = path.split('/').filter(Boolean);
    const root = seg.length > 0 ? '/' + seg[0] + '/' : '/';
    return root + 'index.html';
  }

  function fixPartialPaths(base){
    try{
      const scope = document;
      const needPrefix = (v)=> /^(assets\/|pages\/|index\.html$|404\.html$)/.test(v||'');
      const join = (b, v)=> (b||'./') + v;
      // fix anchors
      scope.querySelectorAll('#header a[href], #footer a[href]').forEach(a=>{
        const href = a.getAttribute('href')||'';
        if(href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('#')) return;
        if(href.startsWith('./') || href.startsWith('../')) return;
        if(needPrefix(href)) a.setAttribute('href', join(base, href));
      });
      // force homepage links to absolute repo root to avoid 404
      scope.querySelectorAll('#header a[data-link="index.html"], #header .brand > a.title, #footer a[data-home]')
        .forEach(a=> { a.setAttribute('href', getRootIndexHref()); });
      // fix images
      scope.querySelectorAll('#header img[src], #footer img[src]').forEach(img=>{
        const src = img.getAttribute('src')||'';
        if(src.startsWith('./') || src.startsWith('../') || src.startsWith('http')) return;
        if(needPrefix(src)) img.setAttribute('src', join(base, src));
      });
    }catch(_){/* noop */}
  }

  function fixDocumentPaths(base){
    try{
      const scope = document;
      const needPrefix = (v)=> /^(assets\/|pages\/|index\.html$|404\.html$)/.test(v||'');
      const join = (b, v)=> (b||'./') + v;
      scope.querySelectorAll('main a[href]').forEach(a=>{
        const href = a.getAttribute('href')||'';
        if(href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('#')) return;
        if(href.startsWith('./') || href.startsWith('../')) return;
        if(needPrefix(href)) a.setAttribute('href', join(base, href));
      });
      scope.querySelectorAll('main img[src]').forEach(img=>{
        const src = img.getAttribute('src')||'';
        if(src.startsWith('http') || src.startsWith('./') || src.startsWith('../')) return;
        if(needPrefix(src)) img.setAttribute('src', join(base, src));
      });
    }catch(_){/* noop */}
  }

  // Expose helpers and handle OAuth callback page
  async function maybeHandleOAuthCallback(){
    if(apiState.mockMode) return;
    const path = location.pathname.replace(/\\+/g,'/');
    const isCallback = path.endsWith('/pages/auth-callback.html') || path.endsWith('auth-callback.html');
    if(!isCallback) return;
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');
    if(!code || !state) return;
    try{
      const data = await apiPost('/api/auth/wechat/callback', { code, state });
      if(data && data.token){
        setMember({ token: data.token, role: data.user && data.user.role, email: data.user && data.user.email, time: Date.now() });
        location.href = getBasePrefix() + 'index.html';
        return;
      }
      if(data && data.pendingApproval){
        alert('已绑定微信，等待管理员授权后才能登录');
        location.href = getBasePrefix() + 'index.html';
        return;
      }
      alert('登录失败');
    }catch(e){ alert('登录失败，请稍后再试'); }
  }

  window.LW = { getMember, setMember, ensureAuth, initComments, fetchJSON, renderAd,
    api: { setApiBase, setMockMode, get: apiGet, post: apiPost },
    config: apiState
  };

  document.addEventListener('DOMContentLoaded', loadPartials);
  document.addEventListener('DOMContentLoaded', maybeHandleOAuthCallback);
  document.addEventListener('DOMContentLoaded', guardPageAccess);
  
  // --- UI interactions ---
  function initInteractions(){
    setupButtonRipple();
    setupRevealOnScroll();
    setupCardTilt();
    setupCatThemes();
    setupPawClick();
    setupTitleHoverTOC();
    setupCarousel();
    setupRadarCharts();
    setupAwardCelebration();
  }

  function setupButtonRipple(){
    document.addEventListener('click', (e)=>{
      const btn = e.target.closest('.btn');
      if(!btn) return;
      const rect = btn.getBoundingClientRect();
      const span = document.createElement('span');
      span.className = 'ripple';
      const x = e.clientX - rect.left; const y = e.clientY - rect.top;
      span.style.left = x + 'px'; span.style.top = y + 'px';
      btn.appendChild(span);
      setTimeout(()=> span.remove(), 650);
    });
  }

  function setupRevealOnScroll(){
    const observer = new IntersectionObserver((entries)=>{
      entries.forEach(en => {
        if(en.isIntersecting){ en.target.classList.add('show'); observer.unobserve(en.target); }
      });
    }, { threshold: 0.12 });
    // mark existing cards and .reveal elements
    document.querySelectorAll('.card, .reveal').forEach(el => {
      if(!el.classList.contains('reveal')) el.classList.add('reveal');
      observer.observe(el);
    });
    // observe future cards
    const mo = new MutationObserver((muts)=>{
      muts.forEach(m => m.addedNodes.forEach(n => {
        if(!(n instanceof HTMLElement)) return;
        if(n.matches && (n.matches('.card') || n.matches('.reveal'))){
          if(!n.classList.contains('reveal')) n.classList.add('reveal');
          observer.observe(n);
        }
        n.querySelectorAll && n.querySelectorAll('.card, .reveal').forEach(el => {
          if(!el.classList.contains('reveal')) el.classList.add('reveal');
          observer.observe(el);
        });
      }));
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function setupCardTilt(){
    const supportsHover = window.matchMedia('(hover:hover)').matches;
    if(!supportsHover) return;
    const MAX = 6; // deg
    function bind(el){
      let raf = 0;
      function onMove(ev){
        if(raf) return; raf = requestAnimationFrame(()=>{
          const r = el.getBoundingClientRect();
          const px = (ev.clientX - r.left) / r.width - 0.5;
          const py = (ev.clientY - r.top) / r.height - 0.5;
          const rx = (+py) * MAX;
          const ry = (-px) * MAX;
          el.style.transform = `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-4px) scale(1.01)`;
          raf = 0;
        });
      }
      function onLeave(){ el.style.transform = ''; }
      el.addEventListener('mousemove', onMove);
      el.addEventListener('mouseleave', onLeave);
    }
    document.querySelectorAll('.card').forEach(bind);
    // bind future cards
    const mo = new MutationObserver((muts)=>{
      muts.forEach(m => m.addedNodes.forEach(n => {
        if(!(n instanceof HTMLElement)) return;
        if(n.matches && n.matches('.card')) bind(n);
        n.querySelectorAll && n.querySelectorAll('.card').forEach(bind);
      }));
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // Celebration on award photo click
  function setupAwardCelebration(){
    document.addEventListener('click', (e)=>{
      const img = e.target.closest('.award-photo');
      if(!img) return;
      const x = e.clientX, y = e.clientY;
      scatterConfetti(x,y,60);
      showBlessingToast();
    });
  }

  function spawnFirework(x,y){
    const el = document.createElement('div');
    el.className = 'fw-burst';
    el.style.left = x + 'px'; el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(()=> el.remove(), 900);
  }
  function burstRing(x,y,count,radius){
    for(let i=0;i<count;i++){
      const ang = (i / count) * Math.PI * 2;
      const px = x + Math.cos(ang) * radius;
      const py = y + Math.sin(ang) * radius;
      setTimeout(()=> spawnFirework(px,py), i*35);
    }
    // center one as well
    setTimeout(()=> spawnFirework(x,y), count*35);
  }
  function scatterConfetti(x,y,n){
    for(let i=0;i<n;i++){
      const d = document.createElement('div');
      d.className = 'confetti-piece';
      d.style.left = x + 'px'; d.style.top = y + 'px';
      const hue = Math.floor(180 + Math.random()*160);
      d.style.background = `hsl(${hue} 90% 60%)`;
      const spread = 360; // all directions
      const ang = Math.random() * Math.PI * 2;
      const power = 180 + Math.random()*220;
      const dx = Math.cos(ang) * power;
      const dy = Math.sin(ang) * power + 280; // add gravity-like down term
      const rot = (Math.random()*2-1) * 540 + 'deg';
      d.style.setProperty('--dx', dx.toFixed(0)+'px');
      d.style.setProperty('--dy', dy.toFixed(0)+'px');
      d.style.setProperty('--rot', rot);
      document.body.appendChild(d);
      setTimeout(()=> d.remove(), 1300 + Math.random()*400);
    }
  }
  function showBlessingToast(text){
    if(!text){
      const msgs = [
        '🙇‍♂️ 大佬膜拜！💫 吸吸欧气～ ✨',
        '🎉 欧气临门！📈 事业高涨～',
        '🤝 学神赐福！📚 灵感+999',
        '🌟 好运在线！🔮 今日必顺',
        '🧠 突破瓶颈！⚡ 灵光乍现',
        '🚀 论文起飞！📄 审稿一路绿灯',
        '💎 爆肝有回报！🔥 代码无Bug',
        '🍀 欧气拉满！🧪 实验一遍成功',
        '🏆 状态拉满！🏅 冲冲冲～',
        '🦾 拿捏了！今天稳得很～',
        '🕊️ 冲鸭！好运锁定～',
        '🧧 好运加持！暴击率+100%',
        '🛠️ 老王研究所保佑！工具在手，问题不愁',
        '📈 一把过！Reviewer全给好评～',
        '🧪 实验稳了！一次到位不返工',
        '🧩 宏一跑就过，流程丝滑～',
        '🧠 思路清晰！卡点已破～',
        '📚 写作手感来了！码字如飞～',
        '🧿 今日锦鲤就是你！',
        '💫 灵感爆表！YYDS～'
      ];
      text = msgs[Math.floor(Math.random()*msgs.length)];
    }
    const el = document.createElement('div');
    el.className = 'blessing-toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(()=> el.remove(), 1700);
  }

  // Click to spawn a paw at cursor, then fade out
  function setupPawClick(){
    document.addEventListener('click', (e)=>{
      // ignore very large modifier clicks if needed (keep simple for now)
      const paw = document.createElement('span');
      paw.className = 'paw-click';
      paw.style.left = e.clientX + 'px';
      paw.style.top = e.clientY + 'px';
      const rot = (Math.random() < .5 ? -1 : 1) * (8 + Math.random()*10);
      paw.style.setProperty('--rot', rot.toFixed(1) + 'deg');
      document.body.appendChild(paw);
      setTimeout(()=> paw.remove(), 950);
    });
  }

  // Assign cat element themes randomly per section, consistent within section
  function setupCatThemes(){
    const themes = ['cat-theme-1','cat-theme-2','cat-theme-3'];
    const sections = document.querySelectorAll('main.container > section');
    sections.forEach(sec => {
      const t = themes[Math.floor(Math.random()*themes.length)];
      sec.classList.add(t);
      // enable icon variants where present
      sec.querySelectorAll('.cat-ears').forEach(el=> el.classList.add('icon'));
      sec.querySelectorAll('.whiskers').forEach(el=> el.classList.add('icon'));
    });
  }

  // Only the first page title shows a hover card listing other titles on the same page
  function setupTitleHoverTOC(){
    const titles = Array.from(document.querySelectorAll('h2.section-title'));
    if(titles.length <= 1) return;

    const slugCounts = Object.create(null);
    function slugify(s){
      const base = String(s||'').trim().toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g,'') || 'section';
      const n = (slugCounts[base] = (slugCounts[base]||0) + 1);
      return n>1 ? base + '-' + n : base;
    }

    const infos = titles.map(el => {
      if(!el.id){ el.id = slugify(el.textContent||'section'); }
      return { el, id: el.id, text: (el.textContent||'').trim() };
    });

    const topTitle = titles[0];
    const others = infos.filter(i => i.el !== topTitle);
    if(others.length === 0) return;
    if(!topTitle.style.position) topTitle.style.position = 'relative';
    const card = document.createElement('div');
    card.className = 'title-toc';
    card.innerHTML = '<div class="title">页面其他标题</div>' +
      others.map(o => `<a href="#${o.id}">${escapeHtml(o.text)}</a>`).join('');
    topTitle.appendChild(card);
  }

  // --- Simple carousel ---
  function setupCarousel(){
    document.querySelectorAll('.carousel').forEach(root => {
      const track = root.querySelector('.carousel-track');
      const slides = Array.from(root.querySelectorAll('.carousel-slide'));
      const prev = root.querySelector('.carousel-btn.prev');
      const next = root.querySelector('.carousel-btn.next');
      const dotsBox = root.querySelector('.carousel-dots');
      let index = 0; let timer = 0;
      if(!track || slides.length === 0) return;
      function renderDots(){
        if(!dotsBox) return;
        dotsBox.innerHTML = slides.map((_,i)=>`<button data-i="${i}" class="${i===index?'active':''}"></button>`).join('');
        dotsBox.querySelectorAll('button').forEach(btn=> btn.addEventListener('click',()=> go(+btn.getAttribute('data-i'))));
      }
      function go(i){ index = (i + slides.length) % slides.length; track.style.transform = `translateX(-${index*100}%)`; renderDots(); }
      function start(){ stop(); timer = setInterval(()=> go(index+1), 4200); }
      function stop(){ if(timer) clearInterval(timer); timer = 0; }
      prev && prev.addEventListener('click', ()=> go(index-1));
      next && next.addEventListener('click', ()=> go(index+1));
      root.addEventListener('mouseenter', stop);
      root.addEventListener('mouseleave', start);
      renderDots(); go(0); start();
    });
  }

  // --- Hexagon radar (六边形战士) ---
  function setupRadarCharts(){
    document.querySelectorAll('.radar-chart').forEach(el => {
      try{
        const labels = String(el.getAttribute('data-labels')||'').split(',').map(s=>s.trim()).filter(Boolean);
        let values = String(el.getAttribute('data-values')||'').split(',').map(s=> Math.max(0, Math.min(100, parseInt(s||'0',10))));
        // load saved
        const storageKey = radarStorageKey(el, labels);
        const saved = loadRadar(storageKey, labels.length);
        if(saved) values = saved;
        if(labels.length < 3 || values.length !== labels.length) return;
        el.innerHTML = renderRadarSVG(labels, values);
        el.setAttribute('data-values', values.join(','));
        attachRadarControls(el, labels, values, storageKey);
      }catch(_){ /* ignore */ }
    });
  }

  function renderRadarSVG(labels, values){
    const size = 420; const cx = size/2; const cy = size/2; const maxR = 160; const n = labels.length; const layers = 5;
    function polar(angleIdx, scale){
      const ang = (-90 + angleIdx * (360/n)) * Math.PI/180;
      const r = maxR * scale;
      return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
    }
    function poly(points){ return points.map(p=> p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '); }
    let gridPolys = '';
    for(let l=1;l<=layers;l++){
      const s = l/layers; const pts = Array.from({length:n},(_,i)=> polar(i, s));
      gridPolys += `<polygon points="${poly(pts)}" fill="none" stroke="#e5e7eb" stroke-width="1"/>`;
    }
    // radial lines
    let radials = '';
    for(let i=0;i<n;i++){
      const p = polar(i,1);
      radials += `<line x1="${cx}" y1="${cy}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`;
    }
    // value polygon
    const valPts = Array.from({length:n},(_,i)=> polar(i, (values[i]||0)/100));
    const valPoly = `<polygon points="${poly(valPts)}" fill="rgba(71,163,255,.25)" stroke="rgb(71,163,255)" stroke-width="2"/>`;
    // labels
    let labelEls = '';
    for(let i=0;i<n;i++){
      const p = polar(i, 1.12);
      labelEls += `<text x="${p[0].toFixed(1)}" y="${p[1].toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="#64748b">${escapeHtml(labels[i])}</text>`;
    }
    return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="能力雷达">
      <g>${gridPolys}${radials}${valPoly}${labelEls}</g>
    </svg>`;
  }

  function radarStorageKey(el, labels){
    const id = el.id || '';
    const keyBase = id ? `radar:${id}` : `radar:${labels.join('|')}`;
    return keyBase;
  }
  function loadRadar(key, n){
    try{
      const s = localStorage.getItem(key);
      if(!s) return null;
      const arr = JSON.parse(s);
      if(Array.isArray(arr) && arr.length === n) return arr.map(v=> Math.max(0, Math.min(100, parseInt(v||0,10))));
      return null;
    }catch(_){ return null; }
  }
  function saveRadar(key, values){
    try{ localStorage.setItem(key, JSON.stringify(values)); }catch(_){ /* ignore */ }
  }
  function attachRadarControls(chartEl, labels, values, storageKey){
    const wrap = chartEl.closest('.radar-wrap');
    if(!wrap) return;
    const desc = wrap.querySelector('.desc') || wrap;
    let controls = desc.querySelector('.radar-controls');
    if(!controls){
      controls = document.createElement('div');
      controls.className = 'radar-controls';
      desc.appendChild(controls);
    }
    if(controls.getAttribute('data-inited')) return;
    controls.setAttribute('data-inited','1');
    controls.innerHTML = labels.map((lb, i)=> {
      const val = values[i] || 0;
      const id = `rc-${(chartEl.id||'rad')}-${i}`;
      return `<div class="row rc-item"><span class="rc-label">${escapeHtml(lb)}</span>
        <input id="${id}" type="range" min="0" max="100" value="${val}" step="1" />
        <span class="rc-val">${val}</span></div>`;
    }).join('');
    const inputs = controls.querySelectorAll('input[type=range]');
    inputs.forEach((inp, i)=>{
      inp.addEventListener('input', ()=>{
        values[i] = parseInt(inp.value||'0',10);
        chartEl.innerHTML = renderRadarSVG(labels, values);
        chartEl.setAttribute('data-values', values.join(','));
        const valEl = inp.parentElement.querySelector('.rc-val');
        if(valEl) valEl.textContent = String(values[i]);
        saveRadar(storageKey, values);
      });
    });
  }

  // Require approved login for non-home pages
  async function guardPageAccess(){
    const path = location.pathname.replace(/\\+/g,'/');
    const isHome = path.endsWith('/index.html');
    const isCallback = path.endsWith('/pages/auth-callback.html') || path.endsWith('auth-callback.html');
    const is404 = path.endsWith('/404.html');
    if(isHome || isCallback || is404) return;
    const m = getMember();
    if(!m || !m.token){
      // 弹窗内置“预览授权”按钮
      const ok = await showPreviewDialog();
      if(ok){
        // 写入临时 token 后继续尝试
      }else{
        location.href = getBasePrefix() + 'index.html';
        return;
      }
    }
    // 若连接了后端，则进一步核验审批状态
    if(!apiState.mockMode){
      try{
        const me = await apiGet('/api/auth/me');
        if(!me || !me.approved){ alert('需要管理员授权后才能访问'); location.href = getBasePrefix() + 'index.html'; }
      }catch(_){ /* apiGet 已处理鉴权错误并跳转 */ }
    }
  }

  // 简易弹窗：提示需要授权，并提供“预览授权（临时）”
  function showPreviewDialog(){
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.style.position = 'fixed';
      wrap.style.left = '0';
      wrap.style.top = '0';
      wrap.style.right = '0';
      wrap.style.bottom = '0';
      wrap.style.background = 'rgba(0,0,0,.4)';
      wrap.style.display = 'grid';
      wrap.style.placeItems = 'center';
      wrap.style.zIndex = '9999';
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = '<div class="card-body"><h3 class="title">需要授权</h3><p>该页面需要授权访问。你可以前往首页登录，或临时预览。</p><div class="row" style="gap:8px;justify-content:flex-end"><button class="btn" id="pv-cancel">返回首页</button><button class="btn primary" id="pv-ok">预览授权</button></div></div>';
      wrap.appendChild(card);
      document.body.appendChild(wrap);
      const done = (ok)=>{ document.body.removeChild(wrap); resolve(ok); };
      card.querySelector('#pv-cancel').addEventListener('click', ()=> done(false));
      card.querySelector('#pv-ok').addEventListener('click', ()=>{
        const token = 'preview-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        setMember({ token, role: 'normal', email: 'preview@local', time: Date.now(), preview: true });
        done(true);
      });
    });
  }
})();


