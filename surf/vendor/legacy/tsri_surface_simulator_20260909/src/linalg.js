/* Float64 small-matrix utilities. QR solves, never normal-equation inverse.
 * Factorization O(m p²), solve O(m p+p²); intended p <= 12.
 */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.MomentLA=api;})(globalThis,()=>{
'use strict';
const zeros=(n,m)=>Array.from({length:n},()=>Array(m).fill(0));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>Math.hypot(...a);
const tr=A=>A[0].map((_,j)=>A.map(r=>r[j]));
const mm=(A,B)=>{const cols=tr(B);return A.map(r=>cols.map(c=>dot(r,c)));};
const mv=(A,v)=>A.map(r=>dot(r,v));
function qr(A,tol=1e-12){
  const n=A[0].length,V=tr(A).map(r=>r.slice()),Q=[],R=zeros(n,n),perm=Array.from({length:n},(_,i)=>i);let rank=0;
  const scale=Math.max(...V.map(norm),1e-300);
  for(let j=0;j<n;j++){
    let k=j;for(let l=j+1;l<n;l++)if(norm(V[l])>norm(V[k]))k=l;
    [V[j],V[k]]=[V[k],V[j]];[perm[j],perm[k]]=[perm[k],perm[j]];
    for(let i=0;i<j;i++)[R[i][j],R[i][k]]=[R[i][k],R[i][j]];
    R[j][j]=norm(V[j]);if(R[j][j]<=tol*scale)break;
    Q[j]=V[j].map(v=>v/R[j][j]);rank++;
    for(let l=j+1;l<n;l++)for(let repeat=0;repeat<2;repeat++){const c=dot(Q[j],V[l]);R[j][l]+=c;for(let i=0;i<A.length;i++)V[l][i]-=c*Q[j][i];}
  }
  function solve(b){const z=Array(n).fill(0),x=Array(n).fill(0);for(let j=rank-1;j>=0;j--){let c=dot(Q[j],b);for(let k=j+1;k<rank;k++)c-=R[j][k]*z[k];z[j]=c/R[j][j];}perm.forEach((k,j)=>x[k]=z[j]);return x;}
  return {rank,solve,R,perm};
}
function cholesky(A){const n=A.length,L=zeros(n,n);for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let v=A[i][j];for(let k=0;k<j;k++)v-=L[i][k]*L[j][k];if(i===j){if(!(v>0))throw Error('Metric must be SPD');L[i][j]=Math.sqrt(v);}else L[i][j]=v/L[j][j];}return L;}
function lower(L,b){const x=[];for(let i=0;i<L.length;i++){let v=b[i];for(let j=0;j<i;j++)v-=L[i][j]*x[j];x[i]=v/L[i][i];}return x;}
function covariance(factors,dimension){const C=zeros(dimension,dimension);for(const v of factors)for(let i=0;i<dimension;i++)for(let j=0;j<dimension;j++)C[i][j]+=v[i]*v[j];return C;}
// Jacobi eigensystem for symmetric PSD diagnostics / singular whitening.
function eigenSymmetric(A){const n=A.length,V=zeros(n,n),D=A.map(r=>r.slice());for(let i=0;i<n;i++)V[i][i]=1;
  const scale=Math.max(...D.map(r=>Math.max(...r.map(Math.abs))),1e-300);
  for(let it=0;it<100*n*n;it++){let p=0,q=1,largest=0;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(Math.abs(D[i][j])>largest){largest=Math.abs(D[i][j]);p=i;q=j;}if(largest<1e-13*scale)break;
    const phi=.5*Math.atan2(2*D[p][q],D[q][q]-D[p][p]),c=Math.cos(phi),s=Math.sin(phi),app=D[p][p],aqq=D[q][q],apq=D[p][q];
    for(let k=0;k<n;k++)if(k!==p&&k!==q){const x=D[k][p],y=D[k][q];D[k][p]=D[p][k]=c*x-s*y;D[k][q]=D[q][k]=s*x+c*y;}
    D[p][p]=c*c*app-2*s*c*apq+s*s*aqq;D[q][q]=s*s*app+2*s*c*apq+c*c*aqq;D[p][q]=D[q][p]=0;
    for(let k=0;k<n;k++){const x=V[k][p],y=V[k][q];V[k][p]=c*x-s*y;V[k][q]=s*x+c*y;}
  }
  return Array.from({length:n},(_,j)=>({value:D[j][j],vector:V.map(r=>r[j])})).sort((a,b)=>b.value-a.value);
}
const wrapPi=a=>Math.atan2(Math.sin(2*a),Math.cos(2*a))/2;
return {zeros,dot,norm,tr,mm,mv,qr,cholesky,lower,covariance,eigenSymmetric,wrapPi};
});
