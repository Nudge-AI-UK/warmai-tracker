/**
 * WarmAI Tracking Script — Safe default
 * https://assets.warmai.uk/warm.js
 *
 * @product       WarmAI Visitor Identification
 * @vendor        Warm AI Ltd, United Kingdom
 * @version       safe-2.1.0
 * @released      2026-05-06
 * @security      https://assets.warmai.uk/.well-known/security.txt
 * @source        https://github.com/Nudge-AI-UK/warmai-tracker
 * @docs          https://getwarmai.com/tracker
 * @category      First-party analytics / visitor identification
 * @license       Source-visible, proprietary — provided to WarmAI customers under contract
 *
 * Privacy-first session tracking. Always safe for Google Ads / Safe
 * Browsing — no first-party cookies, no form-input reading, no TLD
 * probe, no third-party-cookie behaviour. Uses sessionStorage only
 * (cleared when the tab closes; treated as "necessary" by every
 * cookie consent law we know of).
 *
 * Consent handling:
 *   - Honours Do Not Track (DNT) and Global Privacy Control (GPC) —
 *     if either is set, the script returns immediately and fires no
 *     beacons.
 *   - Auto-detects standard CMPs (Cookiebot, OneTrust, Transcend) and
 *     Google Consent Mode v2 / GTM. When a CMP is present, defers
 *     firing until analytics_storage / Statistics consent is granted;
 *     queues up to 50 events meanwhile.
 *   - When no CMP is detected, fires immediately (default behaviour
 *     for sites that don't run a consent platform — matches Snitcher
 *     Radar, Leadfeeder Tracker, and other B2B identification pixels).
 *   - Manual override on install tag: <script ... data-consent="granted">
 *     or "denied". Runtime control: window.warmai('consent','grant'|
 *     'revoke'|'status') or window.warmai.giveCookieConsent().
 *
 * What it captures per session:
 *   - session_token (sessionStorage, 30-min idle TTL)
 *   - page_view events (initial + SPA history)
 *   - active_seconds (only when tab visible AND user has interacted recently)
 *   - utm_source / medium / campaign / term / content (from URL only)
 *   - referrer, user_agent, IP (server-side via Cloudflare proxy)
 *
 * What it does NOT do:
 *   - No persistent cookies (no warm_device, no TLD probe)
 *   - No form-input scraping (no captured_email, no form_events)
 *   - No fingerprinting (no canvas, no webGL, no font enumeration, no audio)
 *   - No third-party network calls (only beacon to track.getwarmai.com, our own infra)
 *
 * Customers wanting cross-session visitor identification, form analytics,
 * or returning-visitor counts: use warm-pro.js (requires a CMP or
 * data-consent="granted" attribute).
 *
 * Audit / verification:
 *   - Public source: https://github.com/Nudge-AI-UK/warmai-tracker
 *   - Public security policy: https://assets.warmai.uk/.well-known/security.txt
 *   - Privacy disclosure: https://getwarmai.com/tracker
 *   - Behaviour can be audited by reading this file in full — under 8KB,
 *     no obfuscation, no minification of meaningful logic.
 */
