const d = require('./pattern-detector.js');
function c(o,h,l,cl,t=0){ return {open:o,high:h,low:l,close:cl,openTime:t,closeTime:t+59999,volume:100}; }
function downBase(){ return [c(120,121,117,118),c(118,119,115,116),c(116,117,113,114),c(114,115,111,112),c(112,113,109,110),c(110,111,107,108),c(108,109,105,106),c(106,107,103,104)]; }
function upBase(){ return [c(80,83,79,82),c(82,85,81,84),c(84,87,83,86),c(86,89,85,88),c(88,91,87,90),c(90,93,89,92),c(92,95,91,94),c(94,97,93,96)]; }
function expect(name,bars){ const hits=d.detectLatest(bars).map(x=>x.name); if(!hits.includes(name)) throw new Error(`${name} not detected: ${hits.join(', ')}`); }
if(d.detectorCount !== 38) throw new Error(`Expected 38 patterns, got ${d.detectorCount}`);
if(d.ruleCount !== 38) throw new Error(`Expected 38 rules, got ${d.ruleCount}`);
let b=downBase(); b.push(c(105,106,100,101),c(100,108,99,107)); expect('Bullish Engulfing',b);
b=upBase(); b.push(c(95,101,94,100),c(101,102,93,94)); expect('Bearish Engulfing',b);
b=downBase(); b.push(c(104,105,96,103)); expect('Hammer',b);
b=upBase(); b.push(c(96,104,95,97)); expect('Bearish Shooting Star',b);
b=downBase(); b.push(c(104,105,99,100),c(99.5,100.5,98.5,100),c(99.5,106,99,105)); expect('Morning Star',b);
b=upBase(); b.push(c(96,101,95,100),c(99.5,101,99,100),c(100,100.5,94,95)); expect('Bearish Evening Star',b);
console.log('SOL pattern detector tests passed: 38 patterns / 38 rules');
