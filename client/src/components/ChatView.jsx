import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, MoreVertical, Paperclip, Smile, Mic, Square, Send, Check, CheckCheck,
  FileText, Download, Sparkles, Cake, CalendarPlus, Wallet, MoreHorizontal, X,
  Pin, PinOff, MessageSquare, Reply, ThumbsUp, Heart, Laugh, Plus, BarChart3,
  MapPin, AtSign, Image as ImageIcon, Link2, FolderOpen, Bell, Users, Play,
  Pause, Paperclip as Clip, File, ChevronLeft, Clock3
} from "lucide-react";
import { supabase } from "../lib/supabase";

const EMOJIS=["😀","😂","😍","🥹","😊","😎","🤝","❤️","🔥","👍","🎉","😄","🙏","✨","🚀","💯","😅","🤔","😭","🤣"];
const REACTIONS=["❤️","👍","😂","😮","😢","🔥"];
const CHAT_BUCKET="anvaya-chat-media";

async function avatarUrl(path){
  if(!path||!supabase)return null;
  if(path.startsWith("http"))return path;
  const {data}=await supabase.storage.from("vyara-avatars").createSignedUrl(path,3600);
  return data?.signedUrl||null;
}

function Avatar({ profile, small=false }) {
  const fallback=(profile?.display_name||profile?.username||"A").slice(0,1).toUpperCase();
  const [broken,setBroken]=useState(false);
  return profile?.avatar_url&&!broken
    ? <img alt="" src={profile.avatar_url} onError={()=>setBroken(true)} className={`${small?"h-9 w-9":"h-10 w-10"} rounded-full object-cover`} />
    : <div className={`${small?"h-9 w-9 text-xs":"h-10 w-10 text-sm"} rounded-full bg-gradient-to-br from-[#123f33] to-[#18382f] grid place-items-center font-semibold text-emerald-100`}>{fallback}</div>;
}

const scopedDraft=(userId,conversationId)=>`anvaya_draft_${userId}_${conversationId}`;
const scopedEvents=(userId)=>`vyara_events_${userId}`;

