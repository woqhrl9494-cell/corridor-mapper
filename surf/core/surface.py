"""New Chebyshev graph estimator, observed-only API (float64, metres/seconds).

q(s;c)=[s,y0+sum_l c_l T_l((s-x0)/h)]. Minimize mean((L-rho)^2)
+ lambda*mean(f''^2); lambda has units m^4. Zero noise uses this same SSE,
never 1/sigma^2. Fermat roots eliminate contacts; dL/dc=g_y*T at L_s=0.

One valid root per record is supported. Multiple roots, including maxima, are
retained in logs and make that fit/step unsupported; no range-nearest switching.
Finite-resolution scan plus derivative-extremum checks is numerical enumeration,
not an analytic completeness/global-optimality certificate.

N records, D coefficients, G scan cells, I iterations, H model/start choices:
O(H*I*(N*G*D + N*D^2 + D^3)); O(N*G + N*D) working memory.
"""
import numpy as np
from numpy.polynomial import chebyshev as C
import time


def chart_from_observations(pi,pj,rho):
    poses=np.concatenate([pi,pj]);lo,hi=poses[:,0].min(),poses[:,0].max()
    pad=np.linalg.norm(pi-pj,axis=1).max()/2
    return {'x0':float((lo+hi)/2),'h':float((hi-lo)/2+pad),'y0':float(np.median(poses[:,1])),
            'domain':[float(lo-pad),float(hi+pad)],'scaling':'u=(s-x0)/h; y=y0+Chebyshev(u)'}


def geom(s,c,chart,pi,pj):
    """s[N] or [N,G], pi,pj[N,2]. Return F,Ls,Lss,gy,normal,side product."""
    u=(s-chart['x0'])/chart['h'];f=chart['y0']+C.chebval(u,c)
    fp=C.chebval(u,C.chebder(c))/chart['h'];fpp=C.chebval(u,C.chebder(c,2))/chart['h']**2
    F=np.zeros_like(s);Ls=F.copy();Lss=F.copy();gy=F.copy();sides=[]
    for p in [pi,pj]:
        x=p[:,0] if s.ndim==1 else p[:,0,None];y=p[:,1] if s.ndim==1 else p[:,1,None]
        dx=s-x;dy=f-y;r=np.maximum(np.hypot(dx,dy),1e-14);v=(dx+dy*fp)/r
        F+=r;Ls+=v;Lss+=(1+fp*fp-v*v)/r+(dy/r)*fpp;gy+=dy/r;sides.append((-fp*dx+dy)/r)
    return F,Ls,Lss,gy,f,fp,np.array(sides[0]*sides[1])


def bisect_indexed(a,b,idx,c,chart,pi,pj,derivative=False):
    a=a.copy();b=b.copy();k=2 if derivative else 1
    fa=geom(a,c,chart,pi[idx],pj[idx])[k]
    for _ in range(37):
        mid=(a+b)/2;fm=geom(mid,c,chart,pi[idx],pj[idx])[k];left=fa*fm<=0
        b=np.where(left,mid,b);a=np.where(left,a,mid);fa=np.where(left,fa,fm)
    return (a+b)/2


