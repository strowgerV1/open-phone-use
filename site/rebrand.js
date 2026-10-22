// Rebranding only. This prototype never creates accounts, rents devices or bills.
for (const n of document.querySelectorAll('.cl-wordmark,.cl-mark text')) n.textContent='strowger';
const title=document.querySelector('#cl-word'); if(title)title.textContent='strowger';
// Third-party demonstration recordings stay credited to PhoneUse.
for(const v of document.querySelectorAll('video')) v.title='PhoneUse source demonstration — not a STROWGER runtime recording';

const mark=document.querySelector(".cl-mark svg"); if(mark)mark.setAttribute("aria-label","strowger");
