import { useState, useEffect, useRef } from "react";

function cleanText(raw) {
  const s = raw.indexOf("*** START OF");
  const e = raw.lastIndexOf("*** END OF");
  let t = raw;
  if (s !== -1) t = t.slice(raw.indexOf("\n", s) + 1);
  if (e !== -1) t = t.slice(0, t.lastIndexOf("\n", e));
  return t.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/_{4,}/g, "").trim();
}

function toChunks(text, max = 340) {
  const paras = text.split(/\n\n+/);
  const chunks = [];
  let buf = "";
  for (const p of paras) {
    const para = p.replace(/\n/g, " ").trim();
    if (!para || para.length < 5) continue;
    if (para.length > max) {
      if (buf) { chunks.push(buf.trim()); buf = ""; }
      const parts = para.split(/([.!?…»])\s+/).filter(Boolean);
      let sub = "";
      for (const part of parts) {
        if (sub.length + part.length > max && sub) { chunks.push(sub.trim()); sub = part; }
        else sub += part;
      }
      if (sub.trim()) chunks.push(sub.trim());
    } else {
      if (buf.length + para.length > max && buf) { chunks.push(buf.trim()); buf = para; }
      else buf += (buf ? " " : "") + para;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter(c => c.trim().length > 10);
}

async function gutendex(q) {
  const r = await fetch(`https://gutendex.com/books/?languages=fr&search=${encodeURIComponent(q)}`);
  const d = await r.json();
  return (d.results || []).slice(0, 10);
}
async function gutendexById(id) {
  try { const r = await fetch(`https://gutendex.com/books/${id}`); if (r.ok) return await r.json(); } catch {}
  return null;
}
async function loadText(bk) {
  const f = bk.formats || {};
  const url = f["text/plain; charset=utf-8"] || f["text/plain; charset=iso-8859-1"] || f["text/plain"];
  if (!url) return null;
  for (const proxy of [`https://corsproxy.io/?${encodeURIComponent(url)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`]) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 22000);
      const r = await fetch(proxy, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) return await r.text();
    } catch {}
  }
  return null;
}

const bmSave = (id, title, idx, total) => { const b = JSON.parse(localStorage.getItem("vb")||"{}"); b[String(id)]={title,idx,total,ts:Date.now()}; localStorage.setItem("vb",JSON.stringify(b)); };
const bmGet  = (id) => (JSON.parse(localStorage.getItem("vb")||"{}"))[String(id)]||null;
const bmAll  = ()   => JSON.parse(localStorage.getItem("vb")||"{}");
const bmDel  = (id) => { const b=bmAll(); delete b[String(id)]; localStorage.setItem("vb",JSON.stringify(b)); };

const CATS = [
  {id:"romans",   name:"Romans",                     q:"roman fiction"},
  {id:"voyage",   name:"Voyage",                      q:"voyage guide"},
  {id:"business", name:"Business et Argent",          q:"économie commerce"},
  {id:"dev",      name:"Développement personnel",     q:"philosophie morale sagesse"},
  {id:"sante",    name:"Santé et Bien-être",          q:"médecine hygiène"},
  {id:"info",     name:"Informatique et Technologie", q:"science technologie"},
  {id:"arts",     name:"Arts et Loisirs",             q:"art musique"},
  {id:"edu",      name:"Éducation",                   q:"éducation pédagogie"},
  {id:"jeunesse", name:"Jeunesse",                    q:"conte enfant"},
  {id:"people",   name:"People et Divertissement",    q:"biographie célébrité"},
  {id:"religion", name:"Religion et Spiritualité",    q:"religion spiritualité"},
  {id:"bio",      name:"Biographies et Mémoires",     q:"mémoires autobiographie"},
];

const NUMS = {"premier":0,"première":0,"un":0,"une":0,"1":0,"deuxième":1,"deux":1,"2":1,"troisième":2,"trois":2,"3":2,"quatrième":3,"quatre":3,"4":3,"cinquième":4,"cinq":4,"5":4,"sixième":5,"six":5,"6":5,"septième":6,"sept":6,"7":6,"huitième":7,"huit":7,"8":7,"neuvième":8,"neuf":8,"9":8,"dixième":9,"dix":9,"10":9};

