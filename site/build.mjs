import fs from 'node:fs';import path from 'node:path';
const entries=['index.html','docs.html','booking.html','styles.css','rebrand.css','rebrand.js','js','assets','NOTICE.md'];
fs.rmSync('dist',{recursive:true,force:true});fs.mkdirSync('dist');
for(const p of entries){if(!fs.existsSync(p))throw new Error('Missing '+p);fs.cpSync(p,path.join('dist',p),{recursive:true});}
console.log('Static build ready: dist/');
