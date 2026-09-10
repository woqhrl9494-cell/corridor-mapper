"""Package ONE existing development run for the initial view; does not fit/tune.
Usage: OPENBLAS_NUM_THREADS=1 python3 scripts/build-preview.py path/to/readiness
"""
import sys,json,gzip,pathlib
import numpy as np
from numpy.polynomial import chebyshev as C
root=pathlib.Path(__file__).resolve().parents[1];b=pathlib.Path(sys.argv[1]).resolve()
sys.path.insert(0,str(root/'surf/core'));import surface as S
rid='arc_5_0_3311001'
def read(p):return json.load(gzip.open(p,'rt'))
raw=read(b/'raw'/f'{rid}.json.gz');ev=read(b/'evaluation_only'/f'{rid}.json.gz')
print([str(p.name) for p in (b/'targets').glob(rid+'*')])
target_path=next((b/'targets').glob(rid+'*'))
with target_path.open() as f:targets=[json.loads(line) for line in f]
fit=read(b/'runs'/f'{rid}.surface.json.gz');local=read(b/'runs'/f'{rid}.local.json.gz')
with gzip.open(b/'predictions.jsonl.gz','rt') as f:preds=[p for line in f if (p:=json.loads(line))['run_id']==rid and p['method_id'] in ['SURF','CROSS_E0']]
curves=[];contacts=[];pi,pj,rho=S.arrays(raw)
for h in fit['hypotheses']:
 if h['hypothesis_id'] not in fit['selected_ids']:continue
 ss=np.linspace(*fit['chart']['domain'],513);yy=fit['chart']['y0']+C.chebval((ss-fit['chart']['x0'])/fit['chart']['h'],h['coefficients'])
 curves.append({'id':h['hypothesis_id'],'points':np.column_stack([ss,yy]).tolist()})
 if fit['status']!='UNIQUE':continue
 rr=S.roots(h['coefficients'],fit['chart'],pi,pj,256)
 for j,i in enumerate(rr['i']):
  if rr['valid'][j] and rr['counts'][i]==1:contacts.append({'key':raw['records'][int(i)]['key'],'x':rr['x'][j].tolist(),'normal':rr['normal'][j].tolist(),'predicted_range_m':float(rr['F'][j]),'residual_m':float(rho[i]-rr['F'][j])})
# The benchmark file is a flat evaluation export; remove evaluation additions.
allowed=['target_id','measurement_id','key','time_s','pair','method_id','valid','status','x','normal','selected_id','alternative_ids','available_at','information_cutoff']
rows=[]
for p in preds:
 q={k:p[k] for k in allowed if k in p};q['key']=p['measurement_id'].split('/range/')[1];rows.append(q)
manifest=json.loads((root/'surf/core/manifest.json').read_text())
out={'scene':{'config':{**ev['config'],'mode':'arc'},'raw':raw,'targets':targets,'evaluation':ev},'result':{'fit':fit,'predictions':[p for p in rows if p['method_id']=='SURF'],'curves':curves,'native_contacts':contacts,'cross':{'predictions':[p for p in rows if p['method_id']=='CROSS_E0'],'candidates':local['candidates'],'seconds':local['timing']['C_E0']+local['timing']['CROSS']},'provenance':{'kind':'saved_development_example','run_id':rid,'frozen_source_sha256':manifest['frozen_source_sha256'],'surface_sha256':manifest['files']['surf/core/surface.py'],'runtime':'Saved B0–B3 native development result, not a browser execution'}}}
(root/'surf/reference/preview.json.gz').write_bytes(gzip.compress(json.dumps(out,separators=(',',':'),allow_nan=False).encode(),mtime=0));print('Saved',rid)
