import React, { useRef, useState } from 'react';

export function readPanelSize(key, fallback, min, max) {
  try { const raw=localStorage.getItem(key); const value=raw===null?NaN:Number(raw); return Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback; }
  catch { return fallback; }
}

export function PanelDivider({ axis, value, onChange, label, min, max, defaultValue }) {
  const drag=useRef(null), [dragging,setDragging]=useState(false);
  const clamp=n=>Math.round(Math.max(min,Math.min(max,n))*10)/10;
  const finish=()=>{drag.current=null;setDragging(false);};
  return <div className={`panel-divider divider-${axis}`} role="separator" tabIndex={0}
    aria-label={label} aria-orientation={axis==='x'?'vertical':'horizontal'}
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)} aria-valuetext={`${Math.round(value)}%`}
    title={`${label} · 드래그 또는 방향키 · 두 번 누르면 기본 비율`} data-dragging={dragging}
    onPointerDown={event=>{
      if(event.button!==0)return;
      event.preventDefault();event.currentTarget.focus();
      const rect=event.currentTarget.parentElement.getBoundingClientRect();
      drag.current={id:event.pointerId,position:axis==='x'?event.clientX:event.clientY,value:axis==='y'?event.currentTarget.nextElementSibling.getBoundingClientRect().height/rect.height*100:value,size:axis==='x'?rect.width-12:rect.height};
      event.currentTarget.setPointerCapture(event.pointerId);setDragging(true);
    }}
    onPointerMove={event=>{
      const start=drag.current;if(!start||event.pointerId!==start.id)return;
      const distance=(axis==='x'?event.clientX:event.clientY)-start.position;
      onChange(clamp(start.value+(axis==='x'?1:-1)*distance/Math.max(1,start.size)*100));
    }}
    onPointerUp={event=>{if(drag.current?.id!==event.pointerId)return;finish();if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
    onPointerCancel={finish} onLostPointerCapture={finish}
    onDoubleClick={()=>onChange(defaultValue)}
    onKeyDown={event=>{
      const keys=axis==='x'?{ArrowLeft:-2,ArrowRight:2}:{ArrowUp:2,ArrowDown:-2};
      if(event.key==='Home'){event.preventDefault();onChange(min);}
      else if(event.key==='End'){event.preventDefault();onChange(max);}
      else if(keys[event.key]){event.preventDefault();onChange(clamp(value+keys[event.key]*(event.shiftKey?5:1)));}
    }}><span aria-hidden="true"/></div>;
}
