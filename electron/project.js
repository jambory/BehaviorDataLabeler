import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { BEHAVIORS, validateSegments, normalizeSegments, labelsToSegments, segmentsToLabels } from '../src/model.js';
import { decodeLabels, encodeLabels } from './pickle.js';
const binary = p => p.replace('app.asar', 'app.asar.unpacked');
const ffmpeg = process.env.FFMPEG_PATH || binary(ffmpegStatic);
const ffprobe = process.env.FFPROBE_PATH || binary(ffprobeStatic.path);
export async function atomicWrite(file, data) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(tmp, data); await fs.rename(tmp,file); } finally { await fs.rm(tmp,{force:true}); }
}
export function run(command, args, { signal, progress } = {}) {
  return new Promise((resolve,reject) => {
    const child = spawn(command,args,{windowsHide:true, signal});
    let stdout='', stderr='';
    child.stdout.on('data', b => { stdout += b; progress?.(b.toString()); });
    child.stderr.on('data', b => { stderr=(stderr+b).slice(-12000); });
    child.once('error',reject);
    child.once('close',code => code===0 ? resolve(stdout) : reject(new Error(signal?.aborted ? 'Preparation canceled.' : stderr || `Media tool exited with ${code}`)));
  });
}
export async function probe(videoPath, signal) {
  const info=JSON.parse(await run(ffprobe,['-v','error','-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate,r_frame_rate,duration:format=duration','-of','json',videoPath],{signal}));
  const v=info.streams?.[0];
  if (!v) throw new Error('This file has no video stream.');
  const rate = value => { const [a,b=1]=String(value).split('/').map(Number); return a/b; };
  const fps=rate(v.avg_frame_rate)||rate(v.r_frame_rate), duration=Number(v.duration || info.format.duration);
  if (!(fps>0 && fps<=1000 && duration>0 && Number.isFinite(duration))) throw new Error('Could not determine a usable video frame rate or duration.');
  return { width:v.width,height:v.height,fps,duration };
}
export async function prepareProject({videoPath,framesPath,labelsPath,configPath}, {signal, progress=()=>{}} = {}) {
  const stat=await fs.stat(videoPath);
  const fingerprint={path:path.resolve(videoPath),size:stat.size,mtime:stat.mtimeMs};
  const metadata=await probe(videoPath,signal);
  const manifestPath=path.join(framesPath,'frames.json');
  let manifest;
  try { manifest=JSON.parse(await fs.readFile(manifestPath,'utf8')); } catch { /* No completed cache. */ }
  if (manifest && JSON.stringify(manifest.source)===JSON.stringify(fingerprint) && manifest.version===2) {
    const files=await fs.readdir(framesPath);
    const fileSet=new Set(files);
    const count=files.filter(f=>/^frame_\d{8}\.jpg$/.test(f)).length;
    if (count===manifest.frameCount && Array.from({length:count},(_,i)=>`frame_${String(i).padStart(8,'0')}.jpg`).every(name=>fileSet.has(name)) && files.includes('playback.mp4') && files.includes('thumb_000000.jpg')) {
      progress('Reusing extracted frames');
      return {version:1,videoPath,framesPath,labelsPath,configPath,...manifest.metadata,frameCount:manifest.frameCount,thumbnailCount:manifest.thumbnailCount,source:fingerprint,segments:[]};
    }
  }
  // Never replace unknown folders or partial output; build inside a dedicated temp folder.
  const existing=await fs.readdir(framesPath);
  if (existing.length) throw new Error('The selected frames folder is not an intact cache for this video. Choose an empty folder or this video’s previously generated frames folder.');
  const staging=path.join(framesPath,`.preparing-${randomUUID()}`);
  await fs.mkdir(staging);
  try {
    const progressFn = phase => chunk => {
      const matches=[...chunk.matchAll(/out_time_us=(\d+)/g)];
      if(matches.length) progress(`${phase} · ${Math.min(100,Math.round(Number(matches.at(-1)[1])/1e6/metadata.duration*100))}%`);
    };
    progress('Extracting original-resolution frames');
    await run(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-i',videoPath,'-map','0:v:0','-vf',`fps=${metadata.fps}`,'-q:v','2','-start_number','0','-progress','pipe:1',path.join(staging,'frame_%08d.jpg')],{signal,progress:progressFn('Extracting frames')});
    const frameCount=(await fs.readdir(staging)).filter(f=>/^frame_\d{8}\.jpg$/.test(f)).length;
    if (!frameCount) throw new Error('No frames were decoded.');
    progress('Preparing playback');
    await run(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-i',videoPath,'-map','0:v:0','-map','0:a:0?','-vf',`fps=${metadata.fps},scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-t',String(frameCount/metadata.fps),'-movflags','+faststart','-progress','pipe:1',path.join(staging,'playback.mp4')],{signal,progress:progressFn('Preparing playback')});
    progress('Preparing timeline thumbnails');
    await run(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-i',path.join(staging,'playback.mp4'),'-vf',`fps=${metadata.fps/Math.max(1,Math.ceil(frameCount/60))},scale=160:-2`,'-q:v','4','-start_number','0',path.join(staging,'thumb_%06d.jpg')],{signal});
    const thumbnailCount=(await fs.readdir(staging)).filter(f=>/^thumb_\d{6}\.jpg$/.test(f)).length;
    for (const name of await fs.readdir(staging)) await fs.rename(path.join(staging,name),path.join(framesPath,name));
    const cache={version:2,source:fingerprint,metadata,frameCount,thumbnailCount};
    await atomicWrite(manifestPath,JSON.stringify(cache,null,2));
    return {version:1,videoPath,framesPath,labelsPath,configPath,...metadata,frameCount,thumbnailCount,source:fingerprint,segments:[]};
  } finally { await fs.rm(staging,{recursive:true,force:true}); }
}
export async function readLabels(labelsPath, frameCount) {
  const labels=decodeLabels(await fs.readFile(labelsPath));
  for (const [frame,names] of labels) {
    if(frame>=frameCount) throw new Error(`Labels contain frame ${frame}, beyond this video’s ${frameCount} frames.`);
    const unknown=names.filter(n=>!BEHAVIORS.includes(n));
    if(unknown.length) throw new Error(`Unknown behaviors in labels: ${unknown.join(', ')}.`);
  }
  return labelsToSegments(labels,frameCount);
}
export async function loadProject(configPath, options) {
  const config=JSON.parse(await fs.readFile(configPath,'utf8'));
  if(config.version!==1 || !['videoPath','framesPath','labelsPath'].every(k=>typeof config[k]==='string' && config[k])) throw new Error('This is not a Behavior Data Labeler job config.');
  for(const k of ['videoPath','framesPath','labelsPath']) config[k]=path.resolve(path.dirname(configPath),config[k]);
  const project=await prepareProject({...config,configPath},options);
  if(config.source && JSON.stringify(config.source)!==JSON.stringify(project.source)) throw new Error('The source video has changed since this job was saved. Open it as a new video.');
  // Pickle is the label source of truth. The config keeps the location and media metadata.
  project.segments=await readLabels(project.labelsPath,project.frameCount);
  return project;
}
export async function saveProject(project, segments) {
  const normalized=normalizeSegments(validateSegments(segments,project.frameCount),project.frameCount);
  await atomicWrite(project.labelsPath,encodeLabels(segmentsToLabels(normalized,project.frameCount)));
  const {segments: ignored,...config}=project;
  await atomicWrite(project.configPath,JSON.stringify({...config,savedAt:new Date().toISOString()},null,2)+'\n');
  project.segments=normalized;
  return {savedAt:new Date().toISOString()};
}
