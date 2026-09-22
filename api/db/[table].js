import { neon } from '@neondatabase/serverless';

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
function qid(s){ return '"'+String(s).replaceAll('"','""')+'"'; }
function filterBody(table, body){
  const out={}; const set=cols[table];
  for(const [k,v] of Object.entries(body||{})) if(set.has(k)) out[k]=v;
  return out;
}
function parseFilters(table, query){
  const where=[]; const vals=[]; const set=cols[table];
  for(const [k,v0] of Object.entries(query||{})){
    if(['select','order','limit'].includes(k)||!set.has(k)) continue;
    const v=String(v0); const m=v.match(/^(eq|gte|lte)\.(.*)$/); if(!m) continue;
    vals.push(m[2]); where.push(`${qid(k)} ${m[1]==='eq'?'=':m[1]==='gte'?'>=':'<='} $${vals.length}`);
  }
  return {where:where.length?' WHERE '+where.join(' AND '):'',vals};
}
export default async function handler(req,res){
  try{
    if(!process.env.DATABASE_URL) return res.status(500).send('DATABASE_URL NÃO CONFIGURADA NA VERCEL');
    const requested=String(req.query.table||''); if(!allowed.has(requested)) return res.status(400).send('TABELA INVÁLIDA');
    const table=realTable(requested); const sql=neon(process.env.DATABASE_URL);
    if(req.method==='GET'){
      let select='*';
      if(table==='mv_employees') select=`e.*, u.username, u.password_hash`;
      const {where,vals}=parseFilters(table,req.query);
      let text=table==='mv_employees'?`SELECT ${select} FROM mv_employees e JOIN mv_users u ON u.id=e.user_id`: `SELECT * FROM ${qid(table)}`;
      // filters need e. ambiguity avoidance is irrelevant for current id/status/date usage; qualify employee columns
      let w=where; if(table==='mv_employees') w=w.replace(/"(id|user_id|full_name|cargo|status|created_at|updated_at)"/g,'e."$1"');
      text+=w;
      if(req.query.order){ const [c,d]=String(req.query.order).split('.'); if(cols[table].has(c)) text+=` ORDER BY ${table==='mv_employees'?'e.':''}${qid(c)} ${d==='desc'?'DESC':'ASC'}`; }
      if(req.query.limit) text+=` LIMIT ${Math.max(1,Math.min(500,Number(req.query.limit)||100))}`;
      return res.status(200).json(await sql.query(text,vals));
    }
    if(req.method==='POST'){
      let body={...(req.body||{})};
      if(table==='mv_tools' && body.code!==undefined){body.identification=body.code;delete body.code;}
      if(table==='mv_expenses' && body.type!==undefined){body.category=body.type;delete body.type;}
      body=filterBody(table,body); const ks=Object.keys(body); if(!ks.length) return res.status(400).send('SEM DADOS');
      const vals=ks.map(k=>body[k]); const text=`INSERT INTO ${qid(table)} (${ks.map(qid).join(',')}) VALUES (${ks.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`;
      return res.status(200).json(await sql.query(text,vals));
    }
    if(req.method==='PATCH'){
      let body={...(req.body||{})}; if(table==='mv_tools'&&body.code!==undefined){body.identification=body.code;delete body.code;} body=filterBody(table,body);
      const ks=Object.keys(body); const f=parseFilters(table,req.query); if(!ks.length||!f.where) return res.status(400).send('ALTERAÇÃO INVÁLIDA');
      const vals=ks.map(k=>body[k]); const set=ks.map((k,i)=>`${qid(k)}=$${i+1}`).join(','); const shifted=f.where.replace(/\$(\d+)/g,(_,n)=>'$'+(Number(n)+vals.length));
      return res.status(200).json(await sql.query(`UPDATE ${qid(table)} SET ${set}, updated_at=now()${shifted} RETURNING *`,vals.concat(f.vals)));
    }
    if(req.method==='DELETE'){
      const f=parseFilters(table,req.query); if(!f.where) return res.status(400).send('FILTRO OBRIGATÓRIO'); await sql.query(`DELETE FROM ${qid(table)}${f.where}`,f.vals); return res.status(200).json({ok:true});
    }
    res.status(405).end();
  }catch(e){ res.status(500).send(e?.message||String(e)); }
}