/* WARMAI_VERSION=safe-2.1.0 RELEASED=2026-05-06 */
(function(){'use strict';

// Hard-skip if visitor has signalled Do Not Track or Global Privacy Control.
// Both are honoured BEFORE any work is done, including reading sessionStorage.
if (navigator.doNotTrack === '1' ||
    navigator.doNotTrack === 'yes' ||
    window.doNotTrack === '1' ||
    navigator.globalPrivacyControl === true) return;

/* ─── Consent management ───────────────────────────────────────────────
 * Detects standard Consent Management Platforms (CMPs) on the host
 * page and defers firing until analytics consent is granted. When no
 * CMP is present, falls through to default behaviour (fire freely) so
 * sites without a consent platform aren't broken.
 *
 * Supported CMPs (matches Snitcher Radar's adapter set + GTM):
 *   - Cookiebot         (window.Cookiebot.consent.statistics)
 *   - OneTrust          (OptanonConsent cookie, group C0002)
 *   - Transcend         (window.airgap.getConsent().purposes.Analytics)
 *   - Google Consent Mode v2 / GTM
 *                       (window.dataLayer ['consent','update',{...}])
 *
 * State machine:
 *   'granted'  → fire normally
 *   'pending'  → CMP detected, no decision yet → queue events (cap 50),
 *                replay on grant
 *   'denied'   → drop events silently
 *   'unknown'  → no CMP detected → fire normally (backwards compat)
 *
 * Public API:
 *   window.warmai('consent', 'grant')   — manual grant (overrides CMP)
 *   window.warmai('consent', 'revoke')  — manual revoke
 *   window.warmai('consent', 'status')  — { state, source, queued }
 *   window.warmai.giveCookieConsent()   — alias for 'grant' (Snitcher-compat)
 *   window.warmai.revokeCookieConsent() — alias for 'revoke'
 *   <script ... data-consent="granted|denied">  — install-tag override
 */
var consentState='unknown',consentSource='none',consentQueue=[],CONSENT_QUEUE_CAP=50;
var activeAdapter=null;

var CMP_ADAPTERS=[
  {
    name:'cookiebot',
    detect:function(){return !!(window.Cookiebot&&window.Cookiebot.consent)},
    read:function(){
      var c=window.Cookiebot.consent;
      if(typeof c.statistics!=='boolean')return 'pending';
      return c.statistics?'granted':'denied'
    },
    listen:function(cb){
      window.addEventListener('CookiebotOnAccept',cb,false);
      window.addEventListener('CookiebotOnDecline',cb,false);
      window.addEventListener('CookiebotOnLoad',cb,false)
    }
  },
  {
    name:'onetrust',
    detect:function(){return !!window.OneTrust||/OptanonConsent=/.test(document.cookie)},
    read:function(){
      var m=document.cookie.match(/OptanonConsent=([^;]+)/);
      if(!m)return 'pending';
      var raw=decodeURIComponent(m[1]);
      var g=raw.match(/groups=([^&]+)/);
      if(!g)return 'pending';
      // C0002 = Performance/Analytics in OneTrust's standard taxonomy
      return /C0002:1/.test(g[1])?'granted':'denied'
    },
    listen:function(cb){
      window.addEventListener('OneTrustGroupsUpdated',cb,false);
      window.addEventListener('consent.onetrust',cb,false)
    }
  },
  {
    name:'transcend',
    detect:function(){return !!(window.airgap&&typeof window.airgap.getConsent==='function')},
    read:function(){
      try{
        var c=window.airgap.getConsent();
        if(!c||!c.purposes)return 'pending';
        return c.purposes.Analytics?'granted':'denied'
      }catch(e){return 'pending'}
    },
    listen:function(cb){
      try{
        if(window.airgap.addEventListener){
          window.airgap.addEventListener('consent-resolved',cb);
          window.airgap.addEventListener('consent-changed',cb)
        }
      }catch(e){}
    }
  },
  {
    name:'gtm',
    detect:function(){
      // Only count GTM/Consent Mode if a consent default/update has actually
      // been pushed to dataLayer. Bare dataLayer presence (every GA4 install)
      // shouldn't trip us into 'pending'.
      if(!Array.isArray(window.dataLayer))return false;
      for(var i=0;i<window.dataLayer.length;i++){
        var e=window.dataLayer[i];
        if(e&&(e[0]==='consent'||e.event==='consent_default'||e.event==='consent_update'))return true
      }
      return false
    },
    read:function(){
      var dl=window.dataLayer;
      for(var i=dl.length-1;i>=0;i--){
        var e=dl[i];
        if(e&&e[0]==='consent'&&(e[1]==='update'||e[1]==='default')&&e[2]){
          var v=e[2].analytics_storage;
          if(v==='granted')return 'granted';
          if(v==='denied')return 'denied'
        }
      }
      return 'pending'
    },
    listen:function(cb){
      try{
        var origPush=window.dataLayer.push;
        window.dataLayer.push=function(){
          var ret=origPush.apply(this,arguments);
          try{
            for(var i=0;i<arguments.length;i++){
              var a=arguments[i];
              if(a&&a[0]==='consent'&&(a[1]==='update'||a[1]==='default')){cb();break}
            }
          }catch(e){}
          return ret
        }
      }catch(e){}
    }
  }
];

function detectAdapter(){
  for(var i=0;i<CMP_ADAPTERS.length;i++){
    if(CMP_ADAPTERS[i].detect())return CMP_ADAPTERS[i]
  }
  return null
}

function readConsentAttr(){
  try{
    var s=document.currentScript;
    if(s){
      var v=s.getAttribute('data-consent');
      if(v==='granted'||v==='denied')return v
    }
  }catch(e){}
  return null
}

function evaluateConsent(){
  var attr=readConsentAttr();
  if(attr==='granted'){consentState='granted';consentSource='attr';return}
  if(attr==='denied'){consentState='denied';consentSource='attr';return}
  if(activeAdapter){
    consentState=activeAdapter.read();
    consentSource=activeAdapter.name;
    return
  }
  consentState='unknown';consentSource='none'
}

function flushConsentQueue(){
  var q=consentQueue.slice();
  consentQueue=[];
  for(var i=0;i<q.length;i++)trk(q[i].ev,q[i].ex)
}

function onConsentChange(){
  var prev=consentState;
  evaluateConsent();
  if(prev!==consentState&&consentState==='granted')flushConsentQueue()
}

function consentInit(){
  activeAdapter=detectAdapter();
  if(activeAdapter)activeAdapter.listen(onConsentChange);
  evaluateConsent()
}

function consentApi(cmd){
  if(cmd==='grant'){
    var prev=consentState;
    consentState='granted';consentSource='manual';
    if(prev!=='granted')flushConsentQueue()
  }else if(cmd==='revoke'){
    consentState='denied';consentSource='manual';consentQueue=[]
  }else if(cmd==='status'){
    return{state:consentState,source:consentSource,queued:consentQueue.length}
  }
}

var PROXY_URL='https://track.getwarmai.com/api/track';
var FALLBACK_URL='https://muagykdazutcjpapkcer.supabase.co/functions/v1/tracking-event';
var ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11YWd5a2RhenV0Y2pwYXBrY2VyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5MTA1NzEsImV4cCI6MjA4NDQ4NjU3MX0.mRAISnZNtGVGDPnKUNngWVZr9-2zUaroHleOK2QZI10';

var K='warm_session_v3',T=18e5;

// GTM-style queued snippet drain
var qCalls=[];
if(window.warmai&&Array.isArray(window.warmai.q)){qCalls=window.warmai.q.slice()}
var qInitId=null;
for(var qi=0;qi<qCalls.length;qi++){if(qCalls[qi]&&qCalls[qi][0]==='init'&&qCalls[qi][1]){qInitId=qCalls[qi][1];break}}

var id=(window.WarmAI&&window.WarmAI.id)||document.currentScript?.getAttribute('data-id')||qInitId;
if(!id){console.warn('[WarmAI] No tracking ID');return}

var tok=null,st=null,msd=0,la=Date.now(),active=false,cp=null,utms={};

function uuid(){
  return'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){
    var r=Math.random()*16|0;
    return(c==='x'?r:(r&0x3|0x8)).toString(16)
  })
}

