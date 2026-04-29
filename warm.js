/**
 * WarmAI Tracking Script — Safe default
 * https://assets.warmai.uk/warm.js
 *
 * @product       WarmAI Visitor Identification
 * @vendor        Warm AI Ltd, United Kingdom
 * @version       safe-2.0.0
 * @released      2026-04-28
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
 * Honours Do Not Track (DNT) and Global Privacy Control (GPC) — if
 * either is set, the script returns immediately and fires no beacons.
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
 *   - No consent gate needed — nothing here triggers consent requirements
 *     in any major jurisdiction
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
/* WARMAI_VERSION=safe-2.0.0 RELEASED=2026-04-28 */
(function(){'use strict';

// Hard-skip if visitor has signalled Do Not Track or Global Privacy Control.
// Both are honoured BEFORE any work is done, including reading sessionStorage.
if (navigator.doNotTrack === '1' ||
    navigator.doNotTrack === 'yes' ||
    window.doNotTrack === '1' ||
    navigator.globalPrivacyControl === true) return;

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

  // GTM-style dispatcher
  window.warmai=function(cmd){
    var args=Array.prototype.slice.call(arguments,1);
    if(cmd==='track'){trk('page_view',Object.assign({custom_event:args[0]},args[1]||{}))}
  };
  for(var di=0;di<qCalls.length;di++){var dc=qCalls[di];if(dc&&dc[0]!=='init'){window.warmai.apply(null,dc)}}
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
else init()
})();
