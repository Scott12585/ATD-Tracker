import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';
const supabase=createClient('https://uinhyjqsqrgfczqrmcya.supabase.co','sb_publishable_qmrBMbSlLInIYT2IXwy49Q_WnMiToQJ',{auth:{persistSession:true,autoRefreshToken:true}});
const $=id=>document.getElementById(id);
const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v||0));
const plClass=v=>Number(v)>0?'positive':Number(v)<0?'negative':'';
let bets=[];

function photoUrl(id){return id?`https://a.espncdn.com/i/headshots/nfl/players/full/${encodeURIComponent(id)}.png`:''}
function fallbackPhoto(img){img.onerror=null;img.src='data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#e8edf3"/><path d="M40 39c9 0 16-7 16-16S49 7 40 7 24 14 24 23s7 16 16 16Zm0 7c-16 0-29 9-29 21v6h58v-6c0-12-13-21-29-21Z" fill="#8b9aab"/></svg>`)}
window.atdPhotoFallback=fallbackPhoto;

async function loadDashboardData(){const{data:{session}}=await supabase.auth.getSession();if(!session)return;const{data,error}=await supabase.from('atd_bets').select('*').order('created_at',{ascending:false});if(error)return;bets=data||[];decorateBetRows();renderWeeklyReview()}

function decorateBetRows(){document.querySelectorAll('.dash-bet').forEach(row=>{if(row.querySelector('.player-photo'))return;const name=row.querySelector('.dash-bet-main strong')?.textContent?.trim();const bet=bets.find(b=>b.player_name===name);if(!bet)return;const main=row.querySelector('.dash-bet-main');if(!main)return;const wrap=document.createElement('div');wrap.className='dash-player-wrap';const img=document.createElement('img');img.className='player-photo';img.alt='';img.src=photoUrl(bet.player_id);img.onerror=()=>fallbackPhoto(img);main.parentNode.insertBefore(wrap,main);wrap.append(img,main)})}

function renderWeeklyReview(){const host=$('weeklyReviewPanel');if(!host)return;const byWeek=new Map();for(const b of bets){const w=Number(b.week)||0;if(!byWeek.has(w))byWeek.set(w,[]);byWeek.get(w).push(b)}const weeks=[...byWeek.keys()].sort((a,b)=>b-a);if(!weeks.length){host.innerHTML='<div class="review-empty">No weekly results yet.</div>';return}host.innerHTML=weeks.map(w=>{const list=byWeek.get(w),won=list.filter(b=>b.result==='Won'),lost=list.filter(b=>b.result==='Lost'),pending=list.filter(b=>b.result==='Pending'),settled=[...won,...lost],pl=list.reduce((s,b)=>s+Number(b.actual_pl||0),0),risk=list.reduce((s,b)=>s+Number(b.stake||0),0),settledRisk=settled.reduce((s,b)=>s+Number(b.stake||0),0),roi=settledRisk?pl/settledRisk*100:0,hit=settled.length?won.length/settled.length*100:0;return `<article class="week-review-card"><div class="week-review-top"><div><span>Week ${w}</span><strong>${won.length}-${lost.length}${pending.length?` · ${pending.length} pending`:''}</strong></div><strong class="${plClass(pl)}">${money(pl)}</strong></div><div class="week-review-grid"><div><span>Risked</span><strong>${money(risk)}</strong></div><div><span>ROI</span><strong class="${plClass(roi)}">${roi.toFixed(1)}%</strong></div><div><span>Hit rate</span><strong>${hit.toFixed(0)}%</strong></div></div></article>`}).join('')}

function showDashboardMode(mode){const betsPanel=$('myBetsPanel'),review=$('weeklyReviewPanel');document.querySelectorAll('.dashboard-mode').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));betsPanel?.classList.toggle('hidden',mode!=='bets');review?.classList.toggle('hidden',mode!=='review');if(mode==='review')renderWeeklyReview()}

document.addEventListener('click',e=>{const mode=e.target.closest('.dashboard-mode');if(mode){showDashboardMode(mode.dataset.mode);return}const log=e.target.closest('#floatingLogBet');if(log){document.querySelector('.tab[data-view="bets"]')?.click();setTimeout(()=>document.getElementById('playerInput')?.focus(),100)}});

const observer=new MutationObserver(()=>decorateBetRows());
const start=()=>{const dash=$('dashboardView');if(dash)observer.observe(dash,{childList:true,subtree:true});loadDashboardData();setInterval(loadDashboardData,120000)};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadDashboardData()});