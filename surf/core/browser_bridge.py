"""Browser IO adapter; the imported, SHA-verified frozen surface.py is unchanged.
No truth or scene geometry is accepted. Array types float64, positions m, times s.
Only progress instrumentation and serialization are added around S.estimate.
"""
import json
import numpy as np
from numpy.polynomial import chebyshev as C
import surface as S

_native_fit_once=S.fit_once
_progress_count=0

def _fit_with_progress(*args,**kwargs):
    global _progress_count
    result=_native_fit_once(*args,**kwargs)
    _progress_count+=1
    progress_callback(_progress_count,18)
    return result

S.fit_once=_fit_with_progress

def browser_estimate(raw_json,targets_json,config_json):
    global _progress_count
    _progress_count=0
    raw=json.loads(raw_json);targets=json.loads(targets_json);cfg=json.loads(config_json)
    fit=S.estimate(raw,cfg['surface'])
    pi,pj,rho=S.arrays(raw);contacts={};curves=[]
    for h in fit['hypotheses']:
        if h['hypothesis_id'] not in fit['selected_ids']:continue
        ss=np.linspace(*fit['chart']['domain'],513)
        yy=fit['chart']['y0']+C.chebval((ss-fit['chart']['x0'])/fit['chart']['h'],h['coefficients'])
        curves.append({'id':h['hypothesis_id'],'points':np.column_stack([ss,yy]).tolist()})
        if fit['status']!='UNIQUE':continue
        rr=S.roots(h['coefficients'],fit['chart'],pi,pj,cfg['surface']['final_scan_intervals'])
        for j,i in enumerate(rr['i']):
            if rr['valid'][j] and rr['counts'][i]==1:
                key=raw['records'][int(i)]['key']
                contacts[key]={'key':key,'x':rr['x'][j].tolist(),'normal':rr['normal'][j].tolist(),'predicted_range_m':float(rr['F'][j]),'residual_m':float(rho[i]-rr['F'][j])}
    predictions=[]
    run_prefix=targets[0]['target_id'].split('/target/')[0] if targets else ''
    for t in targets:
        c=contacts.get(t['key']);valid=fit['status']=='UNIQUE' and c is not None
        predictions.append({'target_id':t['target_id'],'measurement_id':t['measurement_id'],'key':t['key'],'time_s':t['time_s'],'pair':t['pair'],'method_id':'SURF','valid':valid,'status':fit['status'] if not fit['status']=='UNIQUE' or valid else 'TARGET_UNSUPPORTED','x':c['x'] if valid else None,'normal':c['normal'] if valid else None,'selected_id':run_prefix+'/'+fit['selected_ids'][0] if valid else None,'alternative_ids':[run_prefix+'/'+hid for hid in fit['selected_ids']],'available_at':12,'information_cutoff':12})
    return json.dumps({'fit':fit,'predictions':predictions,'native_contacts':list(contacts.values()),'curves':curves},allow_nan=False)