def roots(c,chart,pi,pj,grid=64,extrema=True):
    N=len(pi);mesh=np.linspace(*chart['domain'],grid+1);s=np.broadcast_to(mesh,(N,len(mesh)))
    g=geom(s,c,chart,pi,pj);phi=g[1];ii,jj=np.where(phi[:,:-1]*phi[:,1:]<0)
    root_s=list(bisect_indexed(mesh[jj],mesh[jj+1],ii,c,chart,pi,pj)) if len(ii) else [];root_i=list(ii)
    iz,jz=np.where(np.abs(phi)<1e-11)
    root_s.extend(mesh[jz]);root_i.extend(iz)
    if extrema:
        # A repeated root or a close pair need not change sign on grid endpoints.
        ei,ej=np.where(g[2][:,:-1]*g[2][:,1:]<0)
        if len(ei):
            ex=bisect_indexed(mesh[ej],mesh[ej+1],ei,c,chart,pi,pj,True)
            ef=geom(ex,c,chart,pi[ei],pj[ei])[1];near=np.abs(ef)<1e-9
            root_s.extend(ex[near]);root_i.extend(ei[near])
            for aa,bb,ff in [(mesh[ej],ex,phi[ei,ej]),(ex,mesh[ej+1],phi[ei,ej+1])]:
                mask=(ff*ef<0)&(phi[ei,ej]*phi[ei,ej+1]>=0)&~near
                if mask.any():root_s.extend(bisect_indexed(aa[mask],bb[mask],ei[mask],c,chart,pi,pj));root_i.extend(ei[mask])
    if not root_s:
        return {'i':np.array([],int),'s':np.array([]),'counts':np.zeros(N,int),'all_counts':np.zeros(N,int),'valid':np.array([],bool),'F':np.array([]),'Ls':np.array([]),'Lss':np.array([]),'gy':np.array([]),'x':np.zeros((0,2)),'normal':np.zeros((0,2))}
    ii=np.array(root_i,int);ss=np.array(root_s);order=np.lexsort((ss,ii));ii=ii[order];ss=ss[order]
    keep=np.r_[True,(np.diff(ii)!=0)|(np.abs(np.diff(ss))>1e-7)];ii=ii[keep];ss=ss[keep]
    F,Ls,Lss,gy,f,fp,side=geom(ss,c,chart,pi[ii],pj[ii]);normal=np.column_stack([-fp,np.ones_like(fp)]);normal/=np.linalg.norm(normal,axis=1)[:,None]
    x=np.column_stack([ss,f]);focus=np.minimum(np.linalg.norm(x-pi[ii],axis=1),np.linalg.norm(x-pj[ii],axis=1))
    valid=(side>1e-10)&(focus>1e-7)&(np.abs(Ls)<1e-7)&(ss>mesh[0]+1e-8)&(ss<mesh[-1]-1e-8)
    return {'i':ii,'s':ss,'counts':np.bincount(ii[valid],minlength=N),'all_counts':np.bincount(ii,minlength=N),'valid':valid,'F':F,'Ls':Ls,'Lss':Lss,'gy':gy,'x':x,'normal':normal}


def prediction(c,chart,pi,pj,grid):
    rr=roots(c,chart,pi,pj,grid)
    if not np.all(rr['counts']==1):return None,rr
    take=rr['valid'];ss=rr['s'][take]
    if np.any(np.abs(rr['Lss'][take])<1e-7):return None,rr
    V=C.chebvander((ss-chart['x0'])/chart['h'],len(c)-1)
    return (rr['F'][take],rr['gy'][take,None]*V),rr


def curvature_matrix(degree,chart,n=65):
    """Graph second-derivative smoothing basis; not geometric curvature."""
    u=np.linspace(-1,1,n)
    return np.column_stack([C.chebval(u,C.chebder(np.eye(degree+1)[i],2))/chart['h']**2 for i in range(degree+1)])


def damped_qr_step(jac,res,mu):
    """Input A[M,D], r[M], mu>0; output delta[D], all float64.

    Same step objective: ||A delta+r||^2 + mu*sum(d*delta^2),
    d=max(diag(A.T A),1e-8). The original Gram diagonal is retained solely
    for identical damping scaling; no normal equation is solved. Positive
    damping makes the augmented matrix full column rank, so reduced QR
    needs neither rank truncation nor an additional solver hyperparameter.
    Time O(M D^2 + D^3), storage O(M D).
    """
    diagonal=np.maximum(np.diag(jac.T@jac),1e-8)
    augmented=np.vstack([jac,np.diag(np.sqrt(mu*diagonal))])
    rhs=np.r_[-res,np.zeros(jac.shape[1])]
    Q,R=np.linalg.qr(augmented,mode='reduced')
    return np.linalg.solve(R,Q.T@rhs)


def final_reflection_check(c,chart,pi,pj,grid):
    """Estimated graph only: existing reflection conditions plus ray visibility.

    Reuses the pre-existing audit's 127 open-ray samples and 1e-10 m
    clearance rule, symmetrically on either side. No measured range or truth
    is needed. O(N G D + 127 N D) time, O(N G + 127 N) storage.
    This finite sampling test is not a continuous visibility certificate.
    """
    pred,rr=prediction(c,chart,pi,pj,grid)
    if pred is None:
        return {'passed':False,'reason':'invalid_final_reflection','rays_checked':0,
                'occluded_rays':0,'rejected_measurement_indices':np.flatnonzero(rr['counts']!=1).tolist()}
    take=rr['valid'];ii=rr['i'][take];q=rr['x'][take];nn=rr['normal'][take]
    u=np.arange(1,128)/128;bad_rows=set();rays=0;occluded=0
    for endpoint in [pi,pj]:
        pp=endpoint[ii]
        xx=pp[:,0,None]+(q[:,0]-pp[:,0])[:,None]*u
        yy=pp[:,1,None]+(q[:,1]-pp[:,1])[:,None]*u
        ff=chart['y0']+C.chebval((xx-chart['x0'])/chart['h'],c)
        side=-np.sign(np.sum((q-pp)*nn,axis=1))
        clearance=(yy-ff)*side[:,None]
        bad=np.any((clearance<=1e-10)|~np.isfinite(clearance),axis=1)
        bad_rows.update(ii[bad].tolist());occluded+=int(bad.sum());rays+=len(q)
    return {'passed':not bad_rows,'reason':'visible_valid_reflection' if not bad_rows else 'estimated_surface_occlusion',
            'rays_checked':rays,'occluded_rays':occluded,'rejected_measurement_indices':sorted(bad_rows),
            'samples_per_open_ray':127,'clearance_tolerance_m':1e-10,'truth_used':False}


