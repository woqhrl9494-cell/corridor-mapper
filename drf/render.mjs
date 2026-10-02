import { boundsOf } from "../surf/map.mjs";

// Display affine transform only: each axis retains metres; inference never sees pixels.
export const mapToScreen=(p,c,b)=>[b.x+b.w/2+(p[0]-c.cx)*c.scaleX,b.y+b.h/2-(p[1]-c.cy)*c.scaleY];
export const mapToWorld=(p,c,b)=>[c.cx+(p[0]-b.x-b.w/2)/c.scaleX,c.cy-(p[1]-b.y-b.h/2)/c.scaleY];
export function zoomMap(c,factor,anchor,box) {
  const p=mapToWorld(anchor,c,box),scaleX=Math.max(.05,Math.min(100000,c.scaleX*factor)),scaleY=Math.max(.05,Math.min(100000,c.scaleY*factor));
  return {cx:p[0]-(anchor[0]-box.x-box.w/2)/scaleX,cy:p[1]+(anchor[1]-box.y-box.h/2)/scaleY,scaleX,scaleY};
}

function drawGrid(ctx,box,xs,ys,color) {
  ctx.save();ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.setLineDash([]);ctx.beginPath();
  for (const x of xs) if (x>box.x+1 && x<box.x+box.w-1) {ctx.moveTo(x,box.y);ctx.lineTo(x,box.y+box.h);}
  for (const y of ys) if (y>box.y+1 && y<box.y+box.h-1) {ctx.moveTo(box.x,y);ctx.lineTo(box.x+box.w,y);}
  ctx.stroke();ctx.restore();
}

function metreTicks(min,max) {
  const first=Math.ceil(min/10);
  return Array.from({length:Math.max(0,Math.floor(max/10)-first+1)},(_,i)=>(first+i)*10);
}

// White-based sequential colors affect drawing only; zero stays transparent.
const palettes = {
  Dbar: [[255,255,255],[255,225,143],[255,172,66],[239,100,29],[184,41,20]],
  betaHat: [[255,255,255],[214,233,249],[145,195,229],[61,142,196],[8,81,156]],
};
const colorAt = (t, palette) => {
  const p = Math.max(0,Math.min(1,t)) * (palette.length-1), i = Math.min(palette.length-2,Math.floor(p));
  return palette[i].map((v,k) => Math.round(v+(palette[i+1][k]-v)*(p-i)));
};
const rgb = (c) => `rgb(${c.join(",")})`;
const numberLabel = (x) => !Number.isFinite(x) ? "—" : x !== 0 && (Math.abs(x) < .001 || Math.abs(x) >= 1e4) ? x.toExponential(1) : Number(x.toPrecision(3)).toString();

/** Presentation only. Input field is iy*nx+ix with y ascending; canvas y is inverted.
 * O(nx*ny + history pairs + displayed paths) per field update; O(nx*ny) heatmap memory.
 * Simulator truth is used only by explicit evaluation overlays, never sent to field.
 */