const KWCAT = {"roman":"romans","fiction":"romans","aventure":"romans","policier":"romans","thriller":"romans","romance":"romans","horreur":"romans","drame":"romans","fantastique":"romans","fantasy":"romans","historique":"romans","science-fiction":"romans","voyage":"voyage","guide":"voyage","expatriation":"voyage","carnet":"voyage","business":"business","argent":"business","investissement":"business","marketing":"business","commerce":"business","entrepreneuriat":"business","immobilier":"business","développement":"dev","motivation":"dev","confiance":"dev","productivité":"dev","leadership":"dev","habitudes":"dev","santé":"sante","bien-être":"sante","méditation":"sante","nutrition":"sante","sport":"sante","sommeil":"sante","informatique":"info","technologie":"info","programmation":"info","intelligence":"info","cybersécurité":"info","art":"arts","arts":"arts","musique":"arts","dessin":"arts","cuisine":"arts","photographie":"arts","jardinage":"arts","éducation":"edu","langues":"edu","mathématiques":"edu","sciences":"edu","géographie":"edu","jeunesse":"jeunesse","enfant":"jeunesse","enfants":"jeunesse","conte":"jeunesse","adolescent":"jeunesse","people":"people","célébrité":"people","célébrités":"people","cinéma":"people","télévision":"people","mode":"people","religion":"religion","islam":"religion","christianisme":"religion","bouddhisme":"religion","spiritualité":"religion","biographie":"bio","biographies":"bio","mémoires":"bio","autobiographie":"bio"};

const SC = {
  idle:      {color:"#FFD700",emoji:"📚",short:"TOUCHEZ"},
  listening: {color:"#FF4757",emoji:"🎙️", short:"ÉCOUTE…"},
  processing:{color:"#FFA502",emoji:"⚙️", short:"TRAITEMENT…"},
  speaking:  {color:"#2ED573",emoji:"🔊", short:"JE PARLE…"},
  reading:   {color:"#54A0FF",emoji:"🎧", short:"LECTURE"},
  paused:    {color:"#FF6348",emoji:"⏸️", short:"PAUSE"},
};

