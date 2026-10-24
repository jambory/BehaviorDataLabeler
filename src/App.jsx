import React, {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {BEHAVIORS,COLORS,clamp,coverage,moveSegment,normalizeSegments} from './model.js';
const api=window.labeler;
const time=s=>`${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toFixed(2).padStart(5,'0')}`;
const frameUrl=(p,f)=>`${p.mediaBase}frame_${Math.floor(f).toString().padStart(8,'0')}.jpg`;
function Icon({name,...props}) {
  const paths={volume:'M3 9h4l5-4v14l-5-4H3z M16 8a6 6 0 0 1 0 8 M19 5a10 10 0 0 1 0 14',muted:'M3 9h4l5-4v14l-5-4H3z M16 9l6 6M22 9l-6 6',folder:'M3 7h6l2 2h10v11H3z M3 7V4h7l2 3',play:'m8 4 12 8-12 8z',pause:'M8 5v14M16 5v14',save:'M4 3h13l4 4v14H3V3z M7 3v7h10V3 M7 21v-7h10v7',back:'M5 5v14 M19 5 7 12l12 7z',next:'M19 5v14 M5 5l12 7-12 7z',undo:'M8 5 3 10l5 5 M3 10h11a6 6 0 0 1 0 12',redo:'m16 5 5 5-5 5 M21 10H10a6 6 0 0 0 0 12',plus:'M12 5v14M5 12h14',trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15 M10 10v7M14 10v7',chevron:'m9 5 7 7-7 7',film:'M3 3h18v18H3z M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4'};
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]}/></svg>;
}
export default function App(){
  const [project,setProject]=useState(null),[history,setHistory]=useState({past:[],present:[],future:[]});
  const [savedKey,setSavedKey]=useState('[]'),[selection,setSelection]=useState(null),[draft,setDraft]=useState(null);
  const [frame,setFrame]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1),[muted,setMuted]=useState(true);
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const [timelineLeft,setTimelineLeft]=useState(0);
  const zoomAnchor=useRef(null);
  const [zoom,setZoom]=useState(0),[trackSize,setTrackSize]=useState('fit'),[timelineHeight,setTimelineHeight]=useState(()=>Number(localStorage.getItem('timelineHeight'))||clamp(window.innerHeight*.57,370,520));
  const [viewSize,setViewSize]=useState({width:900,height:300}),[activeBehavior,setActiveBehavior]=useState('sit');
  const videoRef=useRef(null),scrollRef=useRef(null),latest=useRef({}),saveQueue=useRef(Promise.resolve()),opening=useRef(false),dragCleanup=useRef(null);
  const segments=history.present,key=JSON.stringify(segments),dirty=key!==savedKey;
  latest.current={project,segments,key,dirty,frame,playing,busy};
  const selected=segments.find(s=>s.id===selection), visible=draft||segments;
  const stats=coverage(segments,project?.frameCount||0);
  const count=project?.frameCount||1, fps=project?.fps||30;
  const fitWidth=Math.max(200,viewSize.width-152), maxFactor=Math.max(32,count*8/fitWidth), factor=Math.pow(maxFactor,zoom/100);
  const contentWidth=fitWidth*factor, px=contentWidth/count;
  // Preserve the playhead's screen position while changing the time scale.
  function changeZoom(value){
    if(dragCleanup.current)return;
    const next=clamp(value,0,100),el=scrollRef.current;
    if(el&&next!==zoom){
      const anchorFrame=latest.current.frame+.5,x=anchorFrame*px-el.scrollLeft;
      zoomAnchor.current=next===0?{frame:0,offset:0}:{frame:anchorFrame,offset:x>=0&&x<=fitWidth?x:fitWidth/2};
    }
    setZoom(next);
  }
  useLayoutEffect(()=>{
    const el=scrollRef.current,anchor=zoomAnchor.current;
    if(el&&anchor){el.scrollLeft=anchor.frame*px-anchor.offset;setTimelineLeft(el.scrollLeft);zoomAnchor.current=null;}
  },[px,zoom]);
  const rowHeight=trackSize==='fit'?clamp((viewSize.height-94)/10,28,66):Number(trackSize);
  const commit=useCallback(value=>{
    const current=latest.current;
    const next=normalizeSegments(typeof value==='function'?value(current.segments):value,current.project.frameCount);
    if(JSON.stringify(next)===current.key)return;
    setHistory(h=>({past:[...h.past.slice(-99),h.present],present:next,future:[]}));
  },[]);
  const undo=()=>{setDraft(null);setHistory(h=>h.past.length?{past:h.past.slice(0,-1),present:h.past.at(-1),future:[h.present,...h.future]}:h);};
  const redo=()=>{setDraft(null);setHistory(h=>h.future.length?{past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1)}:h);};
  const save=useCallback(async()=>{
    const snapshot=latest.current;
    if(!snapshot.project)return true;
    const operation=saveQueue.current.catch(()=>{}).then(async()=>{
      setSaving(true);
      try{await api.save(snapshot.project.configPath,snapshot.segments);if(latest.current.project===snapshot.project)setSavedKey(snapshot.key);return true;}
      catch(e){setError(e.message);api.saveFailed();return false;}
      finally{setSaving(false);}
    });
    saveQueue.current=operation;
    return operation;
  },[]);
  const seek=useCallback(value=>{
    const p=latest.current.project;if(!p)return;
    const f=clamp(Math.round(value),0,p.frameCount-1);
    setFrame(f);
    if(videoRef.current)videoRef.current.currentTime=(f+0.05)/p.fps;
  },[]);
  const pause=()=>{videoRef.current?.pause();setPlaying(false);};
  const toggle=()=>{
    const v=videoRef.current;if(!v)return;
    if(v.paused){if(v.ended||latest.current.frame>=latest.current.project.frameCount-1)seek(0);v.play().catch(e=>setError(`Playback failed: ${e.message}`));}
    else v.pause();
  };
  const open=useCallback(async kind=>{
    if(opening.current||latest.current.busy)return;
    opening.current=true;
    try{
      videoRef.current?.pause();setBusy(true);
      if(latest.current.dirty && !await save())return;
      setError('');setBusy(true);setProgress('Choose your files and output locations…');
      const p=await api.open(kind);
      if(p){setProject(p);setHistory({past:[],present:p.segments,future:[]});setSavedKey(JSON.stringify(p.segments));setSelection(null);setFrame(0);setZoom(0);setTimelineLeft(0);setMuted(true);zoomAnchor.current=null;setDraft(null);setPlaying(false);if(scrollRef.current){scrollRef.current.scrollTop=0;scrollRef.current.scrollLeft=0;}}
    }catch(e){if(!/canceled|aborted/i.test(e.message))setError(e.message);}
    finally{setBusy(false);setProgress('');opening.current=false;}
  },[save]);
  useEffect(()=>{
    if(!api)return;
    const clean=[api.onProgress(setProgress),api.onSave(()=>{if(!latest.current.busy)save();}),api.onOpen(open)];
    return()=>clean.forEach(fn=>fn());
  },[save,open]);
  useEffect(()=>{api?.dirty(dirty);},[dirty]);
  useEffect(()=>{if(!dirty||busy||draft)return;const timer=setTimeout(save,900);return()=>clearTimeout(timer);},[key,dirty,busy,draft,save]);
  useLayoutEffect(()=>{
    const el=scrollRef.current;if(!el)return;
    const observer=new ResizeObserver(()=>setViewSize({width:el.clientWidth,height:el.clientHeight}));observer.observe(el);return()=>observer.disconnect();
  },[project]);
  useEffect(()=>{
    const v=videoRef.current;if(!v)return;let id;
    const tick=()=>{if(!v.paused)setFrame(clamp(Math.floor(v.currentTime*fps+0.001),0,count-1));id=requestAnimationFrame(tick);};
    id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);
  },[project,fps,count]);
  useEffect(()=>{if(videoRef.current)videoRef.current.playbackRate=speed;},[speed,project]);
  useEffect(()=>{
    if(!playing||!scrollRef.current)return;
    const el=scrollRef.current,x=frame*px;
    if(x<el.scrollLeft||x>el.scrollLeft+el.clientWidth-180)el.scrollLeft=Math.max(0,x-(el.clientWidth-180)*.2);
  },[frame,playing,px]);
  useEffect(()=>()=>dragCleanup.current?.(),[]);
  const remove=()=>{if(selection){commit(ss=>ss.filter(s=>s.id!==selection));setSelection(null);}};
  const add=()=>{
    if(!project)return;pause();const s={id:crypto.randomUUID(),behavior:activeBehavior,start:frame,end:Math.min(count,frame+Math.max(1,Math.round(fps)))};
    commit(ss=>[...ss,s]);setSelection(s.id);
  };
  useEffect(()=>{
    const handler=e=>{
      if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||busy)return;
      const mod=e.metaKey||e.ctrlKey;
      if(mod&&e.key.toLowerCase()==='s'){e.preventDefault();save();return;}
      if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
      if(!project)return;
      if(e.code==='Space'){e.preventDefault();toggle();}
      if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();pause();seek(latest.current.frame+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?Math.round(fps):1));}
      if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();remove();}
      if(e.key.toLowerCase()==='a'){e.preventDefault();add();}
      if(e.key==='Escape'){setSelection(null);dragCleanup.current?.();setDraft(null);}
      if(e.key==='='||e.key==='+'){e.preventDefault();changeZoom(zoom+10);}
      if(e.key==='-'){e.preventDefault();changeZoom(zoom-10);}
    };
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  });
  function pointerSession(event,onMove,onEnd){
    event.preventDefault();event.stopPropagation();dragCleanup.current?.();
    let last=event;
    const move=e=>{last=e;onMove(e);};
    const stop=e=>{cleanup();onEnd(e||last);};
    const cancel=()=>{cleanup();setDraft(null);};
    const cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);dragCleanup.current=null;};
    dragCleanup.current=cleanup;
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);
  }
  function scrollAtEdge(e){const el=scrollRef.current,r=el.getBoundingClientRect();if(e.clientX>r.right-35)el.scrollLeft+=20;else if(e.clientX<r.left+185)el.scrollLeft-=20;}
  function draw(event,behavior){
    if(event.button!==0)return;
    pause();const lane=event.currentTarget;
    const getFrame=e=>clamp(Math.floor((e.clientX-lane.getBoundingClientRect().left)/px),0,count-1);
    const start=getFrame(event),base=segments,id=crypto.randomUUID();let next;
    seek(start);setActiveBehavior(behavior);setSelection(id);
    const update=e=>{scrollAtEdge(e);const end=getFrame(e);next=[...base,{id,behavior,start:Math.min(start,end),end:Math.max(start,end)+1}];setDraft(next);};
    update(event);
    pointerSession(event,update,()=>{if(next.at(-1).end-next.at(-1).start===1)next.at(-1).end=Math.min(count,start+Math.max(1,Math.round(fps)));setDraft(null);commit(next);});
  }
  function drag(event,s,mode){
    if(event.button!==0)return;
    pause();setSelection(s.id);setActiveBehavior(s.behavior);
    const startX=event.clientX,initialScroll=scrollRef.current.scrollLeft,base=segments;let next=base;
    pointerSession(event,e=>{scrollAtEdge(e);const delta=Math.round((e.clientX-startX+scrollRef.current.scrollLeft-initialScroll)/px);next=base.map(x=>x.id===s.id?moveSegment(s,mode,delta,count):x);setDraft(next);},()=>{setDraft(null);commit(next);});
  }
  function scrub(event){
    if(event.button!==0)return;pause();const lane=event.currentTarget;
    const update=e=>seek((e.clientX-lane.getBoundingClientRect().left)/px);
    update(event);pointerSession(event,update,()=>{});
  }
  const importLabels=async()=>{
    pause();try{const labels=await api.importLabels();if(labels){commit(labels);setSelection(null);setError('');}}catch(e){setError(e.message);}
  };
  const resize=e=>{
    const y=e.clientY,h=timelineHeight;
    pointerSession(e,ev=>setTimelineHeight(clamp(h+y-ev.clientY,220,window.innerHeight-320)),()=>{setTimelineHeight(h=>{localStorage.setItem('timelineHeight',h);return h;});});
  };
  const updateSelected=(field,value)=>{if(!selected)return;const n=Number(value);if(field!=='behavior'&&(!Number.isInteger(n)||n<0))return;const s={...selected,[field]:field==='behavior'?value:n};if(s.start<s.end&&s.end<=count)commit(ss=>ss.map(x=>x.id===s.id?s:x));};
  const targetStep=Math.max(1,100/px),magnitude=10**Math.floor(Math.log10(targetStep));
  const tickStep=Math.max(1,Math.ceil(targetStep/magnitude)*magnitude);
  const firstTick=Math.floor(timelineLeft/px/tickStep)*tickStep;
  const ticks=Array.from({length:Math.ceil(fitWidth/px/tickStep)+3},(_,i)=>firstTick+i*tickStep).filter(f=>f<count);
  const thumbCount=Math.min(60,Math.max(8,Math.ceil(contentWidth/140))),thumbWidth=contentWidth/thumbCount;
  return <div className="app">
    <header className="topbar"><div className="brand"><span className="brand-icon"><Icon name="film"/></span><div>BEHAVIOR<span>DATA LABELER</span></div></div>
      <div className="job-title"><strong>{project?project.videoPath.split(/[\\/]/).at(-1):'A closer look at every behavior.'}</strong><span>{project?`${project.width} × ${project.height} · ${project.fps.toFixed(3).replace(/\.?0+$/,'')} fps · ${count.toLocaleString()} frames`:'Frame by frame. Behavior by behavior.'}</span></div>
      <button onClick={()=>open('video')} disabled={busy}><Icon name="folder"/>Open video</button><button onClick={()=>open('job')} disabled={busy}>Resume job</button>
      {project&&<><div className={`save-status ${dirty?'unsaved':''}`}><i/>{saving?'Saving…':dirty?'Unsaved changes':'All changes saved'}</div><button className="primary" onClick={save} disabled={busy||saving}><Icon name="save"/>Save</button></>}
    </header>
    {error&&<div className="error" role="alert"><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss error">×</button></div>}
    {!project?<main className="welcome"><div className="welcome-copy"><p className="eyebrow">DOGTONOMOUS / ANNOTATION WORKSPACE</p><h1>Every frame.<br/><em>Every behavior.</em></h1><p>Turn video into behavior training data. Mark precise intervals, layer behaviors, and pick up exactly where you left off.</p><div className="welcome-actions"><button className="primary" onClick={()=>open('video')} disabled={busy}><Icon name="plus"/>Start with a video</button><button onClick={()=>open('job')} disabled={busy}><Icon name="folder"/>Resume a labeling job</button></div><div className="workflow"><span>01 <b>Open a video</b></span><Icon name="chevron"/><span>02 <b>Label the timeline</b></span><Icon name="chevron"/><span>03 <b>Save frame labels</b></span></div></div><div className="welcome-preview"><div className="preview-top"><i/>10 BEHAVIOR TRACKS<span>FRAME PRECISE</span></div>{BEHAVIORS.map((b,i)=><div className="preview-row" key={b}><span>{b}</span><div><i style={{left:`${[5,35,18,62,52,25,72,40,80,12][i]}%`,width:`${[32,25,15,24,16,20,18,34,12,23][i]}%`,background:COLORS[i]}}/></div></div>)}<div className="preview-line"/></div></main>:<>
    <main className="workspace"><section className="viewer-column"><div className="viewer-heading"><span><i className="live-dot"/>VIDEO PREVIEW</span><span>{playing?'PLAYING':'PAUSED'} / {frame.toString().padStart(6,'0')}</span></div><div className="video-stage">
      <video key={project.mediaBase} ref={videoRef} src={`${project.mediaBase}playback.mp4`} playsInline muted={muted} preload="auto" onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>{setPlaying(false);setFrame(count-1);}} onLoadedMetadata={()=>{videoRef.current.playbackRate=speed;}} onError={()=>setError('The playback video could not be loaded. Reopen the job to check its cache.')} onTimeUpdate={e=>{if(!e.currentTarget.paused)setFrame(clamp(Math.floor(e.currentTarget.currentTime*fps+0.001),0,count-1));}}/>
      {!playing&&<img className="exact-frame" src={frameUrl(project,frame)} alt={`Video frame ${frame}`} draggable="false"/>}
      <button className="mute-button" aria-label={muted?'Unmute video':'Mute video'} aria-pressed={muted} title={muted?'Unmute video':'Mute video'} onClick={()=>setMuted(value=>!value)}><Icon name={muted?'muted':'volume'}/><span>{muted?'Unmute':'Mute'}</span></button>
      <span className="frame-badge">FRAME {frame.toLocaleString()} <i>/ {(count-1).toLocaleString()}</i></span>
    </div><div className="transport"><span className="timecode">{time(frame/fps)} <i>/ {time(count/fps)}</i></span><div className="playback-buttons"><button title="Previous frame (←)" aria-label="Previous frame" onClick={()=>{pause();seek(frame-1);}}><Icon name="back"/></button><button className="play" title="Play / pause (Space)" aria-label={playing?'Pause':'Play'} onClick={toggle}><Icon name={playing?'pause':'play'}/></button><button title="Next frame (→)" aria-label="Next frame" onClick={()=>{pause();seek(frame+1);}}><Icon name="next"/></button></div><label className="speed"><select aria-label="Playback speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[.25,.5,1,1.5,2].map(s=><option key={s} value={s}>{s}×</option>)}</select></label></div><input className="scrubber" type="range" aria-label="Video frame" min="0" max={count-1} value={frame} onChange={e=>{pause();seek(Number(e.target.value));}}/></section>
      <aside className="inspector"><div className="section-title">LABEL INSPECTOR<span>{String(segments.length).padStart(2,'0')}</span></div>{selected?<><div className="selected-behavior" style={{'--color':COLORS[BEHAVIORS.indexOf(selected.behavior)]}}><i/>{selected.behavior}</div><label>Behavior<select value={selected.behavior} onChange={e=>updateSelected('behavior',e.target.value)}>{BEHAVIORS.map(b=><option key={b}>{b}</option>)}</select></label><div className="frame-inputs"><label>Start frame<input aria-label="Start frame" type="number" min="0" max={selected.end-1} value={selected.start} onChange={e=>updateSelected('start',e.target.value)}/></label><label>End frame <small>exclusive</small><input aria-label="End frame exclusive" type="number" min={selected.start+1} max={count} value={selected.end} onChange={e=>updateSelected('end',e.target.value)}/></label></div><div className="duration-line"><span>{selected.end-selected.start} frames</span><span>{((selected.end-selected.start)/fps).toFixed(2)}s</span></div><button className="full" onClick={()=>seek(selected.start)}>Jump to start <Icon name="chevron"/></button><div className="boundary-buttons"><button disabled={frame>=selected.end} onClick={()=>updateSelected('start',frame)}>Start here</button><button disabled={frame<selected.start} onClick={()=>updateSelected('end',frame+1)}>End here</button></div><button className="danger full" onClick={remove}><Icon name="trash"/>Delete label</button></>:<div className="inspector-empty"><span className="selection-symbol">⌁</span><strong>Make a little sense of motion.</strong><p>Click and drag an empty behavior track to label a range. Select a label to fine-tune its frames.</p></div>}
        <div className="coverage"><div className="section-title">VIDEO COVERAGE<span>{Math.round(stats.covered/count*100)}%</span></div><div className="meter"><i style={{width:`${stats.covered/count*100}%`}}/></div><p>{stats.unlabeled.toLocaleString()} frames without a label</p></div><div className="job-files"><button className="text-button" onClick={importLabels}>Import existing .pkl labels</button><button className="text-button" onClick={()=>api.reveal()}>Show saved job in Finder / Explorer ↗</button></div><div className="shortcut-help"><span><kbd>Space</kbd> play / pause</span><span><kbd>←</kbd><kbd>→</kbd> one frame</span><span><kbd>A</kbd> label at playhead</span><span><kbd>⌘/Ctrl Z</kbd> undo</span></div>
      </aside></main>
    <div className="panel-resizer" onPointerDown={resize} role="separator" aria-orientation="horizontal" aria-label="Resize timeline" tabIndex="0" onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();setTimelineHeight(h=>clamp(h+(e.key==='ArrowUp'?20:-20),220,window.innerHeight-320));}}}><i/></div>
    <section className="timeline-section" style={{height:timelineHeight}}><div className="timeline-toolbar"><div className="timeline-name">BEHAVIOR TIMELINE <span>10 TRACKS</span></div><div className="history-tools"><button aria-label="Undo" title="Undo (⌘/Ctrl Z)" onClick={undo} disabled={!history.past.length}><Icon name="undo"/></button><button aria-label="Redo" title="Redo (⌘/Ctrl Shift Z)" onClick={redo} disabled={!history.future.length}><Icon name="redo"/></button></div><select aria-label="Behavior to add" value={activeBehavior} onChange={e=>setActiveBehavior(e.target.value)}>{BEHAVIORS.map(b=><option key={b}>{b}</option>)}</select><button className="add-button" onClick={add}><Icon name="plus"/>Add label</button><div className="toolbar-spacer"/><label>Tracks<select aria-label="Track height" value={trackSize} onChange={e=>setTrackSize(e.target.value)}><option value="fit">Fit all</option><option value="32">Compact</option><option value="48">Comfortable</option><option value="68">Expanded</option></select></label><div className="zoom-control" role="group" aria-label="Timeline time zoom"><button onClick={()=>changeZoom(0)} title="Fit whole video">Fit</button><button aria-label="Zoom timeline out" title="Zoom out (−)" disabled={zoom===0} onClick={()=>changeZoom(zoom-10)}>−</button><input aria-label="Timeline zoom" title="Zoom the timeline in time" type="range" min="0" max="100" value={zoom} onChange={e=>changeZoom(Number(e.target.value))}/><button aria-label="Zoom timeline in" title="Zoom in (+)" disabled={zoom===100} onClick={()=>changeZoom(zoom+10)}>+</button><output className="zoom-readout">{(fitWidth/px/fps).toFixed(2)}s view</output></div></div>
      <div className="timeline-scroll" ref={scrollRef} onScroll={e=>setTimelineLeft(e.currentTarget.scrollLeft)}><div className="timeline-grid" style={{width:contentWidth+152}}>
        <div className="track-header ruler-label">TIME / FRAMES</div><div className="ruler" style={{width:contentWidth}} onPointerDown={scrub}>{ticks.map((f,i)=><span className="tick" key={i} style={{left:f*px}}><i/>{time(f/fps)}<small>{f}</small></span>)}</div>
        <div className="track-header film-label"><Icon name="film"/>SOURCE VIDEO</div><div className="filmstrip" style={{width:contentWidth}} onPointerDown={scrub}>{Array.from({length:thumbCount},(_,i)=><img key={i} src={`${project.mediaBase}thumb_${Math.min(project.thumbnailCount-1,Math.floor(i*project.thumbnailCount/thumbCount)).toString().padStart(6,'0')}.jpg`} style={{width:thumbWidth}} loading="lazy" alt="" draggable="false"/>)}</div>
        {BEHAVIORS.map((behavior,i)=><React.Fragment key={behavior}><button className={`track-header behavior-header ${activeBehavior===behavior?'active':''}`} style={{height:rowHeight,'--color':COLORS[i]}} onClick={()=>setActiveBehavior(behavior)}><span className="track-index">{String(i+1).padStart(2,'0')}</span><i/><strong>{behavior}</strong><span className="track-count">{visible.filter(s=>s.behavior===behavior).length}</span></button><div className="behavior-lane" data-behavior={behavior} style={{height:rowHeight,width:contentWidth,'--color':COLORS[i],backgroundSize:`${tickStep*px}px 100%`}} onPointerDown={e=>draw(e,behavior)}>{visible.filter(s=>s.behavior===behavior).map(s=><div key={s.id} className={`label-clip ${selection===s.id?'selected':''}`} style={{left:s.start*px,width:Math.max(2,(s.end-s.start)*px)}} onPointerDown={e=>drag(e,s,'move')} role="button" tabIndex="0" aria-label={`${behavior}, frames ${s.start} through ${s.end-1}`} title={`${behavior} · frames ${s.start}–${s.end-1}`} onKeyDown={e=>{if(e.key==='Enter'){setSelection(s.id);seek(s.start);}}}><span className="trim-handle left" onPointerDown={e=>drag(e,s,'start')}/><span className="clip-name">{behavior}</span>{(s.end-s.start)*px>120&&<small>{s.end-s.start}f</small>}<span className="trim-handle right" onPointerDown={e=>drag(e,s,'end')}/></div>)}</div></React.Fragment>)}
        <div className="playhead" style={{left:152+(frame+.5)*px,height:94+rowHeight*10}}><i/></div>
      </div></div><footer className="timeline-footer"><span><i/>Click for 1s · Drag to label a range · Drag clip edges to trim</span><span>0-BASED FRAMES · AUTO-SAVE ON</span></footer>
    </section></>}
    {busy&&<div className="modal-backdrop"><div className="progress-card" role="status"><div className="spinner"/><p className="eyebrow">PREPARING YOUR WORKSPACE</p><h2>{progress||'Preparing video…'}</h2><p>The first import extracts full-resolution frames and creates a playback copy. Existing frame caches are reused.</p><button onClick={()=>api.cancel()}>Cancel preparation</button></div></div>}
    {!api&&<div className="desktop-required">Run this app with <code>npm start</code> to enable native file selection.</div>}
  </div>;
}