export class DrfMap {
  constructor(canvas, onInspect) {
    this.canvas = canvas;
    this.onInspect = onInspect;
    this.state = {};
    this.auto = true;
    this.camera = null;
    this.defaultScale = null;
    this.pending = false;
    this.pointer = null;
    this.heat = document.createElement("canvas");
    this.maxValue = 0;
    const resize=new ResizeObserver(() => { if (this.auto) this.camera = null; this.draw(); });
    resize.observe(canvas);
    const dashboard=canvas.closest?.('.map-panel')?.parentElement;
    if (dashboard) resize.observe(dashboard);
    new MutationObserver(() => this.draw()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.draw());
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      // At the limiting axis, another zoom-out restores the view; simulation state is untouched.
      const atFloor=this.camera && this.defaultScale && Math.max(this.defaultScale.scaleX/this.camera.scaleX,this.defaultScale.scaleY/this.camera.scaleY)>=1-1e-12;
      if (e.deltaY>0 && atFloor) this.fit();
      else this.zoom(Math.exp(-e.deltaY*.001),[e.offsetX,e.offsetY]);
    }, { passive:false });
    canvas.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; canvas.setPointerCapture(e.pointerId); this.pointer = [e.clientX,e.clientY]; });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.camera || !this.box) return;
      if (this.pointer) {
        this.camera.cx -= (e.clientX-this.pointer[0])/this.camera.scaleX;
        this.camera.cy += (e.clientY-this.pointer[1])/this.camera.scaleY;
        this.pointer = [e.clientX,e.clientY]; this.auto = false; this.draw();
      }
      const [x,y] = mapToWorld([e.offsetX,e.offsetY],this.camera,this.box), g=this.state.grid;
      if (!g) return;
      const d=g.domain ?? [g.xmin,g.xmax,g.ymin,g.ymax], dx=(d[1]-d[0])/g.nx, dy=(d[3]-d[2])/g.ny;
      const ix=Math.floor((x-d[0])/dx), iy=Math.floor((y-d[2])/dy);
      this.onInspect?.({ x,y,index:ix>=0 && ix<g.nx && iy>=0 && iy<g.ny ? iy*g.nx+ix : -1 });
    });
    for (const name of ["pointerup","pointercancel","lostpointercapture"]) canvas.addEventListener(name,() => { this.pointer=null; });
  }
  set(state) {
    if (state.mode==='geometry') state={...state,aspectMode:'equal'};
    const previous=this.state;
    this.state=state;
    if (state.aspectMode !== previous.aspectMode) {this.auto=true;this.camera=null;}
    if (this.auto && (state.grid !== previous.grid || state.walls !== previous.walls || state.layers?.showTruth !== previous.layers?.showTruth || (state.focus && !this.fullDomain && state.frame !== previous.frame)
      || (state.mode==='geometry' && (state.frame !== previous.frame || state.wire !== previous.wire || state.layers?.showVehicles !== previous.layers?.showVehicles)))) this.camera=null;
    if (state.frame !== previous.frame || state.grid !== previous.grid || state.heatField !== previous.heatField || state.scaleMode !== previous.scaleMode) this.buildHeat();
    this.draw();
  }
  buildHeat() {
    const {grid:g,frame,heatField="Dbar",scaleMode="linear"}=this.state;
    if (!g) {this.heat.width=1;this.heat.height=1;this.maxValue=0;return;}
    this.heat.width=g.nx; this.heat.height=g.ny;
    const values=frame?.[heatField], ctx=this.heat.getContext("2d"), data=ctx.createImageData(g.nx,g.ny);
    this.maxValue=0;
    if (values) for (const v of values) if (Number.isFinite(v) && v>this.maxValue) this.maxValue=v;
    const denominator=scaleMode === "log" ? Math.log1p(this.maxValue) : this.maxValue, palette=palettes[heatField] ?? palettes.Dbar;
    // Formula: image row = ny-1-iy. World y is never reordered in inference data.
    for (let iy=0;iy<g.ny;iy++) for (let ix=0;ix<g.nx;ix++) {
      const value=Math.max(0,values?.[iy*g.nx+ix] ?? 0), t=denominator>0 ? (scaleMode === "log" ? Math.log1p(value) : value)/denominator : 0;
      const at=4*((g.ny-1-iy)*g.nx+ix);
      data.data.set([...colorAt(t,palette),values && Number.isFinite(value) && value>0 ? 255 : 0],at);
    }
    ctx.putImageData(data,0,0);
  }
  fit(fullDomain=false) { this.fullDomain=fullDomain;this.auto=true;this.camera=null;this.draw(); }
  zoom(factor,anchor) {
    if (!this.camera || !this.box || !this.defaultScale) return;
    factor=Math.max(factor,this.defaultScale.scaleX/this.camera.scaleX,this.defaultScale.scaleY/this.camera.scaleY);
    if (factor===1) return;
    this.camera=zoomMap(this.camera,factor,anchor ?? [this.box.x+this.box.w/2,this.box.y+this.box.h/2],this.box);
    this.auto=false; this.draw();
  }
  draw() {
    if (this.pending) return;
    this.pending=true;
    requestAnimationFrame(() => { this.pending=false; this.paint(this.canvas,window.devicePixelRatio || 1); });
  }
  paint(target,ratio) {
    const width=this.canvas.clientWidth,height=this.canvas.clientHeight;
    if (width<1 || height<1) return;
    target.width=Math.round(width*ratio); target.height=Math.round(height*ratio);
    const ctx=target.getContext("2d"), css=getComputedStyle(document.documentElement), token=(name) => css.getPropertyValue(`--color-${name}`).trim();
    const ink=token("ink"),muted=token("ink-muted"),line=token("line"),accent=token("accent"),evalColor=token("eval"),background=token("plot-bg");
    ctx.scale(ratio,ratio); ctx.fillStyle=background; ctx.fillRect(0,0,width,height);
    ctx.font="14px -apple-system, Arial, sans-serif";
    const geometry=this.state.mode === "geometry",box={ x:44,y:16,w:Math.max(1,width-(geometry ? 60 : 108)),h:Math.max(1,height-62) }, g=this.state.grid;
    const domain=g?.domain ?? (g ? [g.xmin,g.xmax,g.ymin,g.ymax] : [0,60,0,30]);
    let bounds={xmin:domain[0],xmax:domain[1],ymin:domain[2],ymax:domain[3]};
    if (this.state.focus && !this.fullDomain) {
        // Drawing-only 24 m window follows current noisy poses, never future wire or truth.
        const poses=(this.state.wire?.configs ?? []).flatMap(c=>[c.pHat_i,c.pHat_j]),n=poses.length;
        const cx=Math.max(domain[0]+12,Math.min(domain[1]-12,n ? poses.reduce((s,p)=>s+p[0],0)/n : (domain[0]+domain[1])/2));
        const cy=Math.max(domain[2]+12,Math.min(domain[3]-12,n ? poses.reduce((s,p)=>s+p[1],0)/n : (domain[2]+domain[3])/2));
        bounds={xmin:cx-12,xmax:cx+12,ymin:cy-12,ymax:cy+12};
    } else if (!this.fullDomain && this.state.layers?.showTruth && this.state.walls?.flat().length) bounds=boundsOf(this.state.walls.flat());
    // RAW includes only poses measured through the selected snapshot, including the open exit.
    // The inference grid and the lower field maps retain their fixed [0,60] x [0,30] m domain.
    if (geometry && this.state.layers?.showVehicles) {
      const snapshots=[...(this.state.history ?? []).filter(s=>s.t<=(this.state.frame?.t ?? 0)),this.state.wire];
      for (const snapshot of snapshots) for (const c of snapshot?.configs ?? []) for (const p of [c.pHat_i,c.pHat_j]) {
        if (snapshot.t>(this.state.frame?.t ?? 0) || p?.length!==2 || !p.every(Number.isFinite)) continue;
        bounds={xmin:Math.min(bounds.xmin,p[0]),xmax:Math.max(bounds.xmax,p[0]),ymin:Math.min(bounds.ymin,p[1]),ymax:Math.max(bounds.ymax,p[1])};
      }
    }
    const panel=this.canvas.closest?.('.map-panel');
    // CSS owns the full card size; fit metres inside it without shrinking the frame.
    // CSS pixels/metre: every viewport and visible-range change updates the zoom floor.
    let scaleX=box.w/(Math.max(1,bounds.xmax-bounds.xmin)*1.04),scaleY=box.h/(Math.max(1,bounds.ymax-bounds.ymin)*1.04);
    if (this.state.aspectMode==='equal') scaleX=scaleY=Math.min(scaleX,scaleY);
    this.defaultScale={scaleX,scaleY};
    if (!this.camera) {
      this.camera={cx:(bounds.xmin+bounds.xmax)/2,cy:(bounds.ymin+bounds.ymax)/2,scaleX,scaleY};
    } else {
      const factor=Math.max(1,scaleX/this.camera.scaleX,scaleY/this.camera.scaleY);
      if (factor>1) this.camera=zoomMap(this.camera,factor,[box.x+box.w/2,box.y+box.h/2],box);
    }
    const c=this.camera,screen=(p) => mapToScreen(p,c,box),lo=mapToWorld([box.x,box.y+box.h],c,box),hi=mapToWorld([box.x+box.w,box.y],c,box);
    // Fixed world grid: zoom changes its pixel spacing, never its 10 m interval.
    const xs=metreTicks(lo[0],hi[0]),ys=metreTicks(lo[1],hi[1]);
    if (target===this.canvas) {
      this.box=box;
      this.canvas.dataset.view=JSON.stringify({xmin:lo[0],xmax:hi[0],ymin:lo[1],ymax:hi[1],pixelsPerMetreX:c.scaleX,pixelsPerMetreY:c.scaleY,aspectMode:this.state.aspectMode ?? 'fill',plotWidth:box.w,plotHeight:box.h,auto:this.auto});
    }
    ctx.save();ctx.beginPath();ctx.rect(box.x,box.y,box.w,box.h);ctx.clip();
    if (g && this.state.frame && !geometry) {
      const p=screen([domain[0],domain[3]]),q=screen([domain[1],domain[2]]);
      ctx.imageSmoothingEnabled=false; ctx.drawImage(this.heat,p[0],p[1],q[0]-p[0],q[1]-p[1]);
    }
    drawGrid(ctx,box,xs.map(x=>screen([x,0])[0]),ys.map(y=>screen([0,y])[1]),token('grid'));
    const path=(points,color,width=2,dash=[]) => {
      if (!points?.length) return;
      ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);
      points.forEach((p,i) => { const [x,y]=screen(p); i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y); });ctx.stroke();ctx.setLineDash([]);
    };
    const dot=(p,color,r=4,open=false) => { if (!p) return; const point=screen(p),[x,y]=point;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=2;open ? ctx.stroke() : ctx.fill();return point; };
    const {layers={},wire,truth,walls=[],proxy=[],observed=[],history=[]}=this.state;
    if (layers.showObserved) for (const p of observed) dot(p,evalColor,5,true);
    if (layers.showTruth) for (const wall of walls) path(wall,ink,2.5,[8,6]);
    if (layers.showProxy) for (const p of proxy) dot(p,accent,4,true);
    // Drawing budget only: the estimator still receives every measured path.
    const ellipseTotal=(wire?.configs ?? []).reduce((sum,config)=>sum+(config.paths?.length ?? 0),0),ellipseStride=Math.max(1,Math.ceil(ellipseTotal/600));
    let ellipseIndex=0,ellipseShown=0;
    ctx.globalAlpha=.16;
    if (layers.showEllipses) for (const config of wire?.configs ?? []) {
      const a=config.pHat_i,b=config.pHat_j,dx=b[0]-a[0],dy=b[1]-a[1],distance=Math.hypot(dx,dy),angle=Math.atan2(dy,dx),cos=Math.cos(angle),sin=Math.sin(angle);
      for (const q of config.paths) {
        if (ellipseIndex++%ellipseStride!==0 || !(q.dHat>distance)) continue;
        const major=q.dHat/2,minor=Math.sqrt(major*major-distance*distance/4),points=[];
        for (let k=0;k<=96;k++) { const t=k*2*Math.PI/96,x=major*Math.cos(t),y=minor*Math.sin(t);points.push([(a[0]+b[0])/2+x*cos-y*sin,(a[1]+b[1])/2+x*sin+y*cos]); }
        path(points,accent,1.5);ellipseShown++;
      }
    }
    if (target===this.canvas && geometry) {
      this.canvas.dataset.ellipseTotal=String(ellipseTotal);this.canvas.dataset.ellipseShown=String(ellipseShown);
      const stats=panel?.querySelector?.('#ellipseStats');
      if (stats) stats.textContent=layers.showEllipses ? `타원 표시 ${ellipseShown}개 · 측정 ${ellipseTotal}개` : '타원 숨김';
    }
    ctx.globalAlpha=1;
    if (layers.showSpecular || layers.showDiffuse) for (const config of truth?.configs ?? []) {
      if (layers.showSpecular) for (const q of config.specular ?? []) dot(q.s,evalColor,5,true);
      if (layers.showDiffuse) for (const q of config.diffuse ?? []) dot(q.s,evalColor,2.5);
    }
    if (layers.showVehicles) {
      const tracks=new Map();
      for (const snapshot of history.filter(s => s.t <= (this.state.frame?.t ?? 0))) for (const config of snapshot.configs ?? []) for (const [id,p] of [[config.i,config.pHat_i],[config.j,config.pHat_j]]) {
        if (!tracks.has(id)) tracks.set(id,[]);
        const track=tracks.get(id); if (track.at(-1)?.t !== snapshot.t) track.push({t:snapshot.t,p});
      }
      const current=new Map();
      for (const config of wire?.configs ?? []) { current.set(config.i,config.pHat_i);current.set(config.j,config.pHat_j); }
      for (const track of tracks.values()) path(track.map((q) => q.p),accent,2);
      const labels=[],positions=[...current].map(([id,p])=>[id,dot(p,accent,5)]);
      for (const [id,[x,y]] of positions) {
        const text=`V${id}`,tw=ctx.measureText(text).width;
        const candidates=[[x,y-13],[x,y+25],[x-tw/2-14,y+6],[x+tw/2+14,y+6]];
        for (let offset=37;offset<=box.h;offset+=24) candidates.push([x,y-offset],[x,y+offset+12]);
        const position=candidates.find(([lx,ly])=> {
          const left=lx-tw/2-4,right=lx+tw/2+4,top=ly-18,bottom=ly+6;
          return left>=box.x+2 && right<=box.x+box.w-2 && top>=box.y+2 && bottom<=box.y+box.h-2
            && !labels.some(a=>left<a.right && right>a.left && top<a.bottom && bottom>a.top)
            && !positions.some(([, [vx,vy]])=>left<vx+7 && right>vx-7 && top<vy+7 && bottom>vy-7);
        });
        // Keep every vehicle dot/track; omit only a number that has no room in the plot.
        if (!position) continue;
        const [lx,ly]=position;
        labels.push({left:lx-tw/2-4,right:lx+tw/2+4,top:ly-18,bottom:ly+6});
        if (lx!==x || ly!==y-13) { ctx.beginPath();ctx.strokeStyle=accent;ctx.lineWidth=1.5;ctx.moveTo(x,y);ctx.lineTo(lx,ly-6);ctx.stroke(); }
        ctx.fillStyle=background;ctx.fillRect(lx-tw/2-4,ly-18,tw+8,24);
        ctx.textAlign="center";ctx.fillStyle=ink;ctx.fillText(text,lx,ly);
      }
    }
    ctx.restore();
    ctx.font="14px -apple-system, Arial, sans-serif";ctx.fillStyle=muted;ctx.strokeStyle=line;ctx.lineWidth=1.5;
    ctx.strokeRect(box.x,box.y,box.w,box.h);
    // Sparse labels at extreme zoom-out avoid overlaps; grid lines stay at 10 m.
    const labelStepX=Math.max(1,Math.ceil(48/(c.scaleX*10))),labelStepY=Math.max(1,Math.ceil(24/(c.scaleY*10)));
    for (const x of xs) if ((x/10)%labelStepX===0) { const sx=screen([x,0])[0];ctx.textAlign="center";ctx.fillText(String(x),sx,box.y+box.h+19); }
    for (const y of ys) if ((y/10)%labelStepY===0) { const sy=screen([0,y])[1];ctx.textAlign="right";ctx.fillText(String(y),box.x-10,sy+6); }
    ctx.textAlign="center";ctx.fillText("x [m]",box.x+box.w/2,height-8);ctx.save();ctx.translate(14,box.y+box.h/2);ctx.rotate(-Math.PI/2);ctx.fillText("y [m]",0,0);ctx.restore();
    if (geometry) {
      if (!this.state.frame) { ctx.fillStyle=muted;ctx.textAlign="center";ctx.fillText(layers.showTruth ? "참 장면 미리보기 · 평가 전용" : "실행하면 현재 측정과 차량 궤적을 표시합니다.",box.x+box.w/2,box.y+box.h/2); }
      return;
    }
    const palette=palettes[this.state.heatField ?? "Dbar"],barX=width-43,barY=box.y+27,barH=Math.max(1,box.h-54),gradient=ctx.createLinearGradient(0,barY+barH,0,barY);
    palette.forEach((value,i) => gradient.addColorStop(i/(palette.length-1),rgb(value)));
    ctx.fillStyle=gradient;ctx.fillRect(barX,barY,14,barH);ctx.strokeStyle=line;ctx.strokeRect(barX,barY,14,barH);ctx.fillStyle=muted;ctx.textAlign="center";
    ctx.fillText(numberLabel(this.maxValue),barX+7,barY-8);ctx.fillText("0",barX+7,barY+barH+19);
    if (!this.state.frame) { ctx.fillStyle=muted;ctx.textAlign="center";ctx.fillText("아직 누적 필드가 없습니다.",box.x+box.w/2,box.y+box.h/2); }
  }
  async png() {
    const plot=document.createElement("canvas"),out=document.createElement("canvas"),ratio=300/96;
    this.paint(plot,ratio);out.width=plot.width;out.height=plot.height+Math.round(86*ratio);
    const ctx=out.getContext("2d"),css=getComputedStyle(document.documentElement);
    ctx.fillStyle=css.getPropertyValue('--color-plot-bg').trim();ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(plot,0,86*ratio);ctx.scale(ratio,ratio);
    ctx.fillStyle=css.getPropertyValue('--color-ink').trim();ctx.font='600 14px -apple-system, Arial';
    ctx.fillText(this.state.heatField==='betaHat' ? 'β̂ [dimensionless]' : 'D̄ [1/m²]',12,18);
    ctx.font='14px -apple-system, Arial';ctx.fillText(`snapshot ${this.state.frame?.t ?? 0} · ${this.state.scaleMode==='log' ? 'log(1 + value)' : 'linear'} color scale`,12,38);
    ctx.fillText('Dashed wall: evaluation only',12,58);
    ctx.fillText(this.state.aspectMode==='equal' ? 'Axes: equal metres' : 'Axes: independent x/y scale',12,78);
    return new Promise((resolve,reject) => out.toBlob((blob) => blob ? resolve(blob) : reject(Error("PNG 렌더에 실패했습니다.")),"image/png"));
  }
}

