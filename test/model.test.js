import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {BEHAVIORS,normalizeSegments,segmentsToLabels,labelsToSegments,moveSegment,coverage} from '../src/model.js';
import {encodeLabels,decodeLabels} from '../electron/pickle.js';
const s=(behavior,start,end,id=`${behavior}-${start}`)=>({id,behavior,start,end});
test('overlaps preserve multiple behaviors, same-behavior ranges merge, gaps stay empty',()=>{
  const intervals=[s('sit',0,4),s('paw',2,5),s('sit',4,6),s('stand',8,10)];
  const labels=segmentsToLabels(intervals,10);
  assert.deepEqual(labels,[['sit'],['sit'],['sit','paw'],['sit','paw'],['sit','paw'],['sit'],[],[],['stand'],['stand']]);
  assert.deepEqual(coverage(intervals,10),{covered:8,unlabeled:2});
  assert.equal(normalizeSegments(intervals,10).length,3);
  assert.deepEqual(segmentsToLabels(labelsToSegments(new Map(labels.map((v,i)=>[i,v])),10),10),labels);
});
test('trim and move remain within frame boundaries, preserving at least one frame',()=>{
  const clip=s('sit',10,20);
  assert.deepEqual(moveSegment(clip,'move',100,25),{...clip,start:15,end:25});
  assert.deepEqual(moveSegment(clip,'move',-100,25),{...clip,start:0,end:10});
  assert.equal(moveSegment(clip,'start',100,25).start,19);
  assert.equal(moveSegment(clip,'end',-100,25).end,11);
  assert.throws(()=>normalizeSegments([s('sit',-1,3)],25));
  assert.throws(()=>normalizeSegments([s('unknown',0,3)],25));
});
test('pickle round trip covers large frame indices, Unicode, empty labels and memoized Python protocols',async()=>{
  const labels=Array.from({length:300},(_,i)=>i%2?['sit','paw']:[]);
  assert.deepEqual([...decodeLabels(encodeLabels(labels)).values()],labels);
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'bdl-pickle-'));
  try {
    const file=path.join(tmp,'labels.pkl');await fs.writeFile(file,encodeLabels(labels));
    // Cross-language verification catches format bugs a JS round trip would miss.
    execFileSync('python3',['-c','import pickle,sys; d=pickle.load(open(sys.argv[1],"rb")); assert len(d)==300; assert d[299]==["sit","paw"]; assert d[0]==[]',file]);
    for(const protocol of [2,3,4,5]){
      const bytes=execFileSync('python3',['-c',`import pickle,sys; sys.stdout.buffer.write(pickle.dumps({0:[],1:["sit","paw"],256:["sit"]},protocol=${protocol}))`]);
      assert.deepEqual([...decodeLabels(bytes)],[[0,[]],[1,['sit','paw']],[256,['sit']]]);
    }
  } finally{await fs.rm(tmp,{recursive:true,force:true});}
});
test('pickle import rejects code execution and malformed/truncated data',()=>{
  assert.throws(()=>decodeLabels(Buffer.from('cos\nsystem\n(S"touch /tmp/never"\ntR.')),/Unsupported/);
  assert.throws(()=>decodeLabels(Buffer.from([0x80,4,0x58,5,0,0,0,65])),/Truncated/);
});
