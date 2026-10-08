const allowed = new Set(['mv_users','mv_system_users','mv_employees','mv_attendance','mv_tasks','mv_tools','mv_measurements','mv_expenses']);
const realTable = t => t === 'mv_system_users' ? 'mv_users' : t;

const cols = {
  mv_users:new Set(['id','full_name','username','password_hash','role','is_active','created_at','updated_at']),
  mv_employees:new Set(['id','user_id','full_name','cargo','status','created_at','updated_at']),
  mv_attendance:new Set(['id','employee_id','date','status','observation','registered_at','updated_at']),
  mv_tasks:new Set(['id','employee_id','director_id','description','value','status','completed_at','created_at','updated_at']),
  mv_tools:new Set(['id','name','identification','status','observation','created_at','updated_at']),
  mv_measurements:new Set(['id','description','value','status','reference_date','completed_at','observation','created_at','updated_at']),
  mv_expenses:new Set(['id','category','description','value','employee_id','expense_date','observation','created_at','updated_at'])
};

function filterBody(table, body){
  const out={};
  const set=cols[table];
  for(const [k,v] of Object.entries(body||{})) if(set.has(k)) out[k]=v;
  return out;
}

function buildParams(table, query, select='*'){
  const params = new URLSearchParams();
  params.set('select', select);
  const set=cols[table];

  for(const [k,v0] of Object.entries(query||{})){
    if(['table','select','order','limit'].includes(k) || !set.has(k)) continue;
    const v=String(v0);
    const m=v.match(/^(eq|gte|lte)\.(.*)$/);
    if(m) params.set(k, m[1]+'.'+m[2]);
  }

  if(query?.order){
    const [c,d] = String(query.order).split('.');
    if(set.has(c)) params.set('order', c+'.'+(d==='desc'?'desc':'asc'));
  }

  if(query?.limit){
    const n=Math.max(1,Math.min(500,Number(query.limit)||100));
    params.set('limit',String(n));
  }

  return params;
}

async function supabaseRequest(table, method='GET', params=null, body=undefined, returning=true){
  const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base || !key) throw new Error('SUPABASE_URL OU SUPABASE_SECRET_KEY NÃO CONFIGURADO NA VERCEL');

  const url=base+'/rest/v1/'+encodeURIComponent(table)+(params&&String(params)?'?'+params.toString():'');
  const headers={
    'apikey':key,
    'Content-Type':'application/json'
  };
  if(!String(key).startsWith('sb_')) headers['Authorization']='Bearer '+key;

  if(method==='POST' || method==='PATCH'){
    headers['Prefer']=returning?'return=representation':'return=minimal';
  }else if(method==='DELETE'){
    headers['Prefer']='return=minimal';
  }

  const r=await fetch(url,{
    method,
    headers,
    body:body===undefined?undefined:JSON.stringify(body)
  });

  const text=await r.text();
  if(!r.ok){
    let msg=text;
    try{
      const j=JSON.parse(text);
      msg=j?.message || j?.hint || j?.details || text;
    }catch{}
    throw new Error(msg || ('SUPABASE HTTP '+r.status));
  }

  if(!text) return [];
  try{return JSON.parse(text);}catch{return [];}
}

async function getEmployees(query){
  const rows=await supabaseRequest(
    'mv_employees',
    'GET',
    buildParams('mv_employees',query)
  );
  const users=await supabaseRequest(
    'mv_users',
    'GET',
    new URLSearchParams({select:'id,username,password_hash,is_active'})
  );
  const byId=new Map((users||[]).map(u=>[String(u.id),u]));
  return (rows||[]).map(e=>{
    const u=byId.get(String(e.user_id))||{};
    return {...e,username:u.username||'',password_hash:u.password_hash||'',is_active:u.is_active!==false};
  });
}

export default async function handler(req,res){
  try{
    const requested=String(req.query.table||'');
    if(!allowed.has(requested)) return res.status(400).send('TABELA INVÁLIDA');

    const table=realTable(requested);

    if(req.method==='GET'){
      const data=table==='mv_employees'
        ? await getEmployees(req.query)
        : await supabaseRequest(table,'GET',buildParams(table,req.query));
      return res.status(200).json(data);
    }

    if(req.method==='POST'){
      let body={...(req.body||{})};
      if(table==='mv_tools' && body.code!==undefined){
        body.identification=body.code;
        delete body.code;
      }
      if(table==='mv_expenses' && body.type!==undefined){
        body.category=body.type;
        delete body.type;
      }
      body=filterBody(table,body);
      if(!Object.keys(body).length) return res.status(400).send('SEM DADOS');

      const data=await supabaseRequest(table,'POST',null,body,true);
      return res.status(200).json(data);
    }

    if(req.method==='PATCH'){
      let body={...(req.body||{})};
      if(table==='mv_tools' && body.code!==undefined){
        body.identification=body.code;
        delete body.code;
      }
      body=filterBody(table,body);
      if(!Object.keys(body).length) return res.status(400).send('ALTERAÇÃO INVÁLIDA');

      const params=buildParams(table,req.query,'*');
      params.delete('select');
      const hasFilter=[...params.keys()].some(k=>k!=='order'&&k!=='limit');
      if(!hasFilter) return res.status(400).send('FILTRO OBRIGATÓRIO');

      body.updated_at=new Date().toISOString();
      const data=await supabaseRequest(table,'PATCH',params,body,true);
      return res.status(200).json(data);
    }

    if(req.method==='DELETE'){
      const params=buildParams(table,req.query,'*');
      params.delete('select');
      const hasFilter=[...params.keys()].some(k=>k!=='order'&&k!=='limit');
      if(!hasFilter) return res.status(400).send('FILTRO OBRIGATÓRIO');

      await supabaseRequest(table,'DELETE',params,undefined,false);
      return res.status(200).json({ok:true});
    }

    res.status(405).end();
  }catch(e){
    res.status(500).send(e?.message||String(e));
  }
}