export default function VocaBook() {
  const [appState, setAppState] = useState("idle");
  const [label,    setLabel]    = useState("Bienvenue sur VocaBook");
  const [progress, setProgress] = useState(0);
  const [infoLine, setInfoLine] = useState("");

  const R = useRef({
    synth: typeof window!=="undefined" ? window.speechSynthesis : null,
    voice:null, reading:false, cidx:0, chunks:[], book:null, books:[], asst:false, history:[], state:"idle",
  });
  const S = (s) => { R.current.state=s; setAppState(s); };

  useEffect(() => {
    const pick = () => {
      const vs = R.current.synth.getVoices();
      R.current.voice = vs.find(v=>v.lang==="fr-FR"&&!/thomas|nicolas|pierre|julien|antoine/i.test(v.name))||vs.find(v=>v.lang.startsWith("fr"))||vs[0]||null;
    };
    pick();
    R.current.synth.addEventListener("voiceschanged", pick);
    return () => R.current.synth.removeEventListener("voiceschanged", pick);
  }, []);

  const speak = (text, cb) => {
    R.current.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang="fr-FR"; if(R.current.voice) u.voice=R.current.voice;
    u.rate=0.82; u.pitch=1.15; u.volume=1;
    u.onend=cb||null; u.onerror=()=>{if(cb)cb();};
    S("speaking"); setLabel(text.length>85?text.slice(0,82)+"…":text);
    R.current.synth.speak(u);
  };

  const readFrom = (startIdx) => {
    R.current.reading=true; S("reading"); setLabel("Lecture en cours…");
    const go = (i) => {
      if(!R.current.reading) return;
      if(i>=R.current.chunks.length){
        R.current.reading=false; setProgress(100);
        if(R.current.book) bmDel(R.current.book.id);
        speak("Livre terminé ! Félicitations. Touchez pour explorer d'autres livres.",()=>{S("idle");setLabel("Touchez n'importe où pour commencer.");});
        return;
      }
      R.current.cidx=i;
      const pct=Math.round((i/R.current.chunks.length)*100);
      setProgress(pct); setInfoLine(`${pct}% — ${R.current.book?.title||""}`);
      if(i%5===0&&R.current.book) bmSave(R.current.book.id,R.current.book.title,i,R.current.chunks.length);
      const u=new SpeechSynthesisUtterance(R.current.chunks[i]);
      u.lang="fr-FR"; if(R.current.voice) u.voice=R.current.voice;
      u.rate=0.82; u.pitch=1.15; u.volume=1;
      u.onend=()=>{if(R.current.reading)go(i+1);}; u.onerror=()=>{if(R.current.reading)go(i+1);};
      R.current.synth.speak(u);
    };
    go(startIdx);
  };

  const loadAndRead = async (bk, forceIdx) => {
    R.current.book=bk;
    const bm=(forceIdx==null)?bmGet(bk.id):null;
    const start=bm?bm.idx:(forceIdx||0);
    const msg=bm?`Reprise à ${Math.round(bm.idx/bm.total*100)} pourcent.`:"Début de la lecture.";
    speak(`Chargement de ${bk.title}. ${msg} Veuillez patienter.`); setInfoLine(`Chargement : ${bk.title}`);
    try {
      const raw=await loadText(bk);
      if(!raw){speak("Impossible de charger ce livre. Essayez un autre titre.");return;}
      R.current.chunks=toChunks(cleanText(raw),340);
      if(!R.current.chunks.length){speak("Ce livre ne contient pas de texte lisible.");return;}
      R.current.cidx=start; setProgress(Math.round(start/R.current.chunks.length*100));
      const author=bk.authors?.[0]?.name||"auteur inconnu";
      speak(`Lecture de ${bk.title}, par ${author}.`,()=>readFrom(start));
    } catch { speak("Erreur lors du chargement. Vérifiez votre connexion internet."); }
  };

  const loadCategory = async (cat) => {
    speak(`Chargement de la catégorie ${cat.name}…`);
    try {
      const results=await gutendex(cat.q); R.current.books=results;
      if(!results.length){speak(`Aucun livre trouvé dans ${cat.name}.`);return;}
      const list=results.slice(0,5).map((b,i)=>`${i+1} : ${b.title} par ${b.authors?.[0]?.name||"auteur inconnu"}`).join(". ");
      speak(`${results.length} livres dans ${cat.name}. Voici les premiers : ${list}. Dites un numéro pour écouter.`);
    } catch { speak("Erreur de chargement. Vérifiez votre connexion internet."); }
  };

  const processCmd = async (cmd) => {
    R.current.reading=false;
    const c=cmd.toLowerCase().trim();
    S("processing"); setLabel(`"${cmd.slice(0,55)}"`);

    if(/\b(retour|menu|accueil)\b/.test(c)){R.current.asst=false;R.current.synth.cancel();S("idle");speak("Retour à l'accueil. Touchez pour continuer.");return;}
    if(/\b(bibliothèque|catégorie|catégories|liste)\b/.test(c)){const names=CATS.map((ct,i)=>`${i+1} : ${ct.name}`).join(". ");speak(`Voici les ${CATS.length} catégories : ${names}. Dites le numéro ou le nom.`);return;}
    if(/\b(marque.page|signet|sauvegarder|enregistrer)\b/.test(c)){if(R.current.book&&R.current.chunks.length){const pct=Math.round(R.current.cidx/R.current.chunks.length*100);bmSave(R.current.book.id,R.current.book.title,R.current.cidx,R.current.chunks.length);speak(`Marque-page enregistré à ${pct} pourcent du livre ${R.current.book.title}.`);}else speak("Aucun livre en cours de lecture.");return;}
    if(/\b(mes marque.pages|mes lectures|reprendre ma lecture|où j'en étais)\b/.test(c)){const bm=bmAll();const keys=Object.keys(bm);if(!keys.length){speak("Aucun marque-page. Lisez un livre et dites marque-page pour sauvegarder.");return;}R.current.books=keys.map(k=>({id:k,title:bm[k].title,_bm:bm[k]}));const list=keys.slice(0,5).map((k,i)=>{const b=bm[k];return`${i+1} : ${b.title}, à ${Math.round(b.idx/b.total*100)} pourcent`;}).join(". ");speak(`Vous avez ${keys.length} marque-page${keys.length>1?"s":""} : ${list}. Dites un numéro pour reprendre.`);return;}
    if(/\b(assistant|sophie|aide|discuter|parler)\b/.test(c)){R.current.asst=true;speak("Mode assistant activé. Bonjour ! Je suis Sophie, votre assistante VocaBook. Comment puis-je vous aider ?");return;}
    if(/\b(quitter.*assistant|mode bibliothèque|désactiver)\b/.test(c)){R.current.asst=false;speak("Mode bibliothèque. Touchez pour chercher des livres.");return;}
    if(/\b(pause|stop|arrêt|arrêter|interrompre)\b/.test(c)){R.current.synth.cancel();S("paused");setLabel("En pause");speak("Lecture en pause. Dites reprendre pour continuer, ou marque-page pour sauvegarder.");return;}
    if(/\b(reprendre|continuer|suite|relancer)\b/.test(c)){if(R.current.chunks.length){const pct=Math.round(R.current.cidx/R.current.chunks.length*100);speak(`Reprise à ${pct} pourcent.`,()=>readFrom(R.current.cidx));}else speak("Aucune lecture à reprendre. Choisissez un livre dans la bibliothèque.");return;}
    if(/\b(suivant|page suivante|chapitre suivant|prochain)\b/.test(c)){if(R.current.chunks.length)speak("Page suivante.",()=>readFrom(Math.min(R.current.cidx+1,R.current.chunks.length-1)));else speak("Aucune lecture en cours.");return;}
    if(/\b(précédent|page précédente|retour en arrière|reculer)\b/.test(c)){if(R.current.chunks.length)speak("Page précédente.",()=>readFrom(Math.max(R.current.cidx-1,0)));else speak("Aucune lecture en cours.");return;}

    if(R.current.asst){
      speak("Laissez-moi réfléchir un instant…");
      R.current.history.push({role:"user",content:cmd});
      try {
        const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:300,system:"Tu t'appelles Sophie. Tu es l'assistante vocale douce et bienveillante de VocaBook, une bibliothèque audio pour les personnes malvoyantes. Réponds uniquement en français avec chaleur et douceur. Limite tes réponses à 2 ou 3 phrases courtes maximum car elles seront lues à voix haute. Tu recommandes des livres, expliques des genres littéraires, ou réponds aux questions de l'utilisateur.",messages:R.current.history})});
        const d=await res.json();
        const reply=d.content?.[0]?.text||"Je suis désolée, je n'ai pas pu répondre.";
        R.current.history.push({role:"assistant",content:reply});
        speak(reply,()=>{S("idle");setLabel("Touchez pour poser une autre question.");});
      } catch { speak("Je suis désolée, connexion impossible. Vérifiez votre réseau."); }
      return;
    }

    const numKey=Object.keys(NUMS).find(n=>new RegExp(`\\b${n}\\b`,"i").test(c));
    if(numKey!==undefined){
      const idx=NUMS[numKey];
      if(R.current.books.length>idx&&R.current.books[idx]){
        const sel=R.current.books[idx];
        if(sel._bm){speak(`Chargement de ${sel.title}. Reprise à ${Math.round(sel._bm.idx/sel._bm.total*100)} pourcent.`);try{const bk=await gutendexById(sel.id)||(await gutendex(sel.title))[0];if(bk)await loadAndRead(bk,sel._bm.idx);else speak("Impossible de retrouver ce livre.");}catch{speak("Erreur lors du chargement.");}}
        else await loadAndRead(sel);
        return;
      }
      if(CATS[idx]){await loadCategory(CATS[idx]);return;}
    }

    const catByName=CATS.find(ct=>c.includes(ct.name.toLowerCase()));
    if(catByName){await loadCategory(catByName);return;}
    const kw=Object.keys(KWCAT).find(k=>c.includes(k));
    if(kw){const cat=CATS.find(ct=>ct.id===KWCAT[kw]);if(cat){await loadCategory(cat);return;}}

    const sm=c.match(/^(?:lire|écouter|chercher|trouver|jouer|je veux|je voudrais)\s+(.+)/i);
    if(sm){const q=sm[1].trim();if(q.length>2){speak(`Recherche de "${q}"…`);try{const res=await gutendex(q);if(!res.length){speak("Aucun livre trouvé pour cette recherche.");return;}R.current.books=res;const list=res.slice(0,5).map((b,i)=>`${i+1} : ${b.title} par ${b.authors?.[0]?.name||"auteur inconnu"}`).join(". ");speak(`J'ai trouvé ${res.length} résultats. Voici les premiers : ${list}. Dites un numéro pour écouter.`);}catch{speak("Erreur lors de la recherche.");}return;}}

    speak("Je n'ai pas compris. Dites bibliothèque pour voir les catégories, lire suivi d'un titre, ou assistant pour me parler.");
  };

  const startListening = () => {
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){speak("La reconnaissance vocale n'est pas disponible. Essayez Chrome ou Edge.");return;}
    R.current.synth.cancel(); S("listening"); setLabel("Je vous écoute…");
    const rec=new SR();
    rec.lang="fr-FR"; rec.continuous=false; rec.interimResults=false; rec.maxAlternatives=3;
    rec.onresult=(e)=>processCmd(e.results[0][0].transcript);
    rec.onerror=()=>{S("idle");setLabel("Je n'ai pas entendu. Touchez pour réessayer.");};
    rec.onend=()=>{if(R.current.state==="listening"){S("idle");setLabel("Touchez n'importe où pour continuer.");}};
    try{rec.start();}catch{}
  };

  const handleTap = (e) => {
    e&&e.preventDefault&&e.preventDefault();
    const s=R.current.state;
    if(s==="reading"){R.current.reading=false;R.current.synth.cancel();S("paused");setLabel("En pause — dites reprendre ou marque-page.");speak("Pause.",()=>startListening());}
    else if(s==="listening"||s==="processing") return;
    else if(s==="speaking"){R.current.synth.cancel();setTimeout(startListening,180);}
    else startListening();
  };

  useEffect(()=>{
    const t=setTimeout(()=>{speak("Bienvenue sur VocaBook. Je suis Sophie, votre assistante vocale. Touchez n'importe où pour explorer votre bibliothèque.",()=>{S("idle");setLabel("Touchez n'importe où pour commencer.");});},700);
    return()=>clearTimeout(t);
  },[]);

  useEffect(()=>{
    const onKey=(e)=>{if(["Space","Enter"].includes(e.code)){e.preventDefault();handleTap({preventDefault:()=>{}});}};
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[]);

  const sc=SC[appState]||SC.idle;
  const isActive=["reading","listening"].includes(appState);
  const showBar=["reading","paused"].includes(appState);

  return (
    <div onClick={handleTap} style={{position:"fixed",inset:0,background:"#080808",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",userSelect:"none",cursor:"pointer",fontFamily:"'Segoe UI',Arial,sans-serif",overflow:"hidden",touchAction:"manipulation",WebkitTapHighlightColor:"transparent"}}>
      <div style={{position:"absolute",inset:0,pointerEvents:"none",background:`radial-gradient(ellipse 72% 72% at 50% 50%, ${sc.color}1C 0%, transparent 68%)`,transition:"background 0.8s ease"}}/>
      <div style={{position:"absolute",top:36,textAlign:"center",zIndex:10,pointerEvents:"none"}}>
        <div style={{color:"#FFD700",fontSize:22,fontWeight:900,letterSpacing:9,textShadow:"0 0 30px #FFD70066, 0 0 70px #FFD70020"}}>VOCABOOK</div>
        <div style={{color:"#272727",fontSize:9,letterSpacing:4,marginTop:5}}>BIBLIOTHÈQUE AUDIO POUR MALVOYANTS</div>
      </div>
      <div style={{position:"absolute",pointerEvents:"none",width:"80vw",height:"80vw",maxWidth:400,maxHeight:400,borderRadius:"50%",border:`1px solid ${sc.color}20`,animation:isActive?"ring 2.6s ease-in-out infinite":"none",transition:"border-color 0.6s"}}/>
      <div style={{position:"absolute",pointerEvents:"none",width:"66vw",height:"66vw",maxWidth:330,maxHeight:330,borderRadius:"50%",border:`1px solid ${sc.color}14`,animation:isActive?"ring 2.6s ease-in-out infinite 0.9s":"none",transition:"border-color 0.6s"}}/>
      <div style={{width:"55vw",height:"55vw",maxWidth:280,maxHeight:280,borderRadius:"50%",background:`radial-gradient(circle at 38% 32%, ${sc.color}F0 0%, ${sc.color}88 42%, ${sc.color}2A 72%, transparent 100%)`,boxShadow:`0 0 100px ${sc.color}38, 0 0 200px ${sc.color}14, inset 0 0 50px ${sc.color}10`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",transition:"all 0.55s ease",animation:appState==="listening"?"breathe 1.1s ease-in-out infinite":appState==="reading"?"breathe 2.8s ease-in-out infinite":"none",zIndex:5}}>
        <div style={{fontSize:58,lineHeight:1,filter:"drop-shadow(0 2px 10px #00000055)"}}>{sc.emoji}</div>
        <div style={{marginTop:11,fontSize:9,color:"#0D0D0D",fontWeight:900,letterSpacing:3,textAlign:"center"}}>{sc.short}</div>
      </div>
      <div style={{position:"absolute",bottom:164,left:28,right:28,textAlign:"center",color:"#CACACA",fontSize:14.5,lineHeight:1.75,zIndex:10,minHeight:54,pointerEvents:"none"}}>{label}</div>
      {showBar&&(
        <div style={{position:"absolute",bottom:108,left:44,right:44,zIndex:10,pointerEvents:"none"}}>
          <div style={{color:"#3A3A3A",fontSize:10.5,textAlign:"center",marginBottom:8,letterSpacing:0.5}}>{infoLine}</div>
          <div style={{background:"#141414",borderRadius:10,height:9,overflow:"hidden"}}>
            <div style={{background:`linear-gradient(90deg, ${sc.color}, ${sc.color}88)`,width:`${progress}%`,height:"100%",borderRadius:10,transition:"width 1.2s ease",boxShadow:`0 0 14px ${sc.color}77`}}/>
          </div>
        </div>
      )}
      {appState==="idle"&&(
        <div style={{position:"absolute",bottom:68,left:24,right:24,textAlign:"center",color:"#252525",fontSize:10,lineHeight:2.1,letterSpacing:0.6,zIndex:10,pointerEvents:"none"}}>
          « bibliothèque » · « lire [titre] » · « mes marque-pages » · « assistant »
        </div>
      )}
      <div style={{position:"absolute",bottom:24,color:"#191919",fontSize:8.5,letterSpacing:3.5,zIndex:10,pointerEvents:"none"}}>VOCABOOK · TOUCHEZ N'IMPORTE OÙ</div>
      <style>{`@keyframes breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}@keyframes ring{0%,100%{transform:scale(1);opacity:0.20}50%{transform:scale(1.06);opacity:0.65}}*{-webkit-tap-highlight-color:transparent}`}</style>
    </div>
  );
}
