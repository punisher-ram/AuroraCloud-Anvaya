import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();
const app=express();const PORT=process.env.PORT||4000;const ORIGIN=process.env.CLIENT_ORIGIN||"http://localhost:5173";
app.use(cors({origin:[ORIGIN,"http://localhost:5173","http://127.0.0.1:5173"],credentials:true}));app.use(express.json({limit:"2mb"}));
const CURATED=[
 ["gemini-3-flash-preview","Gemini 3 Flash"],["gemini-3.1-flash-lite","Gemini 3.1 Flash Lite"],["gemini-3.5-flash","Gemini 3.5 Flash"],["gemini-3.5-flash-lite","Gemini 3.5 Flash Lite"],["gemini-3.5-transcribe","Gemini 3.5 Transcribe"],["gemini-3.6-flash","Gemini 3.6 Flash"],["gemini-3.7-flash","Gemini 3.7 Flash"],["gemini-3.8-flash","Gemini 3.8 Flash"],["gemma-4-31b-it","Gemma 4 31B"]
].map(([id,name])=>({id,name}));
const FALLBACK="gemini-2.5-flash";
app.get("/api/health",(_,res)=>res.json({ok:true,service:"anvaya-server"}));

// Account deletion is intentionally server-side. The Supabase secret/service-role
// key never reaches the browser. The browser sends its access token; this server
// verifies that token with Supabase Auth, then calls the locked-down admin RPC.
app.delete("/api/account",async(req,res)=>{
  const authHeader=req.headers.authorization||"";
  const token=authHeader.startsWith("Bearer ")?authHeader.slice(7).trim():"";
  const supabaseUrl=process.env.SUPABASE_URL;
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!supabaseUrl||!serviceKey)return res.status(503).json({error:"Supabase server credentials are not configured."});
  if(!token)return res.status(401).json({error:"Missing Supabase access token."});
  try{
    const userRes=await fetch(`${supabaseUrl}/auth/v1/user`,{headers:{apikey:serviceKey,Authorization:`Bearer ${token}`}});
    const user=await userRes.json().catch(()=>({}));
    if(!userRes.ok||!user.id)return res.status(401).json({error:"Your session is invalid or expired. Please sign in again."});
    const rpcRes=await fetch(`${supabaseUrl}/rest/v1/rpc/delete_account_admin`,{
      method:"POST",
      headers:{"Content-Type":"application/json",apikey:serviceKey,Authorization:`Bearer ${serviceKey}`},
      body:JSON.stringify({p_user_id:user.id})
    });
    const rpcData=await rpcRes.json().catch(()=>({}));
    if(!rpcRes.ok){
      const detail=rpcData?.message||rpcData?.error_description||rpcData?.hint||rpcData?.error||`Account deletion failed (${rpcRes.status})`;
      return res.status(500).json({error:detail});
    }
    res.json({ok:true});
  }catch(e){
    res.status(500).json({error:e?.message||"Account deletion failed."});
  }
});
app.get("/api/astra/models",(_,res)=>res.json({models:CURATED.map(x=>({name:x.id,label:x.name}))}));
const ANTIGRAVITY_MODELS=new Set(["gemini-3.5-flash","gemini-3.5-flash-lite","gemini-3.6-flash","gemini-3.7-flash","gemini-3.8-flash"]);
const SYSTEM="You are Astra, the optional intelligence layer inside Anvaya. Be privacy-conscious, concise, and useful. Never claim to have executed payments, purchases, messages, reminders, or other external actions unless a separate tool confirms them.";
app.post("/api/astra/chat",async(req,res)=>{
  const {model="gemini-3.6-flash",messages=[]}=req.body||{};
  if(!process.env.GEMINI_API_KEY)return res.status(503).json({error:"GEMINI_API_KEY is not configured on the server."});
  const transcript=messages.map(m=>`${m.role==="assistant"?"Astra":"User"}: ${(m.parts||[]).map(p=>p.text||"").join("\n")}`).join("\n\n");
  const normalizedModel=model==="gemini-3.5-transcribe"?(process.env.GEMINI_TRANSCRIBE_CHAT_MODEL||"gemini-3.5-flash-lite"):model;
  const agentModels=new Set(["gemini-3.5-flash","gemini-3.5-flash-lite","gemini-3.6-flash","gemini-3.7-flash","gemini-3.8-flash"]);
  try{
    const body=agentModels.has(normalizedModel)
      ? {agent:process.env.GEMINI_ANTIGRAVITY_AGENT||"antigravity-preview-05-2026",input:`${SYSTEM}\n\n${transcript}`,environment:"remote",agent_config:{type:"antigravity",model:normalizedModel}}
      : {model:normalizedModel, input:`${SYSTEM}\n\n${transcript}`};
    const r=await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{
      method:"POST",
      headers:{"Content-Type":"application/json","x-goog-api-key":process.env.GEMINI_API_KEY},
      body:JSON.stringify(body),
      signal:AbortSignal.timeout(120000)
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok){
      const detail=data.error?.message||data.errors?.[0]?.message||data.message||`Gemini request failed (${r.status})`;
      return res.status(r.status).json({error:detail});
    }
    const stepText=(data.steps||[])
      .filter(s=>s.type==="model_output"||s.type==="message"||s.type==="assistant_message")
      .flatMap(s=>Array.isArray(s.content)?s.content:[])
      .filter(x=>x?.type==="text" || typeof x?.text==="string")
      .map(x=>x.text||"")
      .join("\n");
    const text=data.output_text||data.output?.text||stepText||"";
    if(data.status==="failed"||data.status==="cancelled"||data.status==="incomplete"||data.status==="budget_exceeded") {
      return res.status(502).json({error:data.errors?.[0]?.message||`Astra interaction ${data.status}.`});
    }
    if(!text)return res.status(502).json({error:"Astra returned no text output."});
    return res.json({text,model,provider:agentModels.has(normalizedModel)?"antigravity":"gemini-interactions"});
  }catch(e){
    const message=e?.name==="TimeoutError"?"Astra timed out. Please try again.":e?.message||"Astra request failed.";
    return res.status(502).json({error:message});
  }
});
app.get("/api/weather",async(req,res)=>{const city=req.query.city;if(!city)return res.status(400).json({error:"city is required"});if(!process.env.OPENWEATHER_API_KEY)return res.status(503).json({error:"OPENWEATHER_API_KEY is not configured on the server."});try{const r=await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${encodeURIComponent(process.env.OPENWEATHER_API_KEY)}&units=metric`);const data=await r.json();if(!r.ok)return res.status(r.status).json({error:data.message||"Weather request failed"});res.json({city:data.name,temp:data.main.temp,feelsLike:data.main.feels_like,description:data.weather?.[0]?.description,humidity:data.main.humidity,wind:data.wind?.speed});}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/email/test",async(req,res)=>{if(!process.env.RESEND_API_KEY)return res.status(503).json({error:"RESEND_API_KEY is not configured on the server."});const {to}=req.body;if(!to)return res.status(400).json({error:"to is required"});try{const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${process.env.RESEND_API_KEY}`},body:JSON.stringify({from:"Anvaya <onboarding@resend.dev>",to:[to],subject:"Anvaya test",text:"Anvaya email service is connected."})});const data=await r.json();if(!r.ok)return res.status(r.status).json({error:data.message||"Resend request failed"});res.json(data)}catch(e){res.status(500).json({error:e.message})}});
app.listen(PORT,()=>console.log(`Anvaya server listening on ${PORT}`));