export default function ChatView({ user, astraEnabled, onAstra }) {
  const [conversations,setConversations]=useState([]),[selected,setSelected]=useState(null),[messages,setMessages]=useState([]);
  const [text,setText]=useState(""),[search,setSearch]=useState(""),[messageSearch,setMessageSearch]=useState("");
  const [menu,setMenu]=useState(null),[emojiOpen,setEmojiOpen]=useState(false),[status,setStatus]=useState("");
  const [loading,setLoading]=useState(true),[typing,setTyping]=useState(false),[online,setOnline]=useState(false),[lastSeen,setLastSeen]=useState(null),[deliveries,setDeliveries]=useState({});
  const [reactions,setReactions]=useState({}),[pins,setPins]=useState([]),[thread,setThread]=useState(null),[details,setDetails]=useState(false);
  const [pollOpen,setPollOpen]=useState(false),[pollQuestion,setPollQuestion]=useState(""),[pollOptions,setPollOptions]=useState(["",""]);
  const [groupOpen,setGroupOpen]=useState(false),[groupTitle,setGroupTitle]=useState(""),[groupCandidates,setGroupCandidates]=useState([]),[groupSelected,setGroupSelected]=useState([]);
  const [newChatOpen,setNewChatOpen]=useState(false),[newChatCandidates,setNewChatCandidates]=useState([]),[newChatBusy,setNewChatBusy]=useState(false);
  const [reminder,setReminder]=useState(null),[recording,setRecording]=useState(false),[attachment,setAttachment]=useState(null),[voiceUrl,setVoiceUrl]=useState("");
  const [mentionOpen,setMentionOpen]=useState(false),[readAt,setReadAt]=useState(null),[myReadReceipts,setMyReadReceipts]=useState(true);
  const mediaRecorder=useRef(null),chunks=useRef([]),typingTimer=useRef(null),fileRef=useRef(null),scrollRef=useRef(null);

  async function loadConversations(){
    if(!supabase||!user?.id)return;
    setLoading(true);
    try{
      // Use a small SECURITY DEFINER read RPC for the conversation index. This keeps
      // existing conversations visible even if a client-side RLS policy/cache is stale.
      let index=await supabase.rpc("get_my_conversations");
      let rows=index.data||[];
      if(index.error){
        const fallback=await supabase.from("conversation_members").select("conversation_id").eq("user_id",user.id);
        if(fallback.error) throw fallback.error;
        const fallbackIds=[...new Set((fallback.data||[]).map(x=>x.conversation_id))];
        if(!fallbackIds.length){setConversations([]);setSelected(null);setLoading(false);return;}
        const fallbackC=await supabase.from("conversations").select("id,kind,title,updated_at").in("id",fallbackIds).order("updated_at",{ascending:false});
        if(fallbackC.error) throw fallbackC.error;
        rows=(fallbackC.data||[]).map(c=>({conversation_id:c.id,kind:c.kind,title:c.title,updated_at:c.updated_at}));
      }
      const ids=rows.map(x=>x.conversation_id).filter(Boolean);
      if(!ids.length){setConversations([]);setSelected(null);setLoading(false);return;}
      const membersQ=await supabase.from("conversation_members").select("conversation_id,user_id").in("conversation_id",ids);
      if(membersQ.error) throw membersQ.error;
      const allIds=[...new Set((membersQ.data||[]).map(m=>m.user_id))];
      let profilesQ=allIds.length?await supabase.from("profiles").select("user_id,display_name,username,avatar_url,read_receipts_enabled,last_seen_enabled,last_seen_at").in("user_id",allIds):{data:[],error:null};
      if(profilesQ.error) profilesQ=allIds.length?await supabase.from("profiles").select("user_id,display_name,username,avatar_url").in("user_id",allIds):{data:[],error:null};
      const profilesById=Object.fromEntries((profilesQ.data||[]).map(p=>[p.user_id,p]));
      const readIds=ids;
      let readsQ=await supabase.from("conversation_reads").select("conversation_id,last_read_at").eq("user_id",user.id).in("conversation_id",readIds);
      if(readsQ.error) readsQ={data:[]};
      const conversations=await Promise.all(rows.map(async c=>{
        const members=(membersQ.data||[]).filter(x=>x.conversation_id===c.conversation_id);
        const others=members.filter(x=>x.user_id!==user.id).map(x=>profilesById[x.user_id]).filter(Boolean);
        const r=(readsQ.data||[]).find(x=>x.conversation_id===c.conversation_id);
        if(c.kind==="group") return {id:c.conversation_id,kind:"group",title:c.title||"Group",other:{display_name:c.title||"Group",username:"group",avatar_url:null},participants:others,lastReadAt:r?.last_read_at||null};
        const profile=others[0]; if(!profile)return null;
        return {id:c.conversation_id,kind:"direct",other:{...profile,avatar_url:await avatarUrl(profile.avatar_url)},participants:others,lastReadAt:r?.last_read_at||null};
      }));
      const clean=conversations.filter(Boolean);
      setConversations(clean);
      if(selected && clean.some(c=>c.id===selected)) setSelected(selected);
      else if(clean.length) setSelected(clean[0].id);
      else setSelected(null);
      setStatus("");
    }catch(e){
      setStatus(e?.message||"Could not load your conversations.");
    }finally{setLoading(false)}
  }

  async function openGroupCreator(){
    setGroupTitle("");setGroupSelected([]);setStatus("");setGroupOpen(true);
    const {data:accepted}=await supabase.from("friend_requests").select("sender_id,receiver_id").or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`).eq("status","accepted");
    const ids=[...new Set((accepted||[]).map(r=>r.sender_id===user.id?r.receiver_id:r.sender_id))];
    const {data}=ids.length?await supabase.from("profiles").select("user_id,display_name,username,avatar_url").in("user_id",ids):{data:[]};
    setGroupCandidates(data||[]);
  }

  async function openNewChat(){
    setStatus("");setNewChatOpen(true);setNewChatBusy(true);
    try{
      const {data:accepted,error}=await supabase.from("friend_requests").select("sender_id,receiver_id").or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`).eq("status","accepted");
      if(error)throw error;
      const ids=[...new Set((accepted||[]).map(r=>r.sender_id===user.id?r.receiver_id:r.sender_id))];
      const {data,error:profileError}=ids.length?await supabase.from("profiles").select("user_id,display_name,username,avatar_url").in("user_id",ids):{data:[],error:null};
      if(profileError)throw profileError;
      setNewChatCandidates(data||[]);
    }catch(e){setStatus(e?.message||"Could not load your connections.")}
    finally{setNewChatBusy(false)}
  }

  async function startDirectChat(otherId){
    if(!otherId)return;setNewChatBusy(true);setStatus("");
    try{
      let {data,error}=await supabase.rpc("start_direct_chat",{p_other_user:otherId});
      if(error){
        const fallback=await supabase.rpc("get_or_create_direct_conversation",{p_other_user:otherId});
        data=fallback.data; error=fallback.error;
      }
      if(error)throw error;
      await loadConversations();
      if(data)setSelected(data);
      setNewChatOpen(false);
    }catch(e){setStatus(e?.message||"Could not start the conversation.")}
    finally{setNewChatBusy(false)}
  }

  async function createGroup(){
    const title=groupTitle.trim();
    if(title.length<1||groupSelected.length<1){setStatus("Give the group a name and choose at least one person.");return;}
    setStatus("");
    let {data,error}=await supabase.rpc("create_group_v2",{p_title:title,p_member_ids:groupSelected});
    if(error){
      const fallback=await supabase.rpc("create_group",{p_title:title,p_member_ids:groupSelected});
      data=fallback.data; error=fallback.error;
    }
    if(error){setStatus(error.message);return;}
    setGroupOpen(false);setGroupTitle("");setGroupSelected([]);await loadConversations();if(data)setSelected(data);
  }

  async function loadMessages(id){
    if(!id)return;
    // Always load the core message columns first. This keeps normal text chat working
    // even if the optional rich-chat migration has not reached the database yet.
    const core=await supabase.from("messages").select("id,sender_id,body,created_at,edited_at,deleted_at").eq("conversation_id",id).order("created_at",{ascending:true});
    if(core.error){setStatus(core.error.message);return;}
    let data=core.data||[];
    // Enrich with optional v3 columns when they exist. Never let a missing migration
    // hide ordinary messages from the recipient.
    if(data.length){
      const feature=await supabase.from("messages").select("id,parent_message_id,attachment_url,attachment_name,attachment_type,location_lat,location_lng,poll_id").in("id",data.map(m=>m.id));
      if(!feature.error){
        const byId=Object.fromEntries((feature.data||[]).map(m=>[m.id,m]));
        data=data.map(m=>({...m,...(byId[m.id]||{})}));
      }
    }
    setStatus("");
    setMessages(data);
    const incoming=data.filter(m=>m.sender_id!==user.id).at(-1);
    const readEnabled=myReadReceipts && (current?.kind==="group" ? true : current?.other?.read_receipts_enabled!==false);
    const now=incoming?.created_at||new Date().toISOString();
    const reads=readEnabled?await supabase.from("conversation_reads").upsert({conversation_id:id,user_id:user.id,last_read_at:now},{onConflict:"conversation_id,user_id"}):{error:null};
    if(!reads.error && incoming){await supabase.from("message_deliveries").upsert({message_id:incoming.id,user_id:user.id,delivered_at:new Date().toISOString(),...(readEnabled?{read_at:new Date().toISOString()}: {})},{onConflict:"message_id,user_id"});}
    const rr=await supabase.from("conversation_reads").select("last_read_at").eq("conversation_id",id).eq("user_id",user.id).maybeSingle();setReadAt(rr.data?.last_read_at||null);
    const dr=await supabase.from("message_deliveries").select("message_id,user_id,delivered_at,read_at").in("message_id",data.map(m=>m.id));
    setDeliveries(Object.fromEntries((dr.data||[]).map(x=>[x.message_id,x])));
    const mids=data.map(m=>m.id);
    if(mids.length){
      const rq=await supabase.from("message_reactions").select("message_id,user_id,reaction").in("message_id",mids);
      if(!rq.error)setReactions(groupReactions(rq.data||[]));
      const pq=await supabase.from("message_pins").select("message_id").eq("conversation_id",id);
      if(!pq.error)setPins((pq.data||[]).map(x=>x.message_id));
    }
    setTimeout(()=>scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:"smooth"}),30);
  }

  useEffect(()=>{if(!user?.id)return;supabase.from("profiles").select("read_receipts_enabled").eq("user_id",user.id).maybeSingle().then(({data})=>setMyReadReceipts(data?.read_receipts_enabled!==false));loadConversations()},[user?.id]);
  useEffect(()=>{if(!selected)return;setText(localStorage.getItem(scopedDraft(user.id,selected))||"");loadMessages(selected);},[selected,user?.id]);
  useEffect(()=>{if(selected&&user?.id)localStorage.setItem(scopedDraft(user.id,selected),text)},[text,selected,user?.id]);

  useEffect(()=>{
    if(!selected||!supabase)return;
    const channel=supabase.channel(`anvaya-chat-${selected}`,{config:{presence:{key:user.id}}})
      .on("postgres_changes",{event:"*",schema:"public",table:"messages",filter:`conversation_id=eq.${selected}`},payload=>{
        if(payload.eventType==="INSERT") { setMessages(m=>m.some(x=>x.id===payload.new.id)?m:[...m,payload.new]); if(payload.new.sender_id!==user.id){supabase.from("message_deliveries").upsert({message_id:payload.new.id,user_id:user.id,delivered_at:new Date().toISOString(),read_at:new Date().toISOString()},{onConflict:"message_id,user_id"});} }
        if(payload.eventType==="UPDATE")setMessages(m=>m.map(x=>x.id===payload.new.id?payload.new:x));
      })
      .on("postgres_changes",{event:"*",schema:"public",table:"message_reactions"},()=>loadMessages(selected))
      .on("postgres_changes",{event:"*",schema:"public",table:"message_pins",filter:`conversation_id=eq.${selected}`},()=>loadMessages(selected))
      .on("postgres_changes",{event:"*",schema:"public",table:"message_deliveries"},payload=>{
        if(payload.new?.message_id) setDeliveries(d=>({...d,[payload.new.message_id]:payload.new}));
      })
      .on("broadcast",{event:"typing"},({payload})=>{if(payload.userId!==user.id){setTyping(!!payload.typing);clearTimeout(typingTimer.current);if(payload.typing)typingTimer.current=setTimeout(()=>setTyping(false),2500)}})
      .on("presence",{event:"sync"},()=>{const state=channel.presenceState();const others=Object.values(state).flat().filter(p=>p.userId!==user.id);setOnline(others.length>0);if(!others.length)setLastSeen(current?.other?.last_seen_at||null)})
      .subscribe(async s=>{if(s==="SUBSCRIBED"){await channel.track({userId:user.id,onlineAt:new Date().toISOString()})}});
    const poller=setInterval(async()=>{await loadMessages(selected);if(current?.other?.user_id){const {data}=await supabase.from("profiles").select("last_seen_at,last_seen_enabled,read_receipts_enabled").eq("user_id",current.other.user_id).maybeSingle();if(data){setLastSeen(data.last_seen_at||null);setConversations(cs=>cs.map(c=>c.id===selected?{...c,other:{...c.other,...data}}:c));}}},1000);
    return()=>{supabase.removeChannel(channel);clearTimeout(typingTimer.current);clearInterval(poller)};
  },[selected,user?.id]);

  useEffect(()=>{
    if(!user?.id)return;
    const beat=()=>supabase.from("profiles").update({last_seen_at:new Date().toISOString()}).eq("user_id",user.id);
    beat();const timer=setInterval(beat,15000);return()=>{clearInterval(timer);beat()};
  },[user?.id]);

  const current=conversations.find(c=>c.id===selected);
  const filtered=useMemo(()=>conversations.filter(c=>(c.other?.username||"").toLowerCase().includes(search.toLowerCase())||(c.other?.display_name||"").toLowerCase().includes(search.toLowerCase())),[conversations,search]);
  const visibleMessages=useMemo(()=>messageSearch?messages.filter(m=>(m.body||"").toLowerCase().includes(messageSearch.toLowerCase())||((m.attachment_name||"").toLowerCase().includes(messageSearch.toLowerCase()))):messages,[messages,messageSearch]);
  const media=messages.filter(m=>m.attachment_type?.startsWith("image/"));
  const files=messages.filter(m=>m.attachment_url&&m.attachment_type&&!m.attachment_type.startsWith("image/")&&m.attachment_type!=="audio/webm");
  const links=messages.filter(m=>/(https?:\/\/\S+)/i.test(m.body||""));

  async function send(){
    const body=text.trim(); if(!body||!selected)return;
    setStatus("");
    const {data,error}=await supabase.from("messages").insert({conversation_id:selected,sender_id:user.id,body}).select("*").single();
    if(error)setStatus(error.message);else{setText("");localStorage.removeItem(scopedDraft(user.id,selected));if(data)setMessages(m=>m.some(x=>x.id===data.id)?m:[...m,data]);}
  }
  function broadcastTyping(value){
    if(!selected)return;
    const channel=supabase.getChannels().find(c=>c.topic===`realtime:anvaya-chat-${selected}`);channel?.send({type:"broadcast",event:"typing",payload:{userId:user.id,typing:value}});
  }
  function onTextChange(e){const v=e.target.value;setText(v);broadcastTyping(true);clearTimeout(typingTimer.current);typingTimer.current=setTimeout(()=>broadcastTyping(false),1000);setMentionOpen(v.endsWith("@")||/@[\w.-]*$/.test(v))}
  function addEmoji(e){setText(t=>t+e);setEmojiOpen(false)}
  function mention(name){setText(t=>t.replace(/@[\w.-]*$/,"@"+name+" "));setMentionOpen(false)}

  async function toggleReaction(m,emoji){
    const existing=await supabase.from("message_reactions").select("id").eq("message_id",m.id).eq("user_id",user.id).eq("reaction",emoji).maybeSingle();
    if(existing.data)await supabase.from("message_reactions").delete().eq("id",existing.data.id);else await supabase.from("message_reactions").insert({message_id:m.id,user_id:user.id,reaction:emoji});
    loadMessages(selected);
  }
  async function togglePin(m){const exists=pins.includes(m.id);if(exists)await supabase.from("message_pins").delete().eq("conversation_id",selected).eq("message_id",m.id);else await supabase.from("message_pins").insert({conversation_id:selected,message_id:m.id,pinned_by:user.id});setMenu(null);loadMessages(selected)}
  async function editMessage(m){const next=prompt("Edit message",m.body);if(next?.trim())await supabase.from("messages").update({body:next.trim(),edited_at:new Date().toISOString()}).eq("id",m.id);setMenu(null);loadMessages(selected)}
  async function deleteMessage(m){if(confirm("Delete this message?"))await supabase.from("messages").update({body:"This message was deleted.",deleted_at:new Date().toISOString()}).eq("id",m.id);setMenu(null);loadMessages(selected)}

  async function uploadFile(file){
    if(!file||!selected)return;
    setStatus("");
    const path=`${user.id}/${selected}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
    const up=await supabase.storage.from(CHAT_BUCKET).upload(path,file,{upsert:false});
    if(up.error){setStatus(up.error.message);return;}
    const signed=await supabase.storage.from(CHAT_BUCKET).createSignedUrl(path,3600);
    const {data,error}=await supabase.from("messages").insert({conversation_id:selected,sender_id:user.id,body:file.type.startsWith("image/")?"📷 Photo":`📎 ${file.name}`,attachment_url:path,attachment_name:file.name,attachment_type:file.type}).select("*").single();
    if(error)setStatus(error.message);else if(data){setAttachment({message:data,url:signed.data?.signedUrl||""});setMessages(m=>[...m,data])}
  }
  async function recordVoice(){
    if(recording){mediaRecorder.current?.stop();setRecording(false);return}
    if(!navigator.mediaDevices?.getUserMedia){setStatus("Voice recording is not supported by this browser.");return}
    try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const mr=new MediaRecorder(stream);chunks.current=[];mr.ondataavailable=e=>e.data.size&&chunks.current.push(e.data);mr.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks.current,{type:mr.mimeType||"audio/webm"});const file=new File([blob],`voice-${Date.now()}.webm`,{type:blob.type});await uploadFile(file)};mediaRecorder.current=mr;mr.start();setRecording(true)}catch(e){setStatus(e.message||"Microphone permission was denied.")}
  }
  async function shareLocation(){
    if(!selected)return;
    if(!window.isSecureContext && location.hostname!=="localhost" && location.hostname!=="127.0.0.1"){
      setStatus("Location sharing needs HTTPS (or localhost) so the browser can securely provide your location.");return;
    }
    if(!navigator.geolocation){setStatus("Location sharing is not supported by this browser.");return;}
    setStatus("Getting your location…");
    navigator.geolocation.getCurrentPosition(async pos=>{
      const lat=Number(pos.coords.latitude.toFixed(6)),lng=Number(pos.coords.longitude.toFixed(6));
      const body=`📍 Shared location\n${lat}, ${lng}`;
      let result=await supabase.from("messages").insert({conversation_id:selected,sender_id:user.id,body,location_lat:lat,location_lng:lng}).select("*").single();
      if(result.error){result=await supabase.from("messages").insert({conversation_id:selected,sender_id:user.id,body}).select("*").single();}
      if(result.error)setStatus(result.error.message);
      else{setStatus("");if(result.data)setMessages(m=>m.some(x=>x.id===result.data.id)?m:[...m,result.data]);}
    },e=>{
      const msg=e.code===1?"Location permission was denied. Allow location access for Anvaya in your browser, then try again.":e.code===2?"Your location could not be determined.":e.code===3?"Location request timed out. Try again.":(e.message||"Could not get your location.");
      setStatus(msg);
    },{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
  }
  async function createPoll(){
    const opts=pollOptions.map(x=>x.trim()).filter(Boolean);
    if(!selected||!pollQuestion.trim()||opts.length<2){setStatus("Enter a question and at least two options.");return;}
    setStatus("");
    let {data:pollId,error}=await supabase.rpc("create_poll_v2",{p_conversation_id:selected,p_question:pollQuestion.trim(),p_options:opts,p_allow_multiple:false});
    if(error){
      const fallback=await supabase.rpc("create_poll",{p_conversation_id:selected,p_question:pollQuestion.trim(),p_options:opts,p_allow_multiple:false});
      pollId=fallback.data; error=fallback.error;
    }
    if(error){setStatus(error.message);return;}
    setPollOpen(false);setPollQuestion("");setPollOptions(["",""]);await loadMessages(selected);
  }

  async function votePoll(pollId,optionId){await supabase.from("poll_votes").upsert({poll_id:pollId,option_id:optionId,user_id:user.id},{onConflict:"poll_id,user_id"});}
  async function addReminder(m){setReminder({message:m,title:m.body.replace(/^📍\s*/,"").slice(0,70),date:"",time:""});setMenu(null)}
  function saveReminder(e){e.preventDefault();const f=new FormData(e.currentTarget);const arr=JSON.parse(localStorage.getItem(scopedEvents(user.id))||"[]");arr.unshift({id:Date.now(),title:f.get("title"),date:f.get("date"),time:f.get("time"),type:"Reminder"});localStorage.setItem(scopedEvents(user.id),JSON.stringify(arr));window.dispatchEvent(new CustomEvent("vyara:data-changed",{detail:{key:"events",userId:user.id}}));setReminder(null)}

  return <div className="h-full flex relative">
    <section className="w-[330px] border-r border-white/[.06] flex flex-col bg-[#16080f]/70">
      <div className="p-4"><div className="flex items-center justify-between mb-4"><h2 className="text-xl font-semibold">Chats</h2><div className="flex gap-1"><button onClick={openNewChat} className="icon-btn" title="New chat"><MessageSquare size={17}/></button><button onClick={openGroupCreator} className="icon-btn" title="Create group"><Users size={18}/></button></div></div><div className="relative"><Search size={16} className="absolute left-3 top-3 text-white/25"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search chats" className="w-full bg-white/[.035] border border-white/[.05] rounded-xl pl-9 pr-3 py-2.5 text-sm placeholder:text-white/25"/></div></div>
      <div className="overflow-auto scrollbar px-2">{loading?<div className="p-4 text-xs text-white/25">Loading conversations…</div>:filtered.length?filtered.map(c=><button key={c.id} onClick={()=>setSelected(c.id)} className={`w-full flex gap-3 p-3 rounded-2xl text-left ${selected===c.id?"bg-white/[.055]":"hover:bg-white/[.03]"}`}><Avatar profile={c.other}/><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><span className="font-medium text-sm truncate">{c.other.display_name||c.other.username}</span><span className="text-[9px] text-white/20">{c.lastReadAt?"":"new"}</span></div><div className="text-xs text-white/35 truncate mt-1">{c.kind==="group"?`${c.participants?.length||0} members`:`@${c.other.username}`}</div></div></button>):<div className="p-4 text-xs text-white/25">No conversations yet. Connect with someone in Find People first.</div>}</div>
    </section>
    <section className="flex-1 flex flex-col min-w-0 bg-[radial-gradient(circle_at_80%_10%,rgba(104,50,117,.13),transparent_32%),radial-gradient(circle_at_20%_90%,rgba(111,22,53,.13),transparent_30%)]">
      {!current?<div className="flex-1 grid place-items-center text-center p-8"><div><MessagePlaceholder/><h2 className="text-lg font-medium mt-4">No conversation selected</h2><p className="text-sm text-white/30 mt-2">Connect with another Anvaya user to start a private chat.</p></div></div>:<>
      <header className="h-[70px] shrink-0 border-b border-white/[.06] flex items-center px-5 justify-between bg-[#17080f]/60 backdrop-blur-xl"><div className="flex items-center gap-3"><Avatar profile={current.other}/><div><div className="font-medium">{current.other.display_name||current.other.username}</div><div className="text-[11px] text-emerald-300/70">{current.kind==="group"?`${current.participants?.length||0} members`:typing?"Typing…":online?"● Online":current.other.last_seen_enabled!==false&&lastSeen?`Last seen ${new Date(lastSeen).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}`:"Offline"}</div></div></div><div className="flex items-center gap-1"><Icon title="Search messages" Icon={Search} onClick={()=>setMessageSearch(messageSearch?"":" ")}/><Icon title="Chat details" Icon={MoreVertical} onClick={()=>setDetails(v=>!v)}/></div></header>
      {messageSearch!==""&&<div className="px-5 py-2 border-b border-white/[.05] bg-black/10"><div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-white/25"/><input autoFocus value={messageSearch.trim()} onChange={e=>setMessageSearch(e.target.value)} placeholder="Search messages…" className="search-input w-full pl-9"/></div></div>}
      <div ref={scrollRef} className="flex-1 overflow-auto scrollbar px-[7%] py-7 space-y-3">
        <div className="flex justify-center"><span className="text-[10px] px-3 py-1 rounded-full bg-white/[.035] text-white/25">Conversation</span></div>
        {visibleMessages.map((m,i)=><MessageBubble key={m.id} m={m} mine={m.sender_id===user.id} reactions={reactions[m.id]||{}} pinned={pins.includes(m.id)} menu={menu===m.id} onMenu={()=>setMenu(menu===m.id?null:m.id)} onReact={toggleReaction} onPin={()=>togglePin(m)} onThread={()=>setThread(m)} onEdit={()=>editMessage(m)} onDelete={()=>deleteMessage(m)} onAstra={onAstra} astraEnabled={astraEnabled} onReminder={addReminder} onVote={votePoll} user={user} delivery={deliveries[m.id]} showReadReceipts={myReadReceipts}/>) }
      </div>
      {status&&<div className="mx-6 mb-2 text-xs text-red-300/80 bg-red-950/30 border border-red-400/10 rounded-xl px-3 py-2">{status}</div>}
      <div className="p-4"><div className="max-w-5xl mx-auto relative">
        <div className="flex items-end gap-2 bg-[#21101a] border border-white/[.07] rounded-2xl p-2 shadow-glow">
          <button onClick={()=>fileRef.current?.click()} className="h-10 w-10 grid place-items-center text-white/45 hover:text-white" title="Attach file"><Paperclip size={19}/></button><input ref={fileRef} type="file" className="hidden" onChange={e=>{Array.from(e.target.files||[]).forEach(uploadFile);e.target.value=""}}/>
          <textarea rows="1" value={text} onChange={onTextChange} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}}} placeholder={recording?"Recording voice note…":"Message"} className="flex-1 bg-transparent resize-none px-2 py-2 text-sm max-h-28 placeholder:text-white/25"/>
          <button onClick={()=>setEmojiOpen(v=>!v)} className="h-10 w-10 grid place-items-center text-white/45 hover:text-white" title="Emoji"><Smile size={19}/></button>
          {!text?<button onClick={recordVoice} className={`h-10 w-10 grid place-items-center ${recording?"text-red-300":"text-white/45 hover:text-white"}`} title={recording?"Stop voice note":"Voice note"}>{recording?<Square size={17}/>:<Mic size={19}/>}</button>:<button onClick={send} className="h-10 w-10 rounded-xl bg-aurora-600 grid place-items-center" title="Send"><Send size={18}/></button>}
        </div>
        {mentionOpen&&<div className="absolute left-12 bottom-14 z-20 glass rounded-2xl p-2 w-56 max-h-64 overflow-auto"><div className="px-2 py-1 text-[9px] text-white/25 uppercase tracking-widest">Mention</div>{(current.participants||[]).map(p=><button key={p.user_id} onClick={()=>mention(p.username)} className="w-full text-left p-2 rounded-xl hover:bg-white/5 text-sm">@{p.username}</button>)}<button onClick={()=>mention("everyone")} className="w-full text-left p-2 rounded-xl hover:bg-white/5 text-sm">@everyone</button></div>}
        {emojiOpen&&<div className="absolute right-12 bottom-14 z-20 w-72 glass rounded-2xl p-3 grid grid-cols-10 gap-1">{EMOJIS.map(e=><button key={e} onClick={()=>addEmoji(e)} className="h-8 w-8 rounded-lg hover:bg-white/10 text-lg">{e}</button>)}</div>}
        <div className="flex items-center justify-between mt-2"><div className="text-[9px] text-white/20">🔒 Private delivery · Supabase Realtime</div><div className="flex gap-1"><SmallAction title="Poll" Icon={BarChart3} onClick={()=>setPollOpen(true)}/><SmallAction title="Share location" Icon={MapPin} onClick={shareLocation}/><SmallAction title="Mention" Icon={AtSign} onClick={()=>setText(t=>t+"@")} /></div></div>
      </div></div>
      </>}
    </section>
    {details&&<DetailsPanel messages={messages} media={media} files={files} links={links} pins={pins} onClose={()=>setDetails(false)} onJump={id=>{setDetails(false);document.getElementById(`message-${id}`)?.scrollIntoView({behavior:"smooth",block:"center"})}}/>}
    {thread&&<ThreadPanel root={thread} messages={messages} onClose={()=>setThread(null)} user={user} onSend={async body=>{await supabase.from("messages").insert({conversation_id:selected,sender_id:user.id,body,parent_message_id:thread.id});loadMessages(selected)}}/>}
    {pollOpen&&<Overlay title="Create poll" onClose={()=>setPollOpen(false)}><input className="form-input" value={pollQuestion} onChange={e=>setPollQuestion(e.target.value)} placeholder="Ask a question" autoFocus/>{pollOptions.map((o,i)=><div key={i} className="flex gap-2"><input className="form-input flex-1" value={o} onChange={e=>setPollOptions(a=>a.map((x,j)=>j===i?e.target.value:x))} placeholder={`Option ${i+1}`}/>{pollOptions.length>2&&<button type="button" onClick={()=>setPollOptions(a=>a.filter((_,j)=>j!==i))} className="icon-btn !h-10 !w-10" title="Remove option"><X size={15}/></button>}</div>)}<button type="button" onClick={()=>setPollOptions(a=>[...a,""])} className="w-full h-10 rounded-xl border border-white/[.07] bg-white/[.025] text-white/50 hover:text-white flex items-center justify-center gap-2"><Plus size={16}/> Add option</button><button className="btn-primary w-full" onClick={createPoll}>Create poll</button></Overlay>}
    {newChatOpen&&<Overlay title="New chat" onClose={()=>setNewChatOpen(false)}><div className="text-[10px] text-white/30">Choose one of your accepted connections to start a private chat.</div><div className="max-h-64 overflow-auto space-y-1">{newChatBusy?<div className="p-3 text-xs text-white/30">Loading connections…</div>:newChatCandidates.length?newChatCandidates.map(p=><button key={p.user_id} onClick={()=>startDirectChat(p.user_id)} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 text-left"><Avatar profile={p} small/><div><div className="text-sm">{p.display_name||p.username}</div><div className="text-[10px] text-white/25">@{p.username}</div></div></button>):<div className="p-3 text-xs text-white/30">No accepted connections yet. Use Find people first.</div>}</div></Overlay>}
    {groupOpen&&<Overlay title="Create group" onClose={()=>setGroupOpen(false)}><input className="form-input" value={groupTitle} onChange={e=>setGroupTitle(e.target.value)} placeholder="Group name" autoFocus/><div className="text-[10px] text-white/30">Choose people from your accepted connections.</div><div className="max-h-64 overflow-auto space-y-1">{groupCandidates.map(p=><label key={p.user_id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 cursor-pointer"><input type="checkbox" checked={groupSelected.includes(p.user_id)} onChange={e=>setGroupSelected(a=>e.target.checked?[...a,p.user_id]:a.filter(x=>x!==p.user_id))}/><Avatar profile={p} small/><div><div className="text-sm">{p.display_name||p.username}</div><div className="text-[10px] text-white/25">@{p.username}</div></div></label>)}</div><button className="btn-primary w-full" onClick={createGroup}>Create group</button></Overlay>}
    {reminder&&<Overlay title="Create reminder" onClose={()=>setReminder(null)}><form onSubmit={saveReminder} className="space-y-3"><input name="title" defaultValue={reminder.title} className="form-input" placeholder="Reminder" required/><input name="date" type="date" className="form-input" required/><input name="time" type="time" className="form-input" required/><button className="btn-primary w-full">Save reminder</button></form></Overlay>}
  </div>;
}

function MessageBubble({m,mine,reactions,pinned,menu,onMenu,onReact,onPin,onThread,onEdit,onDelete,onAstra,astraEnabled,onReminder,onVote,user,delivery,showReadReceipts}){
  const [reactionOpen,setReactionOpen]=useState(false),[poll,setPoll]=useState(null),[votes,setVotes]=useState([]);
  useEffect(()=>{if(!m.poll_id)return;Promise.all([supabase.from("polls").select("id,question").eq("id",m.poll_id).maybeSingle(),supabase.from("poll_options").select("id,label").eq("poll_id",m.poll_id),supabase.from("poll_votes").select("option_id,user_id").eq("poll_id",m.poll_id)]).then(([p,o,v])=>{setPoll({...p.data,options:o.data||[]});setVotes(v.data||[])})},[m.poll_id]);
  const isDeleted=!!m.deleted_at;
  const locMatch=(m.body||"").match(/📍 Shared location\s*\n?(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  const locationLat=m.location_lat!=null?m.location_lat:(locMatch?Number(locMatch[1]):null);
  const locationLng=m.location_lng!=null?m.location_lng:(locMatch?Number(locMatch[2]):null);
  const location=locationLat!=null&&locationLng!=null?`https://www.google.com/maps/search/?api=1&query=${locationLat},${locationLng}`:null;
  const url=(m.body||"").match(/https?:\/\/\S+/)?.[0];
  return <div id={`message-${m.id}`} className={`flex ${mine?"justify-end":"justify-start"}`}><div className={`relative max-w-[72%] ${mine ? "bg-gradient-to-br from-[#12614a] to-[#173f35] message-out" : "bg-[#24121b] message-in"} border border-white/[.05] px-4 py-2.5 group`}>
    {pinned&&<div className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-emerald-400/20 text-emerald-200 grid place-items-center"><Pin size={10}/></div>}
    {m.parent_message_id&&<div className="text-[10px] text-white/35 border-l-2 border-emerald-300/30 pl-2 mb-2">Replying in thread</div>}
    {m.attachment_url&&m.attachment_type?.startsWith("image/")&&<ChatImage path={m.attachment_url}/>} 
    {m.attachment_url&&m.attachment_type==="audio/webm"&&<VoicePlayer path={m.attachment_url}/>} 
    {m.attachment_url&&!m.attachment_type?.startsWith("image/")&&m.attachment_type!=="audio/webm"&&<AttachmentCard m={m}/>} 
    {m.body&&<div className={`text-sm leading-6 ${isDeleted?"italic text-white/30":""}`}>{highlightUrl(m.body,url)}</div>}
    {location&&<a href={location} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 text-xs text-emerald-200 underline underline-offset-4"><MapPin size={13}/> Open shared location</a>}
    {poll&&<div className="mt-3 p-3 rounded-xl bg-black/15 border border-white/[.06]"><div className="font-medium text-sm">{poll.question}</div>{poll.options.map(o=>{const count=votes.filter(v=>v.option_id===o.id).length;return <button key={o.id} onClick={()=>{onVote(poll.id,o.id);setVotes(v=>[...v.filter(x=>x.user_id!==user.id),{option_id:o.id,user_id:user.id}])}} className="w-full text-left mt-2 p-2 rounded-lg bg-white/[.04] hover:bg-white/[.08] text-xs flex justify-between"><span>{o.label}</span><span className="text-white/30">{count}</span></button>})}</div>}
    {Object.keys(reactions).length>0&&<div className="flex gap-1 mt-2">{Object.entries(reactions).map(([r,c])=><button key={r} onClick={()=>onReact(m,r)} className="text-[11px] px-1.5 py-0.5 rounded-full bg-black/20 border border-white/[.06]">{r} {c}</button>)}</div>}
    <div className="flex justify-end gap-1 items-center mt-1 text-[9px] text-white/30">{m.edited_at&&"edited · "}{new Date(m.created_at).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}{mine&&(m.deleted_at?<Check size={12}/>:showReadReceipts&&delivery?.read_at?<CheckCheck size={13} className="text-emerald-200/80" title="Read"/>:delivery?.delivered_at?<CheckCheck size={13} className="text-white/40" title="Delivered"/>:<Check size={12} className="text-white/35" title="Sent"/>)}</div>
    <button onClick={onMenu} className="absolute -right-9 top-2 text-white/35 opacity-0 group-hover:opacity-100 transition"><MoreVertical size={15}/></button>
    {menu&&<div className={`absolute z-30 ${mine?"right-0":"left-0"} top-full mt-1 w-56 glass rounded-2xl p-1.5`}>
      <div className="flex gap-1 p-1">{REACTIONS.map(r=><button key={r} onClick={()=>onReact(m,r)} className="h-8 w-8 rounded-lg hover:bg-white/10">{r}</button>)}</div>
      <MenuItem icon={Reply} label="Reply in thread" onClick={onThread}/><MenuItem icon={pinned?PinOff:Pin} label={pinned?"Unpin message":"Pin message"} onClick={onPin}/><MenuItem icon={Sparkles} label="Ask Astra" disabled={!astraEnabled} onClick={()=>onAstra(m.body)}/><MenuItem icon={Bell} label="Create reminder" onClick={()=>onReminder(m)}/><MenuItem icon={Cake} label="Remember birthday" onClick={()=>onReminder({...m,body:"Birthday: "+m.body})}/><MenuItem icon={CalendarPlus} label="Add to calendar" onClick={()=>onReminder(m)}/><MenuItem icon={Wallet} label="Payment reminder" onClick={()=>onReminder({...m,body:"Payment: "+m.body})}/>{mine&&<><MenuItem icon={FileText} label="Edit message" onClick={onEdit}/><MenuItem icon={X} label="Delete message" onClick={onDelete}/></>}
    </div>}
    {reactionOpen&&null}
  </div></div>
}

function groupReactions(rows){const out={};for(const r of rows){out[r.message_id]??={};out[r.message_id][r.reaction]=(out[r.message_id][r.reaction]||0)+1}return out}
function highlightUrl(text,url){if(!url)return text;const parts=text.split(url);return <>{parts.map((p,i)=><span key={i}>{p}{i<parts.length-1&&<a href={url} target="_blank" rel="noreferrer" className="text-emerald-200 underline underline-offset-2">{url}</a>}</span>)}</>}
async function signedMedia(path){if(!path)return"";if(path.startsWith("http"))return path;const {data}=await supabase.storage.from(CHAT_BUCKET).createSignedUrl(path,3600);return data?.signedUrl||""}
function ChatImage({path}){const [url,setUrl]=useState("");useEffect(()=>{signedMedia(path).then(setUrl)},[path]);return url?<img alt="" src={url} className="max-h-72 rounded-xl object-cover mb-2"/>:<div className="h-32 rounded-xl bg-white/5 mb-2 grid place-items-center"><ImageIcon size={24}/></div>}
function VoicePlayer({path}){const [url,setUrl]=useState(""),[playing,setPlaying]=useState(false),ref=useRef(null);useEffect(()=>{signedMedia(path).then(setUrl)},[path]);if(!url)return <div className="text-xs text-white/30">Loading voice note…</div>;return <div className="flex items-center gap-2 min-w-[210px] mb-2"><button onClick={()=>{if(playing)ref.current?.pause();else ref.current?.play();setPlaying(!playing)}} className="h-9 w-9 rounded-full bg-white/10 grid place-items-center">{playing?<Pause size={15}/>:<Play size={15}/>}</button><div className="h-1.5 flex-1 bg-white/10 rounded-full"/><audio ref={ref} src={url} onEnded={()=>setPlaying(false)} className="hidden"/></div>}
function AttachmentCard({m}){const [url,setUrl]=useState("");useEffect(()=>{signedMedia(m.attachment_url).then(setUrl)},[m.attachment_url]);return <a href={url||"#"} target="_blank" rel="noreferrer" className="flex items-center gap-3 p-3 rounded-xl bg-black/15 border border-white/[.06] mb-2"><div className="h-9 w-9 rounded-lg bg-white/5 grid place-items-center"><File size={16}/></div><div className="min-w-0"><div className="text-xs truncate">{m.attachment_name||"Attachment"}</div><div className="text-[9px] text-white/25">Open file</div></div></a>}
function DetailsPanel({messages,media,files,links,pins,onClose,onJump}){return <aside className="absolute right-0 top-0 bottom-0 w-[350px] max-w-full z-40 bg-[#13070e]/96 backdrop-blur-2xl border-l border-white/[.07] shadow-2xl p-5 overflow-auto"><div className="flex items-center justify-between"><div><div className="font-semibold">Chat details</div><div className="text-[10px] text-white/25 mt-1">{messages.length} messages</div></div><button onClick={onClose} className="icon-btn"><X size={16}/></button></div><DetailSection title="Pinned" icon={Pin}>{pins.length?pins.map(id=><button key={id} onClick={()=>onJump(id)} className="w-full text-left p-2 rounded-xl hover:bg-white/5 text-xs">📌 Pinned message</button>):<Empty text="No pinned messages"/>}</DetailSection><DetailSection title="Media" icon={ImageIcon}>{media.length?<div className="grid grid-cols-3 gap-2">{media.map(m=><ChatImage key={m.id} path={m.attachment_url}/>)}</div>:<Empty text="No shared media yet"/>}</DetailSection><DetailSection title="Files" icon={FolderOpen}>{files.length?files.map(m=><AttachmentCard key={m.id} m={m}/>):<Empty text="No files yet"/>}</DetailSection><DetailSection title="Links" icon={Link2}>{links.length?links.map(m=><button key={m.id} onClick={()=>onJump(m.id)} className="w-full text-left p-2 rounded-xl hover:bg-white/5 text-xs truncate">{(m.body.match(/https?:\/\/\S+/)||[m.body])[0]}</button>):<Empty text="No links yet"/>}</DetailSection></aside>}
function DetailSection({title,icon:I,children}){return <section className="mt-6"><div className="flex items-center gap-2 text-xs text-white/45 mb-2"><I size={14}/>{title}</div>{children}</section>}
function Empty({text}){return <div className="text-[11px] text-white/20 p-3 rounded-xl bg-white/[.02]">{text}</div>}
function ThreadPanel({root,messages,onClose,user,onSend}){const replies=messages.filter(m=>m.parent_message_id===root.id);const [text,setText]=useState("");return <aside className="absolute right-0 top-0 bottom-0 w-[390px] max-w-full z-40 bg-[#13070e]/97 backdrop-blur-2xl border-l border-white/[.07] shadow-2xl flex flex-col"><div className="p-5 border-b border-white/[.06] flex items-center justify-between"><div><div className="font-semibold">Thread</div><div className="text-[10px] text-white/25 mt-1">{replies.length} repl{replies.length===1?"y":"ies"}</div></div><button onClick={onClose} className="icon-btn"><X size={16}/></button></div><div className="p-5 border-b border-white/[.05]"><div className="text-sm">{root.body}</div><div className="text-[9px] text-white/25 mt-2">{new Date(root.created_at).toLocaleString()}</div></div><div className="flex-1 overflow-auto p-5 space-y-3">{replies.map(r=><div key={r.id} className={`p-3 rounded-2xl ${r.sender_id===user.id?"bg-emerald-900/20":"bg-white/[.03]"}`}><div className="text-sm">{r.body}</div><div className="text-[9px] text-white/20 mt-1">{new Date(r.created_at).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</div></div>)}</div><form onSubmit={e=>{e.preventDefault();if(text.trim()){onSend(text.trim());setText("")}}} className="p-4 border-t border-white/[.06] flex gap-2"><input value={text} onChange={e=>setText(e.target.value)} className="form-input" placeholder="Reply…"/><button className="btn-primary px-3"><Send size={16}/></button></form></aside>}
function Overlay({title,onClose,children}){return <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-md grid place-items-center p-4"><div className="w-full max-w-md glass rounded-3xl p-6"><div className="flex items-center justify-between mb-5"><div className="font-semibold">{title}</div><button onClick={onClose} className="icon-btn"><X size={16}/></button></div><div className="space-y-3">{children}</div></div></div>}
function Icon({title,Icon:I,onClick}){return <button onClick={onClick} title={title} className="h-10 w-10 grid place-items-center rounded-xl text-white/45 hover:text-white hover:bg-white/5"><I size={18}/></button>}
function SmallAction({title,Icon:I,onClick}){return <button onClick={onClick} title={title} className="h-7 w-7 grid place-items-center rounded-lg text-white/25 hover:text-emerald-200 hover:bg-white/5"><I size={13}/></button>}
function MenuItem({icon:I,label,onClick,disabled=false}){return <button disabled={disabled} onClick={onClick} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"><I size={16}/><span>{label}</span></button>}
function MessagePlaceholder(){return <div className="h-16 w-16 rounded-2xl bg-white/[.035] border border-white/[.06] grid place-items-center mx-auto"><Send size={24} className="text-white/25"/></div>}
