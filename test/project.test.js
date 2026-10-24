import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {prepareProject,loadProject,saveProject,readLabels,run} from '../electron/project.js';
import {decodeLabels} from '../electron/pickle.js';

test('real portrait video: extract, reuse, label, export pickle, resume and reject stale media',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bdl-project-'));
  try{
    const videoPath=path.join(dir,'portrait.mp4'),framesPath=path.join(dir,'frames'),labelsPath=path.join(dir,'portrait_labels.pkl'),configPath=path.join(dir,'portrait_labels.job.json');
    await fs.mkdir(framesPath);
    await run(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=180x320:rate=30000/1001','-t','1','-c:v','libx264','-pix_fmt','yuv420p',videoPath]);
    const p=await prepareProject({videoPath,framesPath,labelsPath,configPath});
    assert.equal(p.width,180);assert.equal(p.height,320);assert.equal(p.frameCount,30);
    assert.ok(Math.abs(p.fps-29.97002997)<1e-6);
    const frames=await fs.readdir(framesPath);assert.ok(frames.includes('frame_00000000.jpg'));assert.ok(frames.includes('frame_00000029.jpg'));assert.ok(frames.includes('playback.mp4'));assert.ok(frames.includes('thumb_000000.jpg'));assert.ok(p.thumbnailCount>0);
    const proxy=JSON.parse(await run(ffprobe.path,['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=nb_read_frames','-of','json',path.join(framesPath,'playback.mp4')]));
    assert.equal(Number(proxy.streams[0].nb_read_frames),p.frameCount);
    const mtime=(await fs.stat(path.join(framesPath,'frame_00000000.jpg'))).mtimeMs;
    let message='';await prepareProject({videoPath,framesPath,labelsPath,configPath},{progress:m=>message=m});
    assert.match(message,/Reusing/);assert.equal((await fs.stat(path.join(framesPath,'frame_00000000.jpg'))).mtimeMs,mtime);
    const segments=[{id:'a',behavior:'sit',start:0,end:15},{id:'b',behavior:'paw',start:5,end:10}];
    await saveProject(p,segments);
    const labels=decodeLabels(await fs.readFile(labelsPath));assert.deepEqual(labels.get(5),['sit','paw']);assert.deepEqual(labels.get(29),[]);assert.equal(labels.size,30);
    const loaded=await loadProject(configPath);assert.equal(loaded.frameCount,30);assert.equal(loaded.segments.length,2);
    assert.deepEqual(loaded.segments.map(({id,...s})=>s),segments.map(({id,...s})=>s));
    assert.deepEqual(await readLabels(labelsPath,30),loaded.segments);
    await assert.rejects(readLabels(labelsPath,15),/beyond/);
    const changed=await fs.stat(videoPath);await fs.utimes(videoPath,changed.atime,new Date(changed.mtimeMs+2000));
    await assert.rejects(loadProject(configPath),/not an intact cache|changed/);
    // A canceled preparation removes staging files so retry can use the folder.
    const fresh=path.join(dir,'canceled');await fs.mkdir(fresh);
    const controller=new AbortController();controller.abort();
    await assert.rejects(prepareProject({videoPath,framesPath:fresh,labelsPath,configPath},{signal:controller.signal}));
    assert.deepEqual(await fs.readdir(fresh),[]);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
