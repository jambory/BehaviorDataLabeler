import {app,BrowserWindow,dialog,ipcMain,Menu,protocol} from 'electron';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {prepareProject,loadProject,saveProject,readLabels} from './project.js';
const here=path.dirname(fileURLToPath(import.meta.url));
protocol.registerSchemesAsPrivileged([{scheme:'bdl',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let win, project, mediaToken, controller, dirty=false, closingAfterSave=false;
const notify = message => win?.webContents.send('progress',message);
function exposeProject(p) { project=p; mediaToken=randomUUID(); return {...p,mediaBase:`bdl://media/${mediaToken}/`}; }
const openDialog = options => dialog.showOpenDialog(win,options);
async function openProject(kind) {
  if(controller) throw new Error('A video is already being prepared.');
  const result=await openDialog({title:kind==='video'?'Choose a video':'Resume a labeling job',properties:['openFile'],filters:kind==='video'?[{name:'Video',extensions:['mp4','mov','mkv','avi','webm','m4v','mts']}]:[{name:'Labeling job',extensions:['json']}]});
  if(result.canceled) return null;
  controller=new AbortController();
  const options={signal:controller.signal,progress:notify};
  try {
    if(kind==='job') return exposeProject(await loadProject(result.filePaths[0],options));
    const videoPath=result.filePaths[0],stem=path.parse(videoPath).name;
    const contentName=`${stem}_behavior_labels`;
    const folder=await openDialog({
      title:'Choose a parent folder for the labeling job',
      message:`A folder named “${contentName}” will be created here for frames, labels, and the resume config.`,
      buttonLabel:'Use This Parent Folder',
      defaultPath:path.dirname(videoPath),
      properties:['openDirectory','createDirectory'],
    });
    if(folder.canceled) return null;
    const contentPath=path.join(folder.filePaths[0],contentName);
    const labelsPath=path.join(contentPath,`${stem}_labels.pkl`);
    const configPath=path.join(contentPath,`${stem}_labels.job.json`);
    const framesPath=path.join(contentPath,'frames');
    await fs.mkdir(framesPath,{recursive:true});
    const p=await prepareProject({videoPath,framesPath,labelsPath,configPath},options);
    try { await fs.access(labelsPath); p.segments=await readLabels(labelsPath,p.frameCount); } catch(error) { if(error.code!=='ENOENT') throw error; }
    await saveProject(p,p.segments);
    return exposeProject(p);
  } finally {controller=null;notify('');}
}
ipcMain.handle('open',(_event,kind)=>{if(!['video','job'].includes(kind)) throw new Error('Invalid open request.'); return openProject(kind);});
ipcMain.handle('cancel',()=>controller?.abort());
ipcMain.handle('save',async(_event,configPath,segments)=>{
  if(!project) throw new Error('No job is open.');
  if(configPath!==project.configPath)throw new Error('The active job changed. Reopen the intended job before saving.');
  const result=await saveProject(project,segments);
  if(closingAfterSave) {dirty=false;win.close();}
  return result;
});
ipcMain.handle('import-labels',async()=>{
  if(!project) return null;
  const result=await openDialog({title:'Import existing frame labels',properties:['openFile'],filters:[{name:'Python labels',extensions:['pkl','pickle']}]});
  if(result.canceled)return null;
  return readLabels(result.filePaths[0],project.frameCount);
});
ipcMain.on('dirty',(_event,value)=>{dirty=Boolean(value);win?.setDocumentEdited(dirty);});
ipcMain.on('save-failed',()=>{closingAfterSave=false;});
ipcMain.handle('reveal',async()=>{if(project) {const {shell}=await import('electron');shell.showItemInFolder(project.configPath);}});
async function mediaResponse(request) {
  try {
    const url=new URL(request.url), parts=url.pathname.split('/').filter(Boolean);
    if(url.hostname!=='media'||parts[0]!==mediaToken||!project) return new Response('Not found',{status:404});
    const name=parts[1];
    if(parts.length!==2 || !(name==='playback.mp4'||/^(?:frame_\d{8}|thumb_\d{6})\.jpg$/.test(name))) return new Response('Not found',{status:404});
    const file=path.join(project.framesPath,name),stat=await fs.stat(file);
    let start=0,end=stat.size-1,status=200;
    const range=request.headers.get('range');
    if(range) {
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${stat.size}`}});
      start=match[1]?Number(match[1]):Math.max(0,stat.size-Number(match[2]));
      end=match[1]&&match[2]?Math.min(end,Number(match[2])):end;
      if(start>end||start>=stat.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${stat.size}`}});
      status=206;
    }
    const headers={'Content-Type':name.endsWith('.mp4')?'video/mp4':'image/jpeg','Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'no-store'};
    if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;
    return new Response(request.method==='HEAD'?null:Readable.toWeb(createReadStream(file,{start,end})),{status,headers});
  }catch{return new Response('Media unavailable',{status:404});}
}
function createWindow(){
  win=new BrowserWindow({width:1500,height:1000,minWidth:960,minHeight:680,title:'Behavior Data Labeler',backgroundColor:'#111410',webPreferences:{preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.on('close',event=>{
    if(controller){event.preventDefault();dialog.showMessageBoxSync(win,{message:'Finish or cancel video preparation before closing.',buttons:['OK']});return;}
    if(!dirty)return;
    event.preventDefault();
    const answer=dialog.showMessageBoxSync(win,{type:'question',message:'Save your behavior labels before closing?',buttons:['Save','Cancel','Discard'],defaultId:0,cancelId:1});
    if(answer===2){dirty=false;win.close();}
    if(answer===0){closingAfterSave=true;win.webContents.send('save-request');}
  });
  win.on('closed',()=>{win=null;});
  win.loadFile(path.join(here,'../dist/index.html'));
}
app.whenReady().then(()=>{
  protocol.handle('bdl',mediaResponse);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==='darwin'?[{role:'appMenu'}]:[]),
    {label:'File',submenu:[{label:'Open video…',accelerator:'CmdOrCtrl+O',click:()=>win?.webContents.send('open-request','video')},{label:'Resume job…',accelerator:'CmdOrCtrl+Shift+O',click:()=>win?.webContents.send('open-request','job')},{label:'Save',accelerator:'CmdOrCtrl+S',click:()=>win?.webContents.send('save-request')},{type:'separator'},{role:'close'}]},
    {label:'Edit',submenu:[{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'View',submenu:[{role:'togglefullscreen'},{role:'toggleDevTools'}]}
  ]));
  createWindow();
}).catch(error=>{dialog.showErrorBox('Unable to start',error.stack||String(error));app.quit();});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('activate',()=>{if(!win)createWindow();});
