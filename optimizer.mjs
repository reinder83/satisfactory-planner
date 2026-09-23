import loadHighs from './vendor/highs.cjs';
const highs=await loadHighs();
export function solve(model){
 const names=Object.keys(model.variables),vars=names.map((_,i)=>'v'+i);
 const expression=key=>names.map((n,i)=>[model.variables[n][key]||0,vars[i]]).filter(([q])=>q!==0).map(([q,n])=>`${q<0?'-':'+'} ${Math.abs(q)} ${n}`).join(' ')||'0 v0';
 const lines=[model.opType==='max'?'Maximize':'Minimize','objective: '+expression(model.optimize),'Subject To'];let i=0;
 for(const [key,b] of Object.entries(model.constraints)){const e=expression(key);if(b.equal!==undefined)lines.push(`c${i++}: ${e} = ${b.equal}`);else{if(b.min!==undefined)lines.push(`c${i++}: ${e} >= ${b.min}`);if(b.max!==undefined)lines.push(`c${i++}: ${e} <= ${b.max}`);}}
 lines.push('Bounds',...names.map((n,i)=>model.bounds?.[n]!==undefined?`0 <= ${vars[i]} <= ${model.bounds[n]}`:vars[i]+' >= 0'));
 const integers=names.map((n,i)=>model.ints?.[n]?vars[i]:null).filter(Boolean);if(integers.length)lines.push('Generals',integers.join(' '));lines.push('End');
 const r=highs.solve(lines.join('\n'),{output_flag:false,time_limit:3});
 return {solverStatus:r.Status,feasible:r.Status==='Optimal',bounded:r.Status==='Optimal',...Object.fromEntries(names.map((n,i)=>[n,r.Columns?.[vars[i]]?.Primal||0]))};
}
