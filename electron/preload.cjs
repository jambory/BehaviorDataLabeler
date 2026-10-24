const {contextBridge,ipcRenderer}=require('electron');
const subscribe=(channel,fn)=>{const listener=(_e,value)=>fn(value);ipcRenderer.on(channel,listener);return()=>ipcRenderer.removeListener(channel,listener);};
contextBridge.exposeInMainWorld('labeler',{
  open:kind=>ipcRenderer.invoke('open',kind),
  save:(configPath,segments)=>ipcRenderer.invoke('save',configPath,segments),
  importLabels:()=>ipcRenderer.invoke('import-labels'),
  cancel:()=>ipcRenderer.invoke('cancel'),
  reveal:()=>ipcRenderer.invoke('reveal'),
  dirty:value=>ipcRenderer.send('dirty',value),
  saveFailed:()=>ipcRenderer.send('save-failed'),
  onProgress:fn=>subscribe('progress',fn),
  onSave:fn=>subscribe('save-request',fn),
  onOpen:fn=>subscribe('open-request',fn)
});
