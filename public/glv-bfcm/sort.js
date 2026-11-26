(function (root) {
  'use strict';
  const initial = () => ({key:'purchases',direction:'desc',clickedKey:null});
  const next = (state,key) => ({key,direction:state.clickedKey===key && state.direction==='desc' ? 'asc' : 'desc',clickedKey:key});
  const compare = state => (a,b) => {
    const av=a[state.key], bv=b[state.key];
    const aMissing=typeof av!=='number' || !Number.isFinite(av);
    const bMissing=typeof bv!=='number' || !Number.isFinite(bv);
    if(aMissing!==bMissing) return aMissing ? 1 : -1;
    const difference=aMissing ? 0 : (av-bv)*(state.direction==='desc' ? -1 : 1);
    return difference || b.purchases-a.purchases || b.spend-a.spend || String(a.label).localeCompare(String(b.label));
  };
  const api={initial,next,compare};
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.BfcmSort=api;
})(typeof globalThis==='object' ? globalThis : this);