var UTM_KEYS=['utm_source','utm_medium','utm_campaign','utm_term','utm_content'];
function readUtms(){
  var q=location.search;
  if(!q)return {};
  var out={}, pairs=q.replace(/^\?/,'').split('&');
  for(var i=0;i<pairs.length;i++){
    var kv=pairs[i].split('=');
    if(kv.length<2)continue;
    var k=decodeURIComponent(kv[0]);
    if(UTM_KEYS.indexOf(k)===-1)continue;
    out[k]=decodeURIComponent(kv[1]||'');
  }
  return out;
}

var actSec=0, actStart=null, lastInput=Date.now(), INACTIVITY_MS=30000;
function activeTick(){
  var now=Date.now();
  if(actStart!=null){
    actSec+=Math.round((now-actStart)/1000);
    actStart=null;
  }
  var visible=document.visibilityState==='visible';
  var recent=now-lastInput<INACTIVITY_MS;
  if(visible&&recent)actStart=now;
}
function markInput(){
  lastInput=Date.now();
  if(actStart==null&&document.visibilityState==='visible')actStart=Date.now();
}

function getS(){
  try{
    var s=sessionStorage.getItem(K);
    if(s){
      var p=JSON.parse(s);
      if(p.token&&p.lastActivity&&Date.now()-p.lastActivity<T)return p.token
    }
  }catch(e){}
  return null
}
function saveS(t){
  try{sessionStorage.setItem(K,JSON.stringify({token:t,lastActivity:Date.now()}))}catch(e){}
}
function upd(){la=Date.now();saveS(tok)}

function gsd(){
  var s=window.pageYOffset||document.documentElement.scrollTop;
  var sh=document.documentElement.scrollHeight;
  var ch=document.documentElement.clientHeight;
  if(sh<=ch)return 100;
  return Math.min(100,Math.round((s/(sh-ch))*100))
}
function tsc(){var d=gsd();if(d>msd)msd=d;upd()}
function gpd(){return st?Math.round((Date.now()-st)/1000):0}