// Chart coordinates and typography use CSS pixels; device pixels are export/display only.
function chartSurface(canvas) {
  const width=canvas.clientWidth,height=canvas.clientHeight;
  if (width<1 || height<1) return null;
  const ratio=window.devicePixelRatio || 1;
  canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
  const ctx=canvas.getContext("2d"),css=getComputedStyle(document.documentElement),color=(name) => css.getPropertyValue(`--color-${name}`).trim();
  ctx.scale(ratio,ratio);ctx.fillStyle=color("plot-bg");ctx.fillRect(0,0,width,height);
  return {ctx,width,height,color};
}
function chartAxes(surface,{title,xLabel,yLabel,xmin,xmax,ymin,ymax,top=0,height=surface.height,compact=false,metreX=false}) {
  compact ||= height<420;
  const {ctx,width,color}=surface,box={x:compact ? 44 : 52,y:top+(compact ? 24 : 32),w:Math.max(1,width-(compact ? 58 : 68)),h:Math.max(1,height-(compact ? 58 : 76))};
  if (!(xmax>xmin)) xmax=xmin+1;
  if (!(ymax>ymin)) ymax=ymin+1;
  const x=(v) => box.x+(v-xmin)/(xmax-xmin)*box.w,y=(v) => box.y+box.h-(v-ymin)/(ymax-ymin)*box.h;
  const xs=metreX ? metreTicks(xmin,xmax) : Array.from({length:5},(_,i)=>xmin+(xmax-xmin)*i/4);
  drawGrid(ctx,box,xs.map(x),Array.from({length:5},(_,i)=>box.y+box.h*i/4),color('grid'));
  ctx.fillStyle=color("ink");ctx.font=`600 ${compact ? 16 : 18}px -apple-system, Arial`;ctx.textAlign="left";ctx.fillText(title,8,top+(compact ? 18 : 23));
  ctx.strokeStyle=color("line");ctx.lineWidth=1.5;ctx.strokeRect(box.x,box.y,box.w,box.h);
  ctx.font=`${compact ? 14 : 16}px -apple-system, Arial`;ctx.fillStyle=color("ink-muted");
  for (const xx of metreX ? xs : [xmin,(xmin+xmax)/2,xmax]) {
    ctx.textAlign="center";ctx.fillText(numberLabel(xx),x(xx),box.y+box.h+(compact ? 17 : 23));
  }
  for (let i=0;i<=2;i++) {
    const yy=ymin+(ymax-ymin)*i/2;
    ctx.textAlign="right";ctx.fillText(numberLabel(yy),box.x-9,y(yy)+5);
  }
  ctx.textAlign="center";ctx.fillText(xLabel,box.x+box.w/2,top+height-(compact ? 3 : 10));
  if (!compact) { ctx.save();ctx.translate(18,box.y+box.h/2);ctx.rotate(-Math.PI/2);ctx.fillText(yLabel,0,0);ctx.restore(); }
  return {box,x,y};
}
function chartLine(surface,axes,points,color,dash=[],errorBars=false,dots=false) {
  const {ctx}=surface,{x,y,box}=axes;
  ctx.save();ctx.beginPath();ctx.rect(box.x,box.y,box.w,box.h);ctx.clip();
  ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;ctx.setLineDash(dash);
  ctx.beginPath();let first=true;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { first=true;continue; }
    first ? ctx.moveTo(x(p.x),y(p.y)) : ctx.lineTo(x(p.x),y(p.y));first=false;
  }
  if (!dots) ctx.stroke();ctx.setLineDash([]);
  for (const p of points) if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
    if (errorBars && Number.isFinite(p.sd)) {
      const xx=x(p.x),lo=y(p.y-p.sd),hi=y(p.y+p.sd);ctx.beginPath();ctx.moveTo(xx,lo);ctx.lineTo(xx,hi);ctx.moveTo(xx-5,lo);ctx.lineTo(xx+5,lo);ctx.moveTo(xx-5,hi);ctx.lineTo(xx+5,hi);ctx.stroke();
    }
    if (dots || errorBars) { ctx.beginPath();ctx.arc(x(p.x),y(p.y),3.5,0,Math.PI*2);ctx.fill(); }
  }
  ctx.restore();
}
function extent(points,includeZero=true) {
  const values=points.flatMap(p => Number.isFinite(p.y) ? [p.y-(p.sd ?? 0),p.y+(p.sd ?? 0)] : []);
  let min=values.length ? values.reduce((a,b)=>Math.min(a,b),Infinity) : 0,max=values.length ? values.reduce((a,b)=>Math.max(a,b),-Infinity) : 1;
  if (includeZero) min=Math.min(0,min);
  const padding=(max-min || 1)*.12;
  return [min<0 ? min-padding : 0,max+padding];
}
export function drawMetricHistory(canvas,evaluations,selection='all') {
  const surface=chartSurface(canvas);if (!surface) return;
  const metrics=[["offset","Signed offset [m]","m"],["p95","P95 |오차| [m]","m"],["offwall","off-wall [%]","%"]].filter(([key])=>selection==='all' || key===selection);
  metrics.forEach(([key,title,unit],k) => {
    const points=evaluations.map(e => ({x:e.t,y:e[key]==null ? NaN : e[key]*(key==="offwall" ? 100 : 1)})),[ymin,ymax]=extent(points);
    const axes=chartAxes(surface,{title,xLabel:"snapshot",yLabel:unit,xmin:0,xmax:Math.max(1,evaluations.at(-1)?.t ?? 60),ymin,ymax,top:k*surface.height/metrics.length,height:surface.height/metrics.length,compact:surface.height<420});
    chartLine(surface,axes,points,surface.color("eval"));
  });
}
export function drawSweep(canvas,aggregates,reference=[]) {
  const surface=chartSurface(canvas);if (!surface) return;
  const colors=["#0072b2","#d55e00","#009e73","#cc79a7"],roughness=[...new Set(aggregates.map(a => a.roughness))].sort((a,b) => a-b);
  const all=aggregates.map(a => ({x:a.sigmaD,y:a.medianError.mean,sd:a.medianError.sd})),[ymin,ymax]=extent([...all,...reference.map(a=>({y:a.medianError}))]);
  const xmin=Math.min(.05,...aggregates.map(a=>a.sigmaD)),xmax=Math.max(.3,...aggregates.map(a=>a.sigmaD));
  const axes=chartAxes(surface,{title:aggregates.some(a => a.medianError.failed) ? `실패 ${aggregates.filter(a => a.medianError.failed).length}조건 · 표 참조` : "중앙 |오차| · 평균 ± 1 sd",xLabel:"σ_d [m]",yLabel:"m",xmin,xmax,ymin,ymax,top:36,height:surface.height-36});
  roughness.forEach((r,k) => {
    const color=colors[k%colors.length],points=aggregates.filter(a=>a.roughness===r).sort((a,b)=>a.sigmaD-b.sigmaD).map(a=>({x:a.sigmaD,y:a.medianError.mean,sd:a.medianError.sd}));
    chartLine(surface,axes,points,color,[],true);
    chartLine(surface,axes,reference.filter(a=>a.roughness===r).map(a=>({x:a.sigmaD,y:a.medianError})),color,[5,5]);
    const {ctx}=surface;ctx.font="16px -apple-system, Arial";ctx.textAlign="left";ctx.fillStyle=color;ctx.fillText(`σ ${r}°`,12+k*Math.min(100,(surface.width-24)/Math.max(1,roughness.length)),23);
  });
}
export function drawHistogram(canvas,ratios) {
  const surface=chartSurface(canvas);if (!surface) return;
  const finite=ratios.filter(Number.isFinite),xmin=finite.reduce((a,b)=>Math.min(a,b),0),xmax=finite.reduce((a,b)=>Math.max(a,b),4),bins=30,step=(xmax-xmin)/bins,counts=Array(bins).fill(0);
  for (const v of finite) counts[Math.min(bins-1,Math.floor((v-xmin)/step))]++;
  const density=counts.map((n,k) => ({x:xmin+(k+.5)*step,y:finite.length ? n/(finite.length*step) : 0}));
  const theoretical=Array.from({length:160},(_,k) => {const x=Math.max(.02,xmin+(xmax-xmin)*(k+.5)/160);return{x,y:Math.exp(-x/2)/Math.sqrt(2*Math.PI*x)};});
  const [,ymax]=extent([...density,...theoretical]);
  const axes=chartAxes(surface,{title:"비율 밀도 · 점선 χ²₁",xLabel:"(ρ − ρ*) / ϛ",yLabel:"density",xmin,xmax,ymin:0,ymax});
  const {ctx}=surface;ctx.save();ctx.beginPath();ctx.rect(axes.box.x,axes.box.y,axes.box.w,axes.box.h);ctx.clip();ctx.fillStyle=surface.color("eval");
  for (const p of density) ctx.fillRect(axes.x(p.x-step*.45),axes.y(p.y),(axes.x(xmin+step)-axes.x(xmin))*.9,axes.y(0)-axes.y(p.y));
  ctx.restore();chartLine(surface,axes,theoretical,surface.color("ink"),[6,5]);
}
export function drawProfile(canvas,cells) {
  const surface=chartSurface(canvas);if (!surface) return;
  const fields=[["delta","δ [deg]","deg",180/Math.PI],["w","w(s) · 무차원","w",1],["lambda","Λ(s) · 셀 기대 개수","count",1]];
  fields.forEach(([key,title,unit,multiplier],k) => {
    const all=cells.map(c=>({x:c.s[0],y:c[key]*multiplier})),[ymin,ymax]=extent(all),axes=chartAxes(surface,{title,xLabel:"x [m] · 아래 실선 / 위 점선",yLabel:unit,xmin:0,xmax:60,ymin,ymax,top:k*surface.height/3,height:surface.height/3,metreX:true});
    for (const wall of [0,1]) chartLine(surface,axes,cells.filter(c=>c.wall===wall).map(c=>({x:c.s[0],y:c[key]*multiplier})),surface.color("eval"),wall ? [6,4] : []);
  });
}
export function drawCounts(canvas,counts,predicted) {
  const surface=chartSurface(canvas);if (!surface) return;
  const points=counts.map((n,k)=>({x:predicted[k],y:n})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)),maximum=Math.max(1,...points.flatMap(p=>[p.x,p.y]))*1.1;
  const axes=chartAxes(surface,{title:"diffuse 개수 · 점선 y = x",xLabel:"국소 근사 예측 개수",yLabel:"실제 개수",xmin:0,xmax:maximum,ymin:0,ymax:maximum});
  chartLine(surface,axes,[{x:0,y:0},{x:maximum,y:maximum}],surface.color("ink"),[5,5]);
  chartLine(surface,axes,points,surface.color("eval"),[],false,true);
}