def fit_once(pi,pj,rho,chart,c0,lam,cfg):
    c=np.array(c0,dtype=float);D=len(c);B=curvature_matrix(D-1,chart,cfg['curvature_nodes']);mu=1e-4;history=[];start=time.perf_counter();reason='iteration_limit';counts_previous=None
    for it in range(cfg['max_iter']):
        pred,rr=prediction(c,chart,pi,pj,cfg['scan_intervals'])
        if pred is None:reason='MULTIPLE_OR_MISSING_OR_DEGENERATE_ROOT';break
        F,J=pred;r=F-rho;J=J/np.sqrt(len(r));r=r/np.sqrt(len(r));Br=np.sqrt(lam/len(B))*B
        cost=float(r@r+np.linalg.norm(Br@c)**2);jac=np.vstack([J,Br]);res=np.r_[r,Br@c];grad=jac.T@res
        row={'iteration':it,'coefficients':c.tolist(),'raw_mse_m2':float(np.mean((F-rho)**2)),'penalty_m2':float(np.linalg.norm(Br@c)**2),'damping':mu,'gradient_inf':float(np.abs(grad).max()),'root_count_changes':0,'rejected_steps':[]}
        # A fit has a unique valid branch at each accepted state. Multiple-root proposals are logged, not switched.
        counts_previous=rr['counts'].copy();history.append(row)
        if np.abs(grad).max()<1e-10:reason='gradient';break
        accepted=False
        for trial in range(12):
            try:step=damped_qr_step(jac,res,mu)
            except np.linalg.LinAlgError:reason='augmented_qr_failure';break
            proposal=c+step;pp,pr=prediction(proposal,chart,pi,pj,cfg['scan_intervals'])
            if pp is None:
                bad=np.flatnonzero(pr['counts']!=1);row['rejected_steps'].append({'trial':trial,'reason':'unsupported_stationary_branch','measurement_indices':bad.tolist(),'counts':pr['counts'][bad].tolist(),'proposed_coefficients':proposal.tolist()});mu*=10;continue
            pcost=float(np.mean((pp[0]-rho)**2)+np.linalg.norm(Br@proposal)**2)
            if pcost<cost:
                c=proposal;mu=max(mu/3,1e-12);accepted=True;row['step_norm_m']=float(np.linalg.norm(step));row['objective_after_m2']=pcost
                if np.linalg.norm(step)<1e-8:reason='step';break
                break
            row['rejected_steps'].append({'trial':trial,'reason':'objective_not_decreased','proposed_objective_m2':pcost});mu*=10
        if reason=='step':break
        if not accepted:reason='no_decreasing_valid_step';break
    pred,rr=prediction(c,chart,pi,pj,cfg['final_scan_intervals'])
    mse=float(np.mean((pred[0]-rho)**2)) if pred is not None else None
    return {'coefficients':c.tolist(),'initial_coefficients':list(c0),'lambda_m4':lam,'degree':D-1,'status':'FIT' if pred is not None else 'UNSUPPORTED_ROOTS','termination':reason,'raw_mse_m2':mse,'raw_sse_m2':None if mse is None else mse*len(rho),'penalty_m2':float(lam*np.mean((B@c)**2)),'iterations':len(history),'history':history,'seconds':time.perf_counter()-start}


def arrays(raw):
    r=raw['records'];return np.array([[x['tx']['x'],x['tx']['y']] for x in r],float),np.array([[x['rx']['x'],x['rx']['y']] for x in r],float),np.array([x['r'] for x in r],float)


