import { neon } from '@neondatabase/serverless';
const allowed=new Set(['mv_tools','mv_measurements','mv_expenses']);
export default async function handler(req,res){
 try{
  if(req.method!=='PUT') return res.status(405).end();
  const table=String(req.query.table||''); if(!allowed.has(table)) return res.status(400).send('TABELA INVÁLIDA');
  const sql=neon(process.env.DATABASE_URL); const rows=Array.isArray(req.body)?req.body:[];
  await sql`BEGIN`;
  await sql.query(`DELETE FROM "${table}"`);
  for(const x of rows){
   if(table==='mv_tools') await sql`INSERT INTO mv_tools (name,identification,status,observation,created_at,updated_at) VALUES (${x.name||''},${x.code||x.identification||null},${x.status||'ativa'},${x.observation||null},${x.created_at||new Date().toISOString()},${x.updated_at||new Date().toISOString()})`;
   if(table==='mv_measurements') await sql`INSERT INTO mv_measurements (description,value,status,reference_date,completed_at,observation,created_at,updated_at) VALUES (${x.description||''},${Number(x.value)||0},${x.status||'pendente'},${(x.reference_date||x.created_at||new Date().toISOString()).slice(0,10)},${x.completed_at||null},${x.observation||null},${x.created_at||new Date().toISOString()},${x.updated_at||new Date().toISOString()})`;
   if(table==='mv_expenses') await sql`INSERT INTO mv_expenses (category,description,value,employee_id,expense_date,observation,created_at,updated_at) VALUES (${x.type||x.category||'outro'},${x.description||''},${Number(x.value)||0},${x.employee_id||null},${(x.expense_date||x.created_at||new Date().toISOString()).slice(0,10)},${x.observation||null},${x.created_at||new Date().toISOString()},${x.updated_at||new Date().toISOString()})`;
  }
  await sql`COMMIT`; return res.status(200).json({ok:true});
 }catch(e){ try{const sql=neon(process.env.DATABASE_URL);await sql`ROLLBACK`;}catch{} res.status(500).send(e?.message||String(e)); }
}
