import assert from 'node:assert/strict';
const tail=Buffer.from([0,0,128,127]);
const old=Buffer.alloc(8);old.writeFloatLE(65408,4);
assert.equal(old.indexOf(tail),3); // exact reproducible cross-field delimiter
const prefixes=[null,new Set(),new Set(),new Set()],suffixes=[null,new Set(),new Set(),new Set()];
const encode=w=>w<32768?65536+2*w:262144+8*(w-32768);
const decode=w=>w<262144?(w-65536)/2:32768+(w-262144)/8;
for(let w=0;w<=65535;w++){
 const b=Buffer.alloc(4);b.writeFloatLE(encode(w));assert.equal(decode(b.readFloatLE(0)),w);assert.equal(decode(Number(b.readFloatLE(0).toFixed(6))),w);assert.equal(b.indexOf(tail),-1);
 const afterZero=Buffer.concat([Buffer.alloc(4),b]);assert.equal(afterZero.indexOf(tail),-1);
 const beforeZero=Buffer.concat([b,Buffer.alloc(4)]);assert.equal(beforeZero.indexOf(tail),-1);
 for(let n=1;n<=3;n++){prefixes[n].add(b.subarray(0,n).toString('hex'));suffixes[n].add(b.subarray(4-n).toString('hex'));}
}
// Exact all-pairs boundary proof using sets, not billions of sampled pairs.
for(let n=1;n<=3;n++)assert(!(suffixes[n].has(tail.subarray(0,n).toString('hex'))&&prefixes[4-n].has(tail.subarray(n).toString('hex'))));
console.log('PASS old zero/65408 delimiter; all65536 split-range words exact includingCSV6decimals, all encoded pairs and zero boundaries delimiter-free');
