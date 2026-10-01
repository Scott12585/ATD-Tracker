(function(){
function setFormVisibility(sport){
  const hockey=sport==='hockey';
  const form=document.getElementById('betForm');
  if(!form)return;
  const nhl=document.getElementById('nhlSlip');
  if(nhl)nhl.style.setProperty('display',hockey?'grid':'none','important');
  const footballSelectors=[':scope > .two-col',':scope > .player-field',':scope > label:not(.td-toggle-row)',':scope > .td-toggle-row',':scope > #selectedPlayer',':scope > #addBetBtn',':scope > #bulkToggleBtn',':scope > #bulkEntryBox',':scope > #betMessage'];
  footballSelectors.forEach(sel=>{try{form.querySelectorAll(sel).forEach(el=>el.style.setProperty('display',hockey?'none':'','important'))}catch{}});
  if(!hockey){
    const bulk=document.getElementById('bulkEntryBox');
    if(bulk&&bulk.classList.contains('hidden'))bulk.style.setProperty('display','none','important');
    const selected=document.getElementById('selectedPlayer');
    if(selected&&selected.classList.contains('hidden'))selected.style.setProperty('display','none','important');
  }
}
function sync(){setFormVisibility(window.atdCurrentSport||'football')}
document.addEventListener('click',e=>{const b=e.target.closest('[data-sport]');if(b)setTimeout(()=>setFormVisibility(b.dataset.sport),0)},true);
document.addEventListener('click',e=>{if(e.target.closest('#floatingLogBet'))setTimeout(sync,0)},true);
const observer=new MutationObserver(sync);
function start(){sync();const form=document.getElementById('betForm');if(form)observer.observe(form,{childList:true,subtree:false});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
window.atdSyncBetForm=sync;
})();