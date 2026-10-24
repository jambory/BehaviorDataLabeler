const {spawn}=require('node:child_process');
const path=require('node:path');
const env={...process.env};
// Some development hosts set this for their own subprocesses; this command opens a GUI.
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),process.argv.slice(2).length?process.argv.slice(2):['.'],{cwd:path.resolve(__dirname,'..'),env,stdio:'inherit'});
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