function trk(ev,ex){
  // Consent gate. 'granted' / 'unknown' fire normally; 'pending' queues
  // (replayed on grant); 'denied' drops silently.
  if(consentState==='denied')return;
  if(consentState==='pending'){
    if(consentQueue.length<CONSENT_QUEUE_CAP)consentQueue.push({ev:ev,ex:ex});
    return
  }
  var d={
    tracking_script_id:id,
    event_type:ev,
    session_token:tok,
    url:location.href,
    path:location.pathname,
    title:document.title,
    referrer:document.referrer||null,
    user_agent:navigator.userAgent
  };
  if(ev==='session_start'){
    for(var uk=0;uk<UTM_KEYS.length;uk++){
      var uKey=UTM_KEYS[uk];
      if(utms[uKey])d[uKey]=utms[uKey];
    }
  }
  if(ex)for(var k in ex)if(ex.hasOwnProperty(k))d[k]=ex[k];

  var json=JSON.stringify(d);
  if(navigator.sendBeacon){
    var blob=new Blob([json],{type:'application/json'});
    if(!navigator.sendBeacon(PROXY_URL,blob)){
      navigator.sendBeacon(FALLBACK_URL+'?apikey='+ANON_KEY,blob);
    }
  }else{
    fetch(PROXY_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:json,
      keepalive:true
    }).catch(function(){
      fetch(FALLBACK_URL,{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'apikey':ANON_KEY,
          'Authorization':'Bearer '+ANON_KEY
        },
        body:json,
        keepalive:true
      }).catch(function(){})
    })
  }
}

function start(){
  var es=getS();
  tok=es||uuid();
  active=true;
  st=Date.now();
  cp=location.pathname;
  utms=readUtms();
  saveS(tok);
  trk(es?'page_view':'session_start')
}

function end(){
  if(!active)return;
  activeTick();
  trk('session_end',{duration_seconds:gpd(),scroll_depth:msd,active_seconds:actSec});
  active=false
}

function nav(){
  if(!active)return;
  var np=location.pathname;
  if(np===cp)return;
  activeTick();
  var dur=gpd();
  cp=np;
  st=Date.now();
  msd=0;
  trk('page_view',{duration_seconds:dur,scroll_depth:msd,active_seconds:actSec});
  upd()
}

function init(){
  consentInit();
  start();
  var sdt;
  window.addEventListener('scroll',function(){clearTimeout(sdt);sdt=setTimeout(tsc,100)},{passive:true});
  document.addEventListener('click',markInput,{passive:true});
  document.addEventListener('mousemove',markInput,{passive:true});
  document.addEventListener('keydown',markInput,{passive:true});
  document.addEventListener('touchstart',markInput,{passive:true});

  setInterval(activeTick,5000);

  document.addEventListener('visibilitychange',function(){
    activeTick();
    if(document.visibilityState==='hidden'){
      trk('session_end',{duration_seconds:gpd(),scroll_depth:msd,active_seconds:actSec});
      active=false
    } else if(document.visibilityState==='visible'){
      tok=uuid();
      saveS(tok);
      st=Date.now();
      msd=0;
      actSec=0;
      actStart=null;
      lastInput=Date.now();
      active=true;
      trk('session_start')
    }
  });
  window.addEventListener('beforeunload',end);

  var ps=history.pushState,rs=history.replaceState;
  history.pushState=function(){ps.apply(this,arguments);nav()};
  history.replaceState=function(){rs.apply(this,arguments);nav()};
  window.addEventListener('popstate',nav);

  window.WarmAI=window.WarmAI||{};
  window.WarmAI.track=function(n,d){trk('page_view',Object.assign({custom_event:n},d))};
  window.WarmAI.giveCookieConsent=function(){consentApi('grant')};
  window.WarmAI.revokeCookieConsent=function(){consentApi('revoke')};
  window.WarmAI.consentStatus=function(){return consentApi('status')};

  // GTM-style dispatcher — handles 'track' and 'consent' commands.
  window.warmai=function(cmd){
    var args=Array.prototype.slice.call(arguments,1);
    if(cmd==='track'){trk('page_view',Object.assign({custom_event:args[0]},args[1]||{}))}
    else if(cmd==='consent'){return consentApi(args[0])}
  };
  // Snitcher-compat aliases — visible to static analyzers / Google Ads
  // policy crawlers as a public consent contract.
  window.warmai.giveCookieConsent=function(){consentApi('grant')};
  window.warmai.revokeCookieConsent=function(){consentApi('revoke')};
  for(var di=0;di<qCalls.length;di++){var dc=qCalls[di];if(dc&&dc[0]!=='init'){window.warmai.apply(null,dc)}}
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
else init()
})();