def estimate(raw,cfg):
    """No scene name, seed, truth contact, wall coefficients, or test label accepted."""
    raw={**raw,'records':[r for r in raw['records'] if r['t']<=raw['cutoff_s']]}
    start=time.perf_counter();pi,pj,rho=arrays(raw);chart=chart_from_observations(pi,pj,rho)
    frames=np.array([round(r['t']/.05) for r in raw['records']]);val=((frames-1)//20)%3==1;train=~val;hypotheses=[];scores=[]
    # Held-out range values never influence the training initialization.
    height=float(np.median(np.sqrt(np.maximum(rho[train]**2-np.sum((pi[train]-pj[train])**2,axis=1),0)))/2)
    for degree in cfg['degrees']:
        for lam in cfg['lambdas']:
            model=[]
            for side in [-1,1]:
                c0=np.zeros(degree+1);c0[0]=side*height
                fit=fit_once(pi[train],pj[train],rho[train],chart,c0,lam,cfg);fit.update({'hypothesis_id':f'cv_d{degree}_l{lam}_s{side}','stage':'TRAIN_VALIDATION','side_initialization':side,'fit_record_indices':np.flatnonzero(train).tolist(),'validation_record_indices':np.flatnonzero(val).tolist()})
                pred,rr=prediction(fit['coefficients'],chart,pi[val],pj[val],cfg['final_scan_intervals'])
                fit['validation_mse_m2']=float(np.mean((pred[0]-rho[val])**2)) if pred is not None else None
                hypotheses.append(fit);model.append(fit)
            finite=[f for f in model if f['validation_mse_m2'] is not None and f['raw_mse_m2'] is not None]
            if finite:scores.append({'degree':degree,'lambda_m4':lam,'validation_mse_m2':min(f['validation_mse_m2'] for f in finite)})
    if not scores:return {'chart':chart,'hypotheses':hypotheses,'selected_ids':[],'status':'MODEL_UNSUPPORTED','reason':'all_initializations_failed','seconds':time.perf_counter()-start,'model_scores':[]}
    best=min(s['validation_mse_m2'] for s in scores);near=[s for s in scores if s['validation_mse_m2']<=best*(1+cfg['complexity_tie_relative'])+cfg['complexity_tie_absolute_m2']]
    chosen=sorted(near,key=lambda s:(s['degree'],-s['lambda_m4']))[0];final=[]
    for side in [-1,1]:
        old=next(f for f in hypotheses if f['degree']==chosen['degree'] and f['lambda_m4']==chosen['lambda_m4'] and f['side_initialization']==side)
        fit=fit_once(pi,pj,rho,chart,old['coefficients'],chosen['lambda_m4'],cfg)
        fit.update({'hypothesis_id':f'full_s{side}','stage':'FULL_REFIT','side_initialization':side,'parent_hypothesis_id':old['hypothesis_id'],'fit_record_indices':list(range(len(rho))),'validation_mse_m2':old['validation_mse_m2']});hypotheses.append(fit);final.append(fit)
    finite=[f for f in final if f['raw_sse_m2'] is not None];ids=[];reason='no_full_fit'
    if finite:
        minimum=min(f['raw_sse_m2'] for f in finite);slack=max(len(rho)*cfg['ambiguity_sse_floor_m2_per_record'],cfg['ambiguity_noise_factor']*raw['range_sigma_m']**2*np.sqrt(2*len(rho)))
        candidates=[f for f in finite if f['raw_sse_m2']<=minimum+slack]
        bound=3*raw['range_sigma_m']+cfg['noiseless_fit_rmse_limit_m'];candidates=[f for f in candidates if np.sqrt(f['raw_mse_m2'])<=bound]
        kept=[];u=np.linspace(-1,1,129)
        for f in candidates:
            if not any(np.max(np.abs(C.chebval(u,f['coefficients'])-C.chebval(u,g['coefficients'])))<cfg['hypothesis_merge_max_m'] for g in kept):kept.append(f)
        # Acceptance happens after the unchanged fit/CV/SSE rules, before UNIQUE.
        for f in kept:f['final_reflection_check']=final_reflection_check(f['coefficients'],chart,pi,pj,cfg['final_scan_intervals'])
        kept=[f for f in kept if f['final_reflection_check']['passed']]
        ids=[f['hypothesis_id'] for f in kept];reason='comparable_raw_sse' if len(ids)>1 else 'single_explanatory_fit' if ids else 'raw_model_mismatch'
    return {'chart':chart,'hypotheses':hypotheses,'selected_ids':ids,'selected_complexity':chosen,'model_scores':scores,'status':'UNIQUE' if len(ids)==1 else 'AMBIGUOUS' if ids else 'MODEL_UNSUPPORTED','reason':reason,'seconds':time.perf_counter()-start,'raw_fit_information_cutoff_s':raw['cutoff_s'],'ambiguity_rule':'minSSE + max(N*9e-8, 3*sigma^2*sqrt(2N)); empirical, not posterior probability'}
