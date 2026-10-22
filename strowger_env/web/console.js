'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
let owner = null, capabilities = {}, refreshing = false, noticeTimer;
const sessions = new Map();
const jobs = new Map();
function notify(message, error = false) {
  const el = $('#notice'); el.textContent = message; el.className = error ? 'error' : ''; el.hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { el.hidden = true; }, 6500);
}
async function api(path, method = 'GET', body, lease) {
  const headers = {'X-Strowger-Console': '1'};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (lease) headers['X-Lease-Token'] = lease.lease_token;
  const response = await fetch(path, {method, headers, credentials: 'same-origin', ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  let data; try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const known = {401: 'Connexion expirée. Rouvrez la console depuis le lanceur.', 404: 'Ressource ou session introuvable.', 409: 'Cette ressource est déjà réservée ou la capacité est atteinte.', 410: 'Cette session a expiré.', 422: 'Action ou paramètres invalides.', 501: 'Ce fournisseur n’est pas configuré.', 502: 'L’environnement ne répond pas. Vérifiez sa connexion.', 503: 'Ressource indisponible ou nettoyage en attente.'};
    const error = new Error(known[response.status] || 'La requête a échoué (' + response.status + ').'); error.status = response.status; throw error;
  }
  return data;
}
function remember() {
  // Lease tokens only, scoped to this tab; never the operator API key.
  try { sessionStorage.setItem('strowger-leases', JSON.stringify({owner, leases: [...sessions.values()].map(s => s.data), jobs:[...jobs.values()]})); } catch {}
  $('#no-sessions').hidden = sessions.size > 0;
  $('#session-count').textContent = `${sessions.size} session${sessions.size > 1 ? 's' : ''} active${sessions.size > 1 ? 's' : ''}`;
}
function path(data, suffix = '') { return '/v1/leases/' + encodeURIComponent(data.id) + suffix; }
async function refresh() {
  if (refreshing) return; refreshing = true;
  try {
    capabilities = await api('/v1/capabilities');
    $('#desktop-acquire').disabled = !capabilities.desktop.enabled;
    $('#desktop-acquire').textContent = capabilities.desktop.enabled ? 'Réserver un bureau ↗' : 'Activer Docker pour utiliser';
    const {devices} = await api('/v1/devices');
    const available = devices.filter(d => d.state === 'available').length;
    $('#phone-summary').textContent = devices.length ? `${available} disponible${available > 1 ? 's' : ''} / ${devices.length} enregistré${devices.length > 1 ? 's' : ''}` : 'Aucun Android enregistré pour le moment';
    const fleet = $('#fleet'); fleet.replaceChildren();
    if (!devices.length) {
      const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Le parc est vide. Enregistrez vos Android USB avec le lanceur local. Le navigateur est déjà utilisable ci-dessus.'; fleet.append(empty);
    }
    const states = {available: 'Disponible', leased: 'Réservé', unavailable: 'Indisponible', quarantined: 'Nettoyage en attente', offline_or_unauthorized: 'Hors ligne / USB non autorisé'};
    for (const d of devices) {
      const card = document.createElement('article'); card.className = 'panel device';
      const info = document.createElement('div'), name = document.createElement('strong'), state = document.createElement('span');
      name.textContent = d.id; state.className = 'state'; state.textContent = states[d.state] || d.state; info.append(name, state);
      const button = document.createElement('button'); button.textContent = 'Réserver'; button.disabled = d.state !== 'available';
      button.onclick = () => acquire('phone', d.id, button); card.append(info, button); fleet.append(card);
    }
  } catch (e) { notify(e.message, true); } finally { refreshing = false; }
}
async function connect(login) {
  let session;
  if (login) session = await api('/console/login', 'POST', login);
  else session = await api('/console/session');
  owner = session.owner; $('#operator').textContent = 'Opérateur : ' + owner;
  capabilities = await api('/v1/capabilities');
  $('#connection').textContent = 'Connecté en local'; $('#logout').hidden = false;
  $('#login-panel').hidden = true; $('#workspace').hidden = false;
  let saved; try { saved = JSON.parse(sessionStorage.getItem('strowger-leases') || 'null'); } catch {}
  if (saved?.owner === owner) {
    for (const data of saved.leases || []) {
      try { const current = await api(path(data), 'GET', undefined, data); if (current.state === 'active') addSession({...data, ...current}); } catch {}
    }
    for (const job of saved.jobs || []) if (job.job_token) jobs.set(job.id, job);
    renderJobs();
  }
  remember(); await refresh();
}
async function acquire(kind, device_id, button) {
  button.disabled = true;
  try {
    const data = await api('/v1/leases', 'POST', {kind, ttl: 600, ...(device_id ? {device_id} : {})});
    addSession(data); remember(); await refresh();
    sessions.get(data.id).el.scrollIntoView({behavior: 'smooth', block: 'start'});
  } catch (e) { notify(e.message, true); } finally { button.disabled = false; }
}
function addSession(data) {
  if (sessions.has(data.id)) return;
  const el = $('#session-template').content.firstElementChild.cloneNode(true);
  const state = {data, el, busy: false, gesture: null}; sessions.set(data.id, state);
  $('.kind', el).textContent = data.kind.toUpperCase() + ' / LEASE';
  $('.session-title', el).textContent = data.device_id || (data.kind === 'browser' ? 'Navigateur Chromium' : 'Bureau Linux');
  const screen = $('.screen', el);
  $$('.browser-control', el).forEach(e => { e.hidden = data.kind !== 'browser'; });
  $$('.phone-control', el).forEach(e => { e.hidden = data.kind !== 'phone'; });
  $('.gesture-hint', el).textContent = data.kind === 'phone' ? 'Touchez la capture pour cliquer, glissez pour balayer l’écran.' : 'Cliquez sur la capture pour agir à cet endroit.';
  async function locked(fn) {
    if (state.busy) return; state.busy = true; $('.session-error', el).textContent = '';
    $$('.controls button,.renew,.release', el).forEach(b => { b.disabled = true; });
    try { return await fn(); }
    catch (e) {
      $('.session-error', el).textContent = e.message;
      if ([404, 410].includes(e.status)) { removeSession(state); notify('Session terminée ou expirée.'); }
    } finally { state.busy = false; $$('.controls button,.renew,.release', el).forEach(b => { b.disabled = false; }); }
  }
  async function capture() {
    const image = await api(path(data, '/actions'), 'POST', {action: 'screenshot', args: {}}, data);
    const src = 'data:image/png;base64,' + image.png_base64;
    screen.src = src; screen.hidden = false; $('.screen-placeholder', el).hidden = true;
    const download = $('.download', el); download.href = src; download.hidden = false;
  }
  async function act(action, args = {}) {
    const result = await api(path(data, '/actions'), 'POST', {action, args}, data);
    $('.observation', el).textContent = JSON.stringify(result, null, 2);
    await new Promise(r => setTimeout(r, data.kind === 'phone' ? 300 : 100));
    await capture();
  }
  state.capture = () => locked(capture);
  $('.capture', el).onclick = state.capture;
  if (data.kind === 'phone' && capabilities.phone?.viewer) {
    const viewer = document.createElement('button'); viewer.textContent = 'Observer avec scrcpy sur l’hôte';
    viewer.title = 'Ouvre une fenêtre en lecture seule sur la machine du broker.';
    viewer.dataset.running = String(data.viewer === 'running');
    if (data.viewer === 'running') viewer.textContent = 'Arrêter scrcpy';
    viewer.onclick = () => locked(async () => {
      const running = viewer.dataset.running === 'true';
      await api(path(data, '/viewer'), running ? 'DELETE' : 'POST', undefined, data);
      viewer.dataset.running = String(!running); viewer.textContent = running ? 'Observer avec scrcpy sur l’hôte' : 'Arrêter scrcpy';
      notify(running ? 'Observation scrcpy arrêtée.' : 'Fenêtre scrcpy ouverte sur l’hôte du broker.');
    });
    $('.controls .row', el).prepend(viewer);
  }
  if (data.kind === 'phone' && ['hierarchy','ui_click','ui_exists','ui_set_text'].every(a => data.actions?.includes(a))) {
    const ui = document.createElement('details'); ui.className = 'uia-control';
    const summary = document.createElement('summary'); summary.textContent = 'Sélecteurs UIAutomator2'; ui.append(summary);
    const hint = document.createElement('p'); hint.className='muted'; hint.textContent='JSON: resourceId, text, description, className, packageName, clickable, enabled ou instance.'; ui.append(hint);
    const selector = document.createElement('textarea'); selector.rows=2; selector.value='{"text":"Settings"}'; selector.setAttribute('aria-label','Sélecteur UIAutomator2 JSON'); ui.append(selector);
    const value = document.createElement('input'); value.placeholder='Texte Unicode (pour ui_set_text)'; value.maxLength=2000; ui.append(value);
    for (const [action,label] of [['hierarchy','Lire la hiérarchie'],['ui_exists','Vérifier'],['ui_click','Cliquer'],['ui_set_text','Saisir']]) {
      const b=document.createElement('button'); b.textContent=label; b.onclick=()=>locked(async()=>{
        if(action==='hierarchy') return act(action,{});
        let parsed; try { parsed=JSON.parse(selector.value); } catch { throw new Error('Sélecteur JSON invalide.'); }
        return act(action,{selector:parsed,...(action==='ui_set_text'?{text:value.value}:{})});
      }); ui.append(b);
    }
    $('.controls',el).append(ui);
  }
  $('.release', el).onclick = () => locked(async () => { await api(path(data), 'DELETE', undefined, data); removeSession(state); await refresh(); });
  $('.renew', el).onclick = () => locked(async () => { Object.assign(data, await api(path(data, '/renew'), 'POST', {ttl: 600}, data)); remember(); notify('Session prolongée de 10 minutes.'); });
  $('.navigate', el).onsubmit = e => { e.preventDefault(); locked(() => act('navigate', {url: new FormData(e.target).get('url')})); };
  $('.demo', el).onclick = () => locked(() => act('navigate', {url: location.origin + '/demo'}));
  $('.selector', el).onsubmit = e => { e.preventDefault(); locked(() => act('click', {selector: new FormData(e.target).get('selector')})); };
  $('[name=fill]', el).onclick = () => locked(() => { const form = new FormData($('.selector', el)); return act('fill', {selector: form.get('selector'), text: form.get('text')}); });
  $('.open-app', el).onsubmit = e => { e.preventDefault(); locked(() => act('open_app', {package: new FormData(e.target).get('package')})); };
  $('.typing', el).onsubmit = e => { e.preventDefault(); locked(() => { const text = new FormData(e.target).get('text'); if (data.kind === 'phone' && (/[^\x20-\x7E]/.test(text) || text.includes('%'))) throw new Error('Saisie Android : caractères ASCII uniquement, sans signe %.'); return act('type', {text}); }); };
  const keys = data.kind === 'phone' ? [['HOME','Accueil'], ['BACK','Retour'], ['ENTER','Entrée']] : data.kind === 'browser' ? [['Enter','Entrée'], ['Tab','Tab'], ['Backspace','Effacer'], ['Escape','Échap']] : [['Return','Entrée'], ['Tab','Tab'], ['BackSpace','Effacer'], ['Escape','Échap']];
  for (const [key, label] of keys) { const b = document.createElement('button'); b.textContent = label; b.onclick = () => locked(() => act('key', {key})); $('.keys', el).append(b); }
  if (data.kind !== 'desktop') for (const [direction, label] of [[-1,'↑ Remonter'],[1,'↓ Défiler']]) {
    const b = document.createElement('button'); b.textContent = label;
    b.onclick = () => locked(() => data.kind === 'browser' ? act('scroll', {delta_y: direction*550}) : act('swipe', {x1: Math.round(screen.naturalWidth*.5), y1: Math.round(screen.naturalHeight*(direction > 0 ? .75 : .25)), x2: Math.round(screen.naturalWidth*.5), y2: Math.round(screen.naturalHeight*(direction > 0 ? .25 : .75)), duration_ms: 350}));
    $('.scrolls', el).append(b);
  }
  function coords(event) {
    const rect = screen.getBoundingClientRect();
    return {x: Math.min(screen.naturalWidth-1, Math.max(0, Math.floor((event.clientX - rect.left)*screen.naturalWidth/rect.width))), y: Math.min(screen.naturalHeight-1, Math.max(0, Math.floor((event.clientY - rect.top)*screen.naturalHeight/rect.height)))};
  }
  screen.onpointerdown = e => { if (e.button !== 0 || state.busy) return; e.preventDefault(); screen.setPointerCapture(e.pointerId); state.gesture = {...coords(e), time: Date.now()}; };
  screen.onpointercancel = () => { state.gesture = null; };
  screen.onpointerup = e => {
    if (!state.gesture) return; const start = state.gesture, end = coords(e); state.gesture = null;
    const swipe = data.kind === 'phone' && Math.hypot(end.x-start.x, end.y-start.y) > 30;
    locked(() => swipe ? act('swipe', {x1:start.x, y1:start.y, x2:end.x, y2:end.y, duration_ms:Math.min(2000, Math.max(100, Date.now()-start.time))}) : act('tap', end));
  };
  $('#sessions').append(el); state.capture();
}
function removeSession(state) { sessions.delete(state.data.id); state.el.remove(); remember(); }
async function jobApi(job, suffix='', method='GET') {
  const response=await fetch('/v1/jobs/'+encodeURIComponent(job.id)+suffix,{method,headers:{'X-Strowger-Console':'1','X-Job-Token':job.job_token},credentials:'same-origin'});
  let data={}; try {data=await response.json();} catch {}
  if(!response.ok){const e=new Error('Le job est introuvable ou la requête a échoué ('+response.status+').');e.status=response.status;throw e;} return data;
}
function renderJobs() {
  const root=$('#jobs'); if(!root)return; root.replaceChildren();
  for(const job of jobs.values()) {
    const row=document.createElement('article');row.className='job-row';
    const title=document.createElement('strong');title.textContent=job.name||job.id;
    const status=document.createElement('span');status.textContent=`${job.state} · étape ${job.step||0}/${job.steps||0} · ${job.cleanup||'pending'}`;
    const cancel=document.createElement('button');cancel.className='subtle';cancel.textContent='Annuler';cancel.disabled=['succeeded','failed','cancelled'].includes(job.state);
    cancel.onclick=async()=>{try{Object.assign(job,await jobApi(job,'/cancel','POST'));remember();renderJobs();}catch(e){notify(e.message,true);}};
    row.append(title,status,cancel);root.append(row);
  }
}
$('#job-form').onsubmit=async e=>{
  e.preventDefault();const form=new FormData(e.target);let steps;
  try{steps=JSON.parse(form.get('steps'));if(!Array.isArray(steps))throw new Error();}catch{notify('Les étapes doivent être un tableau JSON.',true);return;}
  const body={steps,ttl:600};if(form.get('device_id'))body.device_id=form.get('device_id');if(form.get('name'))body.name=form.get('name');
  try{const response=await api('/v1/jobs','POST',body);jobs.set(response.id,response);remember();renderJobs();notify('Job ajouté à la file.');}catch(err){notify(err.message,true);}
};
$('#login').onsubmit = async e => { e.preventDefault(); const input = $('#api-key'), key = input.value; input.value = ''; try { await connect({api_key:key}); } catch(e) { notify(e.message,true); } };
$('#refresh').onclick = refresh;
$$('[data-acquire]').forEach(b => { b.onclick = () => acquire(b.dataset.acquire, null, b); });
$('#logout').onclick = async () => {
  const button = $('#logout'); button.disabled = true;
  try {
    for (const state of [...sessions.values()]) {
      if (state.busy) throw new Error('Attendez la fin de l’action en cours avant de vous déconnecter.');
      try { await api(path(state.data), 'DELETE', undefined, state.data); } catch(e) { if (![404,410].includes(e.status)) throw e; }
      removeSession(state);
    }
    for (const job of jobs.values()) {
      if (!['succeeded','failed','cancelled'].includes(job.state)) await jobApi(job,'/cancel','POST');
      const deadline=Date.now()+65000;
      while (!['succeeded','failed','cancelled'].includes(job.state) && Date.now()<deadline) {
        Object.assign(job,await jobApi(job));
        if (!['succeeded','failed','cancelled'].includes(job.state)) await new Promise(r=>setTimeout(r,250));
      }
      if (!['succeeded','failed','cancelled'].includes(job.state)) throw new Error('Attendez la fin du nettoyage des jobs avant de vous déconnecter.');
    }
    jobs.clear(); remember(); renderJobs();
    await api('/console/session', 'DELETE'); location.reload();
  } catch(e) { notify(e.message,true); } finally { button.disabled = false; }
};
setInterval(() => {
  for (const state of sessions.values()) {
    const remaining = Math.max(0, Math.ceil(state.data.expires_at - Date.now()/1000));
    $('.expiry', state.el).textContent = remaining ? `${Math.floor(remaining/60)} min ${remaining%60} s restantes` : 'Expiration…';
    if (!remaining && !state.busy) { removeSession(state); refresh(); }
    else if ($('.live',state.el).checked && !state.busy) state.capture();
  }
  for(const job of jobs.values()) if(!['succeeded','failed','cancelled'].includes(job.state)) jobApi(job).then(data=>{Object.assign(job,data);remember();renderJobs();}).catch(()=>{});
}, 2000);
(async () => {
  const code = new URLSearchParams(location.hash.slice(1)).get('connect');
  if (code) history.replaceState(null, '', '/');
  try { await connect(code ? {code} : null); } catch(e) { if (code) notify(e.message, true); }
})();
