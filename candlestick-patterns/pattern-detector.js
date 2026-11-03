(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CandlestickPatternDetector = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PATTERNS = [
    [1, 'Bullish Engulfing', 'bullish'],
    [2, 'Hammer', 'bullish'],
    [3, 'Morning Star', 'bullish'],
    [4, 'Piercing Line', 'bullish'],
    [5, 'Bullish Harami', 'bullish'],
    [6, 'Three White Soldiers', 'bullish'],
    [7, 'Inverted Hammer', 'bullish'],
    [8, 'Dragonfly Doji Bullish', 'bullish'],
    [9, 'Bullish Abandoned Baby', 'bullish'],
    [10, 'Three Inside Up', 'bullish'],
    [11, 'Three Outside Up', 'bullish'],
    [12, 'Bullish Kicker', 'bullish'],
    [13, 'Tweezer Bottom', 'bullish'],
    [14, 'Rising Three Methods', 'bullish'],
    [15, 'Concealing Baby Swallow', 'bullish'],
    [16, 'Mat Hold', 'bullish'],
    [17, 'Bullish Separating Lines', 'bullish'],
    [18, 'Bullish Belt Hold', 'bullish'],
    [19, 'Three-Line Strike', 'bullish'],
    [20, 'Ladder Bottom', 'bullish'],
    [21, 'Meeting Lines', 'bullish'],
    [22, 'Bearish Engulfing', 'bearish'],
    [23, 'Bearish Belt Hold', 'bearish'],
    [24, 'Three Black Crows', 'bearish'],
    [25, 'Bearish Three-Line Strike', 'bearish'],
    [26, 'Bearish Hanging Man', 'bearish'],
    [27, 'Upside Gap Two Crows', 'bearish'],
    [28, 'Bearish Evening Star', 'bearish'],
    [29, 'Bearish Shooting Star', 'bearish'],
    [30, 'Bearish Harami', 'bearish'],
    [31, 'Bearish Doji Star', 'bearish'],
    [32, 'Bearish Abandoned Baby', 'bearish'],
    [33, 'Bearish Tweezer Top', 'bearish'],
    [34, 'Bearish Kicker', 'bearish'],
    [35, 'Bearish Three Inside Down', 'bearish'],
    [36, 'Bearish Three Outside Down', 'bearish'],
    [37, 'Bearish Mat Hold', 'bearish'],
    [38, 'Dark Cloud Cover', 'bearish'],
  ].map(([id, name, category]) => ({ id, name, category }));

  const EPS = 1e-12;
  const bull = c => c && c.close > c.open;
  const bear = c => c && c.close < c.open;
  const body = c => Math.abs(c.close - c.open);
  const range = c => Math.max(EPS, c.high - c.low);
  const upper = c => c.high - Math.max(c.open, c.close);
  const lower = c => Math.min(c.open, c.close) - c.low;
  const bodyHigh = c => Math.max(c.open, c.close);
  const bodyLow = c => Math.min(c.open, c.close);
  const midBody = c => (c.open + c.close) / 2;
  const doji = c => body(c) <= range(c) * 0.10;
  const nearHigh = c => c.high - bodyHigh(c) <= range(c) * 0.08;
  const nearLow = c => bodyLow(c) - c.low <= range(c) * 0.08;

  function avgBody(bars, i, lookback = 10) {
    const start = Math.max(0, i - lookback);
    let total = 0, count = 0;
    for (let k = start; k < i; k++) { total += body(bars[k]); count++; }
    return count ? total / count : body(bars[i] || { open: 0, close: 0 });
  }
  function trueRange(bars, i) {
    const c = bars[i]; if (!c) return 0;
    const prev = bars[i - 1]; if (!prev) return range(c);
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  }
  function atr(bars, i, length = 14) {
    const start = Math.max(0, i - length + 1); let total = 0, count = 0;
    for (let k = start; k <= i; k++) { total += trueRange(bars, k); count++; }
    return count ? total / count : range(bars[i]);
  }
  function tolerance(bars, i, factor = 0.12) {
    const c = bars[i];
    return Math.max(atr(bars, i) * factor, Math.abs(c?.close || 0) * 0.00035, EPS);
  }
  function longBody(bars, i, factor = 1.15) { return body(bars[i]) >= Math.max(avgBody(bars, i) * factor, range(bars[i]) * 0.45); }
  function smallBody(bars, i, factor = 0.65) { return body(bars[i]) <= Math.max(avgBody(bars, i) * factor, range(bars[i]) * 0.32); }
  function marubozuLike(bars, i) { const c = bars[i]; return longBody(bars, i, 1.0) && upper(c) <= range(c) * 0.08 && lower(c) <= range(c) * 0.08; }
  function trend(bars, i, direction, lookback = 6) {
    const end = i - 1, start = end - lookback;
    if (start < 0 || !bars[end] || !bars[start]) return false;
    const delta = bars[end].close - bars[start].close;
    const minMove = atr(bars, end, Math.min(14, lookback + 2)) * 0.35;
    return direction === 'up' ? delta > minMove : delta < -minMove;
  }
  const approx = (a,b,tol) => Math.abs(a-b) <= tol;
  const insideBody = (inner,outer) => bodyHigh(inner) <= bodyHigh(outer) && bodyLow(inner) >= bodyLow(outer);
  const bodyEngulfs = (outer,inner) => bodyHigh(outer) >= bodyHigh(inner) && bodyLow(outer) <= bodyLow(inner);
  const bodyGapUp = (curr,prev,tol=0) => bodyLow(curr) > bodyHigh(prev) + tol;
  const bodyGapDown = (curr,prev,tol=0) => bodyHigh(curr) < bodyLow(prev) - tol;
  const wickGapUp = (curr,prev,tol=0) => curr.low > prev.high + tol;
  const wickGapDown = (curr,prev,tol=0) => curr.high < prev.low - tol;
  const opensInsideBody = (curr,prev) => curr.open >= bodyLow(prev) && curr.open <= bodyHigh(prev);
  const strongBull = c => bull(c) && body(c) >= range(c) * 0.55;
  const strongBear = c => bear(c) && body(c) >= range(c) * 0.55;

  const D = {};
  D[1] = (b,i) => i>=1 && trend(b,i,'down') && bear(b[i-1]) && bull(b[i]) && bodyEngulfs(b[i],b[i-1]);
  D[2] = (b,i) => trend(b,i,'down') && lower(b[i]) >= Math.max(body(b[i])*2,range(b[i])*.45) && upper(b[i]) <= Math.max(body(b[i])*.6,range(b[i])*.12) && bodyHigh(b[i]) >= b[i].low + range(b[i])*.65;
  D[3] = (b,i) => i>=2 && trend(b,i-1,'down') && bear(b[i-2]) && longBody(b,i-2) && smallBody(b,i-1) && bull(b[i]) && b[i].close > midBody(b[i-2]);
  D[4] = (b,i) => i>=1 && trend(b,i,'down') && bear(b[i-1]) && longBody(b,i-1) && bull(b[i]) && b[i].close > midBody(b[i-1]) && b[i].close < b[i-1].open && b[i].open <= b[i-1].close + tolerance(b,i)*.5;
  D[5] = (b,i) => i>=1 && trend(b,i,'down') && bear(b[i-1]) && longBody(b,i-1) && bull(b[i]) && smallBody(b,i) && insideBody(b[i],b[i-1]);
  D[6] = (b,i) => i>=2 && trend(b,i-2,'down') && [i-2,i-1,i].every(k=>bull(b[k])&&body(b[k])>=range(b[k])*.5) && b[i-1].close>b[i-2].close && b[i].close>b[i-1].close && opensInsideBody(b[i-1],b[i-2]) && opensInsideBody(b[i],b[i-1]) && upper(b[i-2])<body(b[i-2])*.7 && upper(b[i-1])<body(b[i-1])*.7 && upper(b[i])<body(b[i])*.7;
  D[7] = (b,i) => trend(b,i,'down') && upper(b[i]) >= Math.max(body(b[i])*2,range(b[i])*.45) && lower(b[i]) <= Math.max(body(b[i])*.6,range(b[i])*.12) && bodyLow(b[i]) <= b[i].low + range(b[i])*.35;
  D[8] = (b,i) => trend(b,i,'down') && doji(b[i]) && lower(b[i])>=range(b[i])*.6 && upper(b[i])<=range(b[i])*.12;
  D[9] = (b,i) => i>=2 && trend(b,i-1,'down') && bear(b[i-2]) && doji(b[i-1]) && bull(b[i]) && (wickGapDown(b[i-1],b[i-2])||bodyGapDown(b[i-1],b[i-2])) && (wickGapUp(b[i],b[i-1])||bodyGapUp(b[i],b[i-1]));
  D[10] = (b,i) => i>=2 && trend(b,i-1,'down') && bear(b[i-2]) && longBody(b,i-2) && bull(b[i-1]) && insideBody(b[i-1],b[i-2]) && bull(b[i]) && b[i].close>b[i-2].open;
  D[11] = (b,i) => i>=2 && trend(b,i-1,'down') && bear(b[i-2]) && bull(b[i-1]) && bodyEngulfs(b[i-1],b[i-2]) && bull(b[i]) && b[i].close>b[i-1].close;
  D[12] = (b,i) => i>=1 && trend(b,i,'down') && bear(b[i-1]) && bull(b[i]) && (bodyGapUp(b[i],b[i-1],-tolerance(b,i)*.1)||(b[i].open>=b[i-1].open&&b[i].close>b[i-1].open+body(b[i-1])*.5)) && longBody(b,i);
  D[13] = (b,i) => i>=1 && trend(b,i,'down') && approx(b[i].low,b[i-1].low,tolerance(b,i)) && bull(b[i]) && (bear(b[i-1])||doji(b[i-1]));
  D[14] = (b,i) => i>=4 && trend(b,i-4,'up') && strongBull(b[i-4]) && [i-3,i-2,i-1].every(k=>bodyHigh(b[k])<=b[i-4].high&&bodyLow(b[k])>=b[i-4].low&&body(b[k])<body(b[i-4])*.65) && strongBull(b[i]) && b[i].close>b[i-4].close;
  D[15] = (b,i) => i>=3 && trend(b,i-2,'down') && bear(b[i-3]) && bear(b[i-2]) && marubozuLike(b,i-3) && marubozuLike(b,i-2) && bear(b[i-1]) && bodyGapDown(b[i-1],b[i-2],-tolerance(b,i)*.2) && upper(b[i-1])>body(b[i-1])*.15 && bear(b[i]) && b[i].high>=b[i-1].high && b[i].low<=b[i-1].low;
  D[16] = (b,i) => i>=4 && trend(b,i-4,'up') && strongBull(b[i-4]) && (bodyGapUp(b[i-3],b[i-4],-tolerance(b,i)*.25)||b[i-3].open>midBody(b[i-4])) && [i-3,i-2,i-1].every(k=>body(b[k])<body(b[i-4])*.75&&b[k].low>b[i-4].open) && strongBull(b[i]) && b[i].close>b[i-4].close;
  D[17] = (b,i) => i>=1 && trend(b,i,'up') && bear(b[i-1]) && bull(b[i]) && approx(b[i].open,b[i-1].open,tolerance(b,i)) && b[i].close>b[i-1].high;
  D[18] = (b,i) => trend(b,i,'down') && bull(b[i]) && longBody(b,i) && nearLow(b[i]) && upper(b[i])<=range(b[i])*.18;
  D[19] = (b,i) => i>=3 && trend(b,i-2,'down') && [i-3,i-2,i-1].every(k=>bear(b[k])) && b[i-2].close<b[i-3].close && b[i-1].close<b[i-2].close && bull(b[i]) && b[i].open<=b[i-1].close+tolerance(b,i)*.25 && b[i].close>=b[i-3].open;
  D[20] = (b,i) => i>=4 && trend(b,i-3,'down') && [i-4,i-3,i-2].every(k=>bear(b[k])) && b[i-3].close<b[i-4].close && b[i-2].close<b[i-3].close && bear(b[i-1]) && upper(b[i-1])>=body(b[i-1])*.6 && bull(b[i]) && b[i].close>b[i-1].open;
  D[21] = (b,i) => i>=1 && trend(b,i,'down') && bear(b[i-1]) && bull(b[i]) && approx(b[i].close,b[i-1].close,tolerance(b,i)) && body(b[i])>avgBody(b,i)*.7;
  D[22] = (b,i) => i>=1 && trend(b,i,'up') && bull(b[i-1]) && bear(b[i]) && bodyEngulfs(b[i],b[i-1]);
  D[23] = (b,i) => trend(b,i,'up') && bear(b[i]) && longBody(b,i) && nearHigh(b[i]) && lower(b[i])<=range(b[i])*.18;
  D[24] = (b,i) => i>=2 && trend(b,i-2,'up') && [i-2,i-1,i].every(k=>bear(b[k])&&body(b[k])>=range(b[k])*.5) && b[i-1].close<b[i-2].close && b[i].close<b[i-1].close && opensInsideBody(b[i-1],b[i-2]) && opensInsideBody(b[i],b[i-1]) && lower(b[i-2])<body(b[i-2])*.7 && lower(b[i-1])<body(b[i-1])*.7 && lower(b[i])<body(b[i])*.7;
  D[25] = (b,i) => i>=3 && trend(b,i-2,'up') && [i-3,i-2,i-1].every(k=>bull(b[k])) && b[i-2].close>b[i-3].close && b[i-1].close>b[i-2].close && bear(b[i]) && b[i].open>=b[i-1].close-tolerance(b,i)*.25 && b[i].close<=b[i-3].open;
  D[26] = (b,i) => trend(b,i,'up') && lower(b[i])>=Math.max(body(b[i])*2,range(b[i])*.45) && upper(b[i])<=Math.max(body(b[i])*.6,range(b[i])*.12) && bodyHigh(b[i])>=b[i].low+range(b[i])*.65;
  D[27] = (b,i) => i>=2 && trend(b,i-1,'up') && bull(b[i-2]) && longBody(b,i-2) && bear(b[i-1]) && bodyGapUp(b[i-1],b[i-2],-tolerance(b,i)*.1) && bear(b[i]) && b[i].open>b[i-1].open && b[i].close<b[i-1].close && b[i].close>b[i-2].close;
  D[28] = (b,i) => i>=2 && trend(b,i-1,'up') && bull(b[i-2]) && longBody(b,i-2) && smallBody(b,i-1) && bear(b[i]) && b[i].close<midBody(b[i-2]);
  D[29] = (b,i) => trend(b,i,'up') && upper(b[i])>=Math.max(body(b[i])*2,range(b[i])*.45) && lower(b[i])<=Math.max(body(b[i])*.6,range(b[i])*.12) && bodyLow(b[i])<=b[i].low+range(b[i])*.35;
  D[30] = (b,i) => i>=1 && trend(b,i,'up') && bull(b[i-1]) && longBody(b,i-1) && bear(b[i]) && smallBody(b,i) && insideBody(b[i],b[i-1]);
  D[31] = (b,i) => i>=1 && trend(b,i,'up') && bull(b[i-1]) && longBody(b,i-1) && doji(b[i]) && (bodyGapUp(b[i],b[i-1],-tolerance(b,i)*.1)||b[i].open>midBody(b[i-1]));
  D[32] = (b,i) => i>=2 && trend(b,i-1,'up') && bull(b[i-2]) && doji(b[i-1]) && bear(b[i]) && (wickGapUp(b[i-1],b[i-2])||bodyGapUp(b[i-1],b[i-2])) && (wickGapDown(b[i],b[i-1])||bodyGapDown(b[i],b[i-1]));
  D[33] = (b,i) => i>=1 && trend(b,i,'up') && approx(b[i].high,b[i-1].high,tolerance(b,i)) && bear(b[i]) && (bull(b[i-1])||doji(b[i-1]));
  D[34] = (b,i) => i>=1 && trend(b,i,'up') && bull(b[i-1]) && bear(b[i]) && (bodyGapDown(b[i],b[i-1],-tolerance(b,i)*.1)||(b[i].open<=b[i-1].open&&b[i].close<b[i-1].open-body(b[i-1])*.5)) && longBody(b,i);
  D[35] = (b,i) => i>=2 && trend(b,i-1,'up') && bull(b[i-2]) && longBody(b,i-2) && bear(b[i-1]) && insideBody(b[i-1],b[i-2]) && bear(b[i]) && b[i].close<b[i-2].open;
  D[36] = (b,i) => i>=2 && trend(b,i-1,'up') && bull(b[i-2]) && bear(b[i-1]) && bodyEngulfs(b[i-1],b[i-2]) && bear(b[i]) && b[i].close<b[i-1].close;
  D[37] = (b,i) => i>=4 && trend(b,i-4,'down') && strongBear(b[i-4]) && (bodyGapDown(b[i-3],b[i-4],-tolerance(b,i)*.25)||b[i-3].open<midBody(b[i-4])) && [i-3,i-2,i-1].every(k=>body(b[k])<body(b[i-4])*.75&&b[k].high<b[i-4].open) && strongBear(b[i]) && b[i].close<b[i-4].close;
  D[38] = (b,i) => i>=1 && trend(b,i,'up') && bull(b[i-1]) && longBody(b,i-1) && bear(b[i]) && b[i].close<midBody(b[i-1]) && b[i].close>b[i-1].open && b[i].open>=b[i-1].close-tolerance(b,i)*.5;

  function normalizeBars(bars) {
    return (bars || []).map(c => ({
      openTime:Number(c.openTime ?? c.time ?? 0), open:Number(c.open), high:Number(c.high), low:Number(c.low), close:Number(c.close),
      volume:Number(c.volume ?? 0), closeTime:Number(c.closeTime ?? 0),
    })).filter(c => [c.open,c.high,c.low,c.close].every(Number.isFinite));
  }
  function detectAt(inputBars,index) {
    const bars=normalizeBars(inputBars); if(!bars.length) return [];
    const i=index==null?bars.length-1:index; if(i<0||i>=bars.length) return [];
    const hits=[];
    for(const p of PATTERNS){ try{ if(D[p.id]?.(bars,i)) hits.push({...p}); }catch(_){} }
    return hits;
  }
  const detectLatest = inputBars => detectAt(inputBars,(inputBars||[]).length-1);
  return { patterns:PATTERNS.slice(), detectorCount:PATTERNS.length, ruleCount:Object.keys(D).length, detectAt, detectLatest, helpers:{bull,bear,body,range,upper,lower,doji,atr,trend} };
});
