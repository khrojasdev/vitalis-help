/* Vitalis Help · lógica del prototipo
   Contenido:
   1. Conceptos SNOMED CT de muestra, abreviaturas y reglas de negación
   2. Motor de análisis del texto (analyze)
   3. Asistente de diagnóstico: dictar, revisar, validar, guardar
   4. Secciones de la atención: dictado por campo, signos vitales, recetas, resumen y cierre
   5. Grabación con botón: dictado y comandos de voz mientras el micrófono está activo
   6. Paciente de la atención: datos del banner, estado y regreso a la lista
   Los códigos CIE-11 vienen de la API de la OMS a través de servidor.py (ver README).
   El reconocimiento de voz usa la Web Speech API del navegador (Chrome o Edge). */
window.VITALIS_OK=true;
(function(){
"use strict";
/* ---------- Datos: conceptos SNOMED CT (archivo snomed.js) ---------- */
// Cada fila: [sctid, término preferido (es), FSN (en), frases en español]. Sinónimos extra: sinonimos.js
var RAW=window.VITALIS_SNOMED||[];
var C={}, CANON={}, VOCAB={};
function norm(s){return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");}
// Síntomas o signos que SNOMED CT clasifica como (disorder): se tratan como síntoma (sin CIE-11)
var SINTOMA_IDS={"422400008":1,"40739000":1,"271594007":1,"2901004":1,"271807003":1,"30746006":1,"267064002":1};

/* ---- Estandarización: todas las formas de decir un concepto llegan a una sola clave ----
   «diabetes mellitus tipo 2», «diabetes tipo II», «DM 2», «diabetes 2» → «diabete 2» */
var CAN_STOP={de:1,del:1,la:1,el:1,los:1,las:1,al:1,en:1,por:1,y:1,e:1,tipo:1,mellitus:1};
var CAN_CTX={tipo:1,grado:1,etapa:1,estadio:1,clase:1};
var CAN_NUM={uno:"1",una:"1",i:"1",dos:"2",ii:"2",tres:"3",iii:"3",cuatro:"4",iv:"4",cinco:"5",v:"5"};
var CAN_NUM_LIBRE={dos:"2",ii:"2",tres:"3",iii:"3"};
var CAN_EXP={dm:["diabetes"],dbt:["diabetes"],dm1:["diabetes","1"],dmt1:["diabetes","1"],dmi:["diabetes","1"],dm2:["diabetes","2"],dmt2:["diabetes","2"],dmii:["diabetes","2"],dbt2:["diabetes","2"],
  hta:["hipertension","arterial"],erc:["enfermedad","renal","cronica"],irc:["insuficiencia","renal","cronica"],epoc:["enfermedad","pulmonar","obstructiva","cronica"]};
function stem(w){if(w.length>5&&/[nlrdz]es$/.test(w))return w.slice(0,-2);if(w.length>4&&/s$/.test(w))return w.slice(0,-1);return w;}
function canonTok(w,prev){
  if(CAN_EXP[w]) return CAN_EXP[w].map(stem);
  if(prev&&CAN_CTX[prev]&&CAN_NUM[w]) return [CAN_NUM[w]];
  if(CAN_NUM_LIBRE[w]) return [CAN_NUM_LIBRE[w]];
  if(w==="estadio"||w==="grado") w="etapa";
  if(CAN_STOP[w]) return [];
  return [stem(w)];
}
function canonFrase(p){var ws=norm(p).split(/[^a-z0-9]+/).filter(Boolean),out=[];ws.forEach(function(w,i){out=out.concat(canonTok(w,ws[i-1]));});return out.join(" ");}

var SIN=window.VITALIS_SINONIMOS||{};
RAW.forEach(function(r){
  (SIN[r[0]]||[]).forEach(function(p){p=norm(p);if(r[3].indexOf(p)<0)r[3].push(p);});
  C[r[0]]={id:r[0],es:r[1],fsn:r[2],phrases:r[3],enf:/\(disorder\)$/.test(r[2])&&!SINTOMA_IDS[r[0]]};
});
RAW.forEach(function(r){ // el primero gana: los conceptos más específicos van antes en el catálogo
  r[3].forEach(function(p){var k=canonFrase(p); if(k&&!CANON[k])CANON[k]=r[0]; p.split(" ").forEach(function(w){VOCAB[w]=1;});});
});
function esEnf(id){return !!(C[id]&&C[id].enf);}
// Abreviaturas (capa local). Varios significados = ambigua.
var ABBR={hta:["38341003"],dm:["73211009"],dm1:["46635009"],dm2:["44054006"],itu:["68566005"],rge:["235595009"],erge:["235595009"],
  ic:["84114007"],icc:["84114007"],ar:["69896004"],acv:["230690007"],iam:["22298006"],epoc:["13645005"],dlp:["370992007"],
  ira:["275498002","14669001"],
  fa:["49436004"],acxfa:["49436004"],tvp:["128053003"],tep:["59282003"],erc:["709044004"],irc:["90688005"],hbp:["266569009"],
  sahos:["78275009"],saos:["78275009"],tec:["127295002"],tag:["21897009"],tdah:["406506008"],oma:["3110003"],nac:["385093006"],
  hda:["37372002"],sii:["10743008"],tbc:["56717001"],sca:["394659003"],cit:["266257000"],tia:["266257000"],ivu:["68566005"],
  tvs:["6456007"]};
var ABBR_LABEL={ira:{"275498002":"Infección respiratoria aguda","14669001":"Insuficiencia renal aguda"}};
// Reglas de contexto para abreviaturas ambiguas
var CONTEXT={ira:{"14669001":["renal","creatinina","diuresis","urea","dialisis","nefrologia","oliguria"],"275498002":["tos","fiebre","respiratoria","rinorrea","odinofagia","faringe","congestion","alta"]}};
var NEG=["se descarta","descarta","descartado","descartada","descartandose","descartar","sin","niega","nego","no presenta","no hay","no tiene","no refiere","no se observa","no se observan","no se evidencia","no se evidencian","no se aprecia","no se aprecian","no se palpa","no se palpan","no se ausculta","no se auscultan","no impresiona","no destaca","no hay signos de","negativo para","negativa para","ausencia de","libre de","sin signos de","sin evidencia de","ex"];
// «no» solo también niega cuando está pegado al término: «no dolor», «no refiere disnea»
function negCerca(tokens,i){for(var k=Math.max(0,i-2);k<i;k++){if(tokens[k].n==="no"&&tokens[k].clause===tokens[i].clause)return "no";}return null;}
var PRESUNT=["sospecha de","sospecha","probable","posible","impresion diagnostica de","a descartar"];
var COMMON=("paciente consulta anos con de del la el y por en se a los las un una refiere control tratamiento dias tres dos larga data diagnostico alta baja elevada mal controlada cuadro atipico antecedente ajusta indica inicia agudo aguda cronica cronico tipo ii presion arterial renal "+
  "semana semanas meses horas ayer desde hace evolucion actual actualmente presenta presento asociado asociada derecha izquierda derecho izquierdo leve moderada moderado severa severo "+
  "intensidad episodio episodios inicio cambio cambia mantiene mantener suspende deriva derivacion examen examenes fisico normal normales hallazgo hallazgos signos sintomas "+
  "madre padre hijo hija familiar familiares historia previo previa anterior ultimo ultima nuevo nueva buena bueno estable estables persistente persiste habitual cada noche manana tarde "+
  "medico medica indicacion indicaciones receta solicita solicitan resultado resultados sangre orina pierna piernas brazo brazos cabeza cuello pecho espalda rodilla rodillas cadera hombro").split(" ");
COMMON.forEach(function(w){VOCAB[w]=1;});
NEG.concat(PRESUNT).forEach(function(p){p.split(" ").forEach(function(w){VOCAB[w]=1;});});
Object.keys(ABBR).forEach(function(k){VOCAB[k]=1;});
var VOCAB_LIST=Object.keys(VOCAB).filter(function(w){return w.length>=4;});

function lev(a,b){var m=a.length,n=b.length,prev=[],cur=[],i,j;for(j=0;j<=n;j++)prev[j]=j;
  for(i=1;i<=m;i++){cur=[i];for(j=1;j<=n;j++){cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));}prev=cur;}return prev[n];}

/* ---------- Motor de procesamiento ---------- */
function tokenize(text){
  var re=/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+/g, m, out=[], clause=0, last=0;
  while((m=re.exec(text))){
    var between=text.slice(last,m.index);
    if(/[.;:,\n]/.test(between)) clause++;
    var n=norm(m[0]);
    if(n==="pero"||n==="aunque") clause++;
    out.push({raw:m[0],n:n,start:m.index,end:m.index+m[0].length,clause:clause,corr:null});
    last=m.index+m[0].length;
  }
  return out;
}
function correct(tokens){
  tokens.forEach(function(t){
    if(VOCAB[t.n]||t.n.length<5||/\d/.test(t.n)) return;
    var best=null,bd=99;
    VOCAB_LIST.forEach(function(w){if(Math.abs(w.length-t.n.length)>2)return;var d=lev(t.n,w);if(d<bd){bd=d;best=w;}});
    var thr=t.n.length>=9?2:1;
    if(best&&bd<=thr) t.corr=best;
  });
}
function hasBefore(tokens,i,list,win){
  for(var k=Math.max(0,i-win);k<i;k++){
    if(tokens[k].clause!==tokens[i].clause) continue;
    for(var L=0;L<list.length;L++){
      var parts=list[L].split(" ");
      if(k+parts.length<=i){
        var ok=true;for(var p=0;p<parts.length;p++){if(tokens[k+p].n!==parts[p]){ok=false;break;}}
        if(ok) return list[L];
      }
    }
  }
  return null;
}
function resolveContext(tokens,i,key){
  var rules=CONTEXT[key]; if(!rules) return null;
  if(key==="ira"&&tokens[i+1]&&tokens[i+1].n==="alta"&&tokens[i+1].clause===tokens[i].clause) return {id:"54150009",span:2,why:"«IRA alta» = infección respiratoria aguda alta"};
  var sentence=tokens.filter(function(t){return Math.abs(t.clause-tokens[i].clause)<=1;}).map(function(t){return t.n;});
  var scores={};
  Object.keys(rules).forEach(function(id){scores[id]=0;rules[id].forEach(function(w){if(sentence.indexOf(w)>=0)scores[id]++;});});
  var ids=Object.keys(scores).sort(function(a,b){return scores[b]-scores[a];});
  if(scores[ids[0]]>0&&scores[ids[0]]>scores[ids[1]]) return {id:ids[0],span:1,why:"resuelta por contexto clínico"};
  return null;
}
function canonTokens(tokens){ // forma estandarizada de cada palabra (puede quedar vacía: «de», «tipo»…)
  tokens.forEach(function(t,k){var p=k>0?(tokens[k-1].corr||tokens[k-1].n):null;t.c=canonTok(t.corr||t.n,p);});
}
function buscarFrase(tokens,i,minLen){ // frase del catálogo (en forma estandarizada) que empieza en la palabra i
  if(!tokens[i].c.length) return null;
  for(var len=Math.min(9,tokens.length-i);len>=minLen;len--){
    var seg=tokens.slice(i,i+len); if(seg.some(function(x){return x.clause!==tokens[i].clause;})) continue;
    if(!seg[len-1].c.length) continue;
    var key=[].concat.apply([],seg.map(function(x){return x.c;})).join(" ");
    if(CANON[key]){
      var usedCorr=seg.some(function(x){return !!x.corr;});
      var item={via:usedCorr?"correccion":"termino",id:CANON[key],conf:usedCorr?0.72:0.96};
      if(usedCorr) item.fixes=seg.filter(function(x){return x.corr;}).map(function(x){return x.raw+" → "+x.corr;});
      return {item:item,span:len};
    }
  }
  return null;
}
/* ---------- Hallazgos dictados con otras palabras ----------
   El catálogo tiene frases exactas («dolor lumbar»). En el examen físico el médico dice
   «molestias a la palpación en región lumbar», «abdomen doloroso» o «mucosas secas».
   Aquí se une la molestia con la zona del cuerpo más cercana en la misma frase.
   Quedan como sugerencia «Revisar»: el médico decide si se registran. */
var SINTOMA={dolor:1,dolores:1,molestia:1,molestias:1,sensibilidad:1,sensible:1,doloroso:1,dolorosa:1,dolorosos:1,dolorosas:1,algia:1};
var ZONA={};
[[["lumbar","lumbares","lumbosacra","lumbosacro"],"279039007"],
 [["epigastrio","epigastrica","epigastrico","estomago"],"271681002"],
 [["abdomen","abdominal","abdominales","hipogastrio","hipocondrio","flanco","flancos","iliaca","vientre","periumbilical"],"21522001"],
 [["cabeza","cefalica","craneal"],"25064002"],
 [["torax","toracico","toracica","pecho","retroesternal","precordial"],"29857009"],
 [["garganta","faringe","faringea"],"162397003"],
 [["cuello","cervical","nuca"],"81680005"],
 [["espalda","dorsal"],"161891005"],
 [["hombro","hombros"],"45326000"],
 [["rodilla","rodillas"],"30989003"],
 [["articulacion","articulaciones","articular"],"57676002"],
 [["muscular","musculares","musculo","musculos"],"68962001"]
].forEach(function(z){z[0].forEach(function(w){ZONA[w]=z[1];});});
var SECA={seca:1,secas:1,seco:1,secos:1,semisecas:1,deshidratada:1,deshidratadas:1};
function buscarHallazgo(tokens,i){
  var t=tokens[i], k;
  function mismo(j){return tokens[j]&&tokens[j].clause===t.clause;}
  if(SINTOMA[t.n]){
    for(k=i+1;k<=i+7&&mismo(k);k++){var z=ZONA[tokens[k].corr||tokens[k].n];if(z)return {id:z,from:i,to:k};}
    for(k=i-1;k>=i-3&&mismo(k);k--){var z2=ZONA[tokens[k].corr||tokens[k].n];if(z2)return {id:z2,from:k,to:i};}
  }
  if(t.n==="mucosa"||t.n==="mucosas"){
    for(k=i+1;k<=i+3&&mismo(k);k++){if(SECA[tokens[k].n])return {id:"34095006",from:i,to:k,why:"«mucosas secas» puede indicar deshidratación"};}
  }
  return null;
}

/* ---------- Errores frecuentes del reconocimiento de voz en el examen físico ---------- */
var VOZ_FIX=[
  [/\bcomo cosas(?=\s+(?:ligeramente\s+|levemente\s+|muy\s+|algo\s+|bien\s+)?(?:secas|h[uú]medas|hidratadas|rosadas|p[aá]lidas|semisecas))/gi,"mucosas"],
  [/\bruedos\b/gi,"ruidos"],
  [/\brudos (?=card)/gi,"ruidos "],
  [/\bt[oó]rax ?im[eé]trico\b/gi,"tórax simétrico"]
];
function fixVoz(t){VOZ_FIX.forEach(function(f){t=t.replace(f[0],f[1]);});return t;}

function analyze(text){
  var tokens=tokenize(text); correct(tokens); canonTokens(tokens);
  var items=[], i=0;
  while(i<tokens.length){
    var t=tokens[i], item=null, span=1;
    // Primero la frase más larga (por ejemplo «EPOC exacerbado»); después la sigla sola
    var frase=buscarFrase(tokens,i,2);
    if(frase){item=frase.item;span=frase.span;}
    else if(ABBR[t.n]){
      var opts=ABBR[t.n];
      item={via:"abreviatura",abbr:t.raw,options:opts.slice()};
      if(opts.length===1){item.id=opts[0];item.conf=0.9;}
      else{
        var ctx=resolveContext(tokens,i,t.n);
        if(ctx){item.id=ctx.id;item.conf=0.82;item.ctx=ctx.why;span=ctx.span;}
        else{item.id=null;item.ambiguous=true;item.conf=0.4;}
      }
    } else {
      frase=buscarFrase(tokens,i,1);
      if(frase){item=frase.item;span=frase.span;}
    }
    var first=t;
    if(!item){
      var h=buscarHallazgo(tokens,i);
      if(h){
        item={via:"hallazgo",id:h.id,conf:0.7,why:h.why||"deducido de «"+text.slice(tokens[h.from].start,tokens[h.to].end)+"»"};
        first=tokens[h.from]; span=Math.max(1,h.to-i+1);
        if(tokens[i-1]&&tokens[i-1].n==="no"&&tokens[i-1].clause===t.clause) item.neg="no";
      }
    }
    if(item){
      var last=tokens[i+span-1];
      if(item.via==="hallazgo"&&first!==t) last=t;
      item.start=first.start;item.end=last.end;item.surface=text.slice(first.start,last.end);
      item.neg=item.neg||hasBefore(tokens,tokens.indexOf(first),NEG,5)||negCerca(tokens,tokens.indexOf(first));
      item.cert=hasBefore(tokens,i,PRESUNT,4)?"Presuntivo":"Confirmado";
      item.estado="Activo";
      item.state=item.neg?"negated":"pending";
      items.push(item);
    }
    i+=span;
  }
  // La negación alcanza a toda la enumeración: «niega fiebre, vómitos y diarrea»
  for(var q=1;q<items.length;q++){
    var a=items[q-1], b=items[q];
    if(a.neg&&!b.neg&&/^[\s,]*(?:(?:y|e|ni|o|u)\s+)?(?:tampoco\s+)?$/i.test(text.slice(a.end,b.start))){b.neg=a.neg;b.state="negated";}
  }
  // Duplicados del mismo concepto: se conserva el primero
  var seen={};
  items.forEach(function(it){if(it.neg||!it.id)return;if(seen[it.id]){it.dup=true;it.state="removed";}seen[it.id]=1;});
  return items;
}



var $=function(id){return document.getElementById(id);};
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}

/* ---- CIE-11: códigos desde la API de la OMS ----
   La app nunca habla directo con la OMS: le pregunta a servidor.py, que guarda la clave.
   Solo se envía el nombre del diagnóstico (por ejemplo «Hipertensión arterial»), nunca datos del paciente.
   Los códigos sugeridos quedan «por revisar» hasta que el médico los confirma o elige otro. */
var CIE11={base:null,estado:"probando",version:"",cache:{}};
function cie11Get(ruta){
  var ctl=window.AbortController?new AbortController():null, t=setTimeout(function(){if(ctl)ctl.abort();},12000);
  return fetch(CIE11.base+ruta,ctl?{signal:ctl.signal}:{}).then(function(r){clearTimeout(t);if(!r.ok)throw new Error(r.status);return r.json();});
}
function cie11Probar(){
  // 1) La dirección de config.js, si se configuró (servidor.py publicado en internet).
  // 2) En el computador: el mismo servidor (http://localhost:8000) o, con Live Server, el puerto 8000.
  // 3) Publicada en internet sin servidor (por ejemplo GitHub Pages): no hay CIE-11 y se avisa.
  var cfg=((window.VITALIS_CONFIG||{}).cie11Api||"").replace(/\/+$/,"");
  var local=location.protocol==="file:"||/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  CIE11.online=!local&&!cfg;
  var bases=cfg?[cfg]:location.protocol==="file:"?["http://localhost:8000/api/cie11"]:local?["/api/cie11","http://localhost:8000/api/cie11"]:[];
  (function intentar(i){
    if(i>=bases.length){CIE11.estado="sin conexion";cie11Refrescar();return;}
    CIE11.base=bases[i];
    cie11Get("/estado").then(function(d){
      CIE11.version=d.version||""; CIE11.estado=d.configurado?"on":"sin clave"; cie11Refrescar();
    }).catch(function(){intentar(i+1);});
  })(0);
}
function cie11Buscar(id){ // código sugerido para un concepto SNOMED, se pide una sola vez
  if(CIE11.cache[id]||CIE11.estado!=="on")return;
  CIE11.cache[id]={estado:"buscando"};
  cie11Get("/codificar?texto="+encodeURIComponent(C[id].es)).then(function(d){
    CIE11.cache[id]=d.codigo?{estado:"ok",codigo:d.codigo,titulo:d.titulo,uri:d.uri||"",version:d.version||CIE11.version}:{estado:"sin"};
  }).catch(function(){CIE11.cache[id]={estado:"error"};}).then(function(){cie11Refrescar(id);});
}
function cie11Sugerido(id){var e=CIE11.cache[id];return e&&e.estado==="ok"?{codigo:e.codigo,titulo:e.titulo,uri:e.uri,version:e.version,medico:false}:null;}
function cie11Final(it){return it.cie11||cie11Sugerido(it.id);}
function cie11Texto(x){ // código ya decidido
  return '<span title="'+esc(x.titulo||"")+'">CIE-11 '+esc(x.codigo)+'</span> <span class="c11 '+(x.medico?"c11-ok":"c11-rev")+'">'+(x.medico?"confirmado por el médico":"sugerido OMS · por revisar")+"</span>";
}
// Códigos de un concepto: las enfermedades llevan SNOMED CT y CIE-11; los síntomas, solo SNOMED CT
function codigosHtml(id,elegido){
  return "SNOMED CT "+id+(esEnf(id)?" · "+cie11Html(id,elegido):' · <span class="sint">síntoma · solo SNOMED CT</span>');
}
function cie11Html(id,elegido){ // texto que se muestra junto a SNOMED CT
  if(elegido) return '<span class="cie11">'+cie11Texto(elegido)+"</span>";
  cie11Buscar(id);
  return '<span class="cie11" data-cie11="'+id+'">'+cie11Vivo(id)+"</span>";
}
function cie11Vivo(id){
  var e=CIE11.cache[id];
  if(CIE11.estado==="probando"||(e&&e.estado==="buscando")) return "CIE-11 buscando…";
  if(CIE11.estado==="sin conexion") return CIE11.online?'<span title="La versión publicada no tiene el servidor de la clave OMS. Configure cie11Api en config.js o use la app en el computador con iniciar.bat">CIE-11 no disponible en la versión online</span>':'<span title="Inicie servidor.py para obtener los códigos CIE-11">CIE-11 sin conexión</span>';
  if(CIE11.estado==="sin clave") return '<span title="Complete el archivo .env con el cliente y la clave de la OMS">CIE-11 falta configurar la clave</span>';
  if(!e) return "CIE-11 buscando…";
  if(e.estado==="ok") return cie11Texto(cie11Sugerido(id));
  if(e.estado==="sin") return '<span title="La OMS no encontró un código. Elija uno con «Cambiar» antes de firmar.">CIE-11 sin coincidencia</span>';
  return '<span title="La API de la OMS no respondió">CIE-11 no disponible</span>';
}
function cie11Refrescar(id){ // actualiza en pantalla los códigos que estaban «buscando…»
  document.querySelectorAll(id?'[data-cie11="'+id+'"]':"[data-cie11]").forEach(function(el){
    var k=el.getAttribute("data-cie11"); if(!id)cie11Buscar(k); el.innerHTML=cie11Vivo(k);
  });
  document.querySelectorAll("[data-c11-acc]").forEach(function(el){el.hidden=CIE11.estado!=="on";});
  document.querySelectorAll("[data-c11-ok]").forEach(function(b){b.disabled=!cie11Sugerido(b.getAttribute("data-c11-ok"));});
}
cie11Probar();

var CASES=[
 "Paciente de 58 años con HTA y DM2 de larga data, consulta por cefalea de tres días. Se descarta ACV. Se ajusta tratamiento.",
 "Consulta por tos y fiebre de dos días. Diagnóstico: IRA alta. Sin disnea ni dolor torácico.",
 "Paciente con IRA, creatinina elevada y baja diuresis. Sospecha de insuficiencia cardiaca. Hipertencion arterial mal controlada.",
 "Paciente con hipotiroidismo en control, refiere dolor lumbar. Diagnóstico: lumbago. Antecedente de depresión.",
 "Cuadro de dolor torácico atípico, se descarta infarto. Reflujo gastroesofágico y obesidad.",
 "Paciente con asma bronquial en control. Refiere IRA desde ayer. Se indica control en una semana."
];
(function(){var o=document.createElement("option");o.value="-1";o.textContent="Ninguno · atención en blanco";$("caseSel").appendChild(o);})();
CASES.forEach(function(t,i){var o=document.createElement("option");o.value=i;o.textContent="Relato "+(i+1)+": "+t.slice(0,38)+"…";$("caseSel").appendChild(o);});
var S={step:1,text:"",items:[],extra:[],timer:null,clock:null,secs:0};

function go(n){
  S.step=n;
  ["s1","s2","s3","s4"].forEach(function(id,i){$(id).classList.toggle("hidden",i+1!==n);});
  Array.prototype.forEach.call($("steps").children,function(li){var s=+li.getAttribute("data-s");li.className=n>3?"done":(s<n?"done":(s===n?"now":""));});
}

/* ---- Paso 1: dictado por voz (reconocimiento del navegador) ---- */
function fmt(s){return ("0"+Math.floor(s/60)).slice(-2)+":"+("0"+s%60).slice(-2);}
var SR=window.SpeechRecognition||window.webkitSpeechRecognition, rec=null;
// El texto del dictado vive en el cuadro editable #txt: el médico puede dictar, escribir o corregir sin cambiar de vista
Object.defineProperty(S,"finalTxt",{get:function(){return $("txt").value;},set:function(v){$("txt").value=v;}});
S.listening=false;
// Comandos de puntuación dictados
function punct(t){
  return (" "+t+" ").replace(/\s+punto y coma\s+/gi,"; ").replace(/\s+dos puntos\s+/gi,": ")
    .replace(/\s+(punto y aparte|punto aparte|nuevo p[aá]rrafo)\s+/gi,".\n").replace(/\s+punto seguido\s+/gi,". ")
    .replace(/\s+punto\s+/gi,". ").replace(/\s+coma\s+/gi,", ").replace(/\s+([.,;:])/g,"$1").replace(/ {2,}/g," ").trim();
}
function cap(t){return t.replace(/(^|[.:]\s+|\n)([a-záéíóúñ])/g,function(m,p,c){return p+c.toUpperCase();});}
function showLive(interim){$("live").innerHTML=interim?"… "+esc(interim)+'<span class="caret"></span>':(S.listening?'Escuchando…<span class="caret"></span>':"");}
function setMsg(t,isErr){var m=$("micMsg");m.textContent=t||"";m.style.color=isErr?"var(--warn)":"var(--muted)";}
function startClock(){clearInterval(S.clock);S.clock=setInterval(function(){S.secs++;$("timer").textContent=fmt(S.secs);},1000);}
function uiOn(){ $("mic").classList.add("on");$("wave").classList.add("on");$("mic").setAttribute("aria-label","Pausar dictado");$("recState").textContent="Escuchando… hable con normalidad";}
function uiOff(msg){ $("mic").classList.remove("on");$("wave").classList.remove("on");$("mic").setAttribute("aria-label","Continuar dictado");clearInterval(S.clock);S.clock=null;if(msg)$("recState").textContent=msg;}
function startVoice(){
  if(!SR){setMsg("Este navegador no permite dictado por voz. Use Google Chrome o Microsoft Edge, o pruebe con un relato de ejemplo.",true);return;}
  rec=new SR(); rec.lang="es-CL"; rec.continuous=true; rec.interimResults=true;
  rec.onresult=function(e){
    var interim="";
    for(var i=e.resultIndex;i<e.results.length;i++){
      var r=e.results[i];
      if(r.isFinal){S.finalTxt=cap(punct((S.finalTxt+" "+r[0].transcript).trim()));}
      else interim+=r[0].transcript;
    }
    showLive(interim);
  };
  rec.onerror=function(e){
    var m={"not-allowed":"No hay permiso para usar el micrófono. Permítalo en el ícono del candado de la barra de direcciones y vuelva a intentar.",
           "service-not-allowed":"El navegador no permite el reconocimiento de voz en esta página. Ábrala desde un servidor local (vea las instrucciones).",
           "no-speech":"No se detectó voz. Acérquese al micrófono y vuelva a intentar.",
           "audio-capture":"No se encontró un micrófono conectado.",
           "network":"El reconocimiento de voz del navegador necesita conexión a internet."}[e.error];
    if(e.error==="no-speech"&&S.listening){return;}
    S.listening=false; uiOff("Dictado detenido"); setMsg(m||("Error de reconocimiento: "+e.error),true);
  };
  rec.onend=function(){ if(S.listening){try{rec.start();}catch(err){}} else {showLive("");} };
  try{rec.start();}catch(err){setMsg("No se pudo iniciar el micrófono: "+err.message,true);return;}
  S.listening=true; setMsg("Diga «punto» o «coma» para separar las frases.",false); uiOn(); startClock(); showLive("");
}
function stopVoice(){ S.listening=false; if(rec){try{rec.stop();}catch(err){}} uiOff(S.finalTxt?"Dictado en pausa. Corrija el texto si es necesario y pulse «Analizar».":"Pulse el micrófono para dictar, o escriba directamente en el cuadro"); showLive(""); }
$("mic").addEventListener("click",function(){ if(S.listening) stopVoice(); else startVoice(); });

/* Relato de ejemplo (por si no hay micrófono) */
function playSample(){
  stopVoice(); var text=CASES[Math.max(0,+$("caseSel").value)], words=text.split(" "), k=0; S.finalTxt=""; S.secs=0; $("timer").textContent="00:00";
  uiOn(); $("recState").textContent="Reproduciendo relato de ejemplo…"; startClock(); setMsg("",false);
  if(matchMedia("(prefers-reduced-motion: reduce)").matches){S.finalTxt=text;uiOff("Relato de ejemplo listo");showLive("");return;}
  clearInterval(S.timer);
  S.timer=setInterval(function(){S.finalTxt+=(k?" ":"")+words[k];k++;
    if(k>=words.length){clearInterval(S.timer);S.timer=null;uiOff("Relato de ejemplo listo. Pulse «Analizar».");showLive("");}},200);
}
$("sampleBtn").addEventListener("click",playSample);
function stopAll(){clearInterval(S.timer);S.timer=null;stopVoice();}
function resetS1(){stopAll();S.finalTxt="";S.secs=0;$("live").innerHTML="";$("timer").textContent="00:00";$("recState").textContent="Pulse el micrófono para dictar, o escriba directamente en el cuadro";setMsg("",false);}
$("caseSel").addEventListener("change",function(){resetS1();S.items=[];S.extra=[];S.savedDx=null;go(1);fillCase(+$("caseSel").value);});
if(!SR) setMsg("Este navegador no permite dictado por voz. Use Google Chrome o Microsoft Edge, o pruebe con un relato de ejemplo.",true);

/* ---- Paso 2: análisis ----
   Se analiza el dictado del diagnóstico y además lo registrado en las otras secciones
   de la atención, para que ningún diagnóstico mencionado quede fuera. */
// [campo, nombre, quién lo registró]: lo relatado por el paciente no es un diagnóstico hasta que el médico lo valida
var FUENTES=[["f_motivo","Motivo de consulta","paciente"],["f_ea","Enfermedad actual","paciente"],["f_ant","Antecedentes","paciente"],["f_ef","Examen físico","medico"]];
function otrasFuentes(){return FUENTES.some(function(f){return !!val(f[0]);});}
function analyzeAll(dict){
  var items=dict?analyze(dict):[];
  FUENTES.forEach(function(f){
    var t=fixVoz(val(f[0])); if(!t)return;
    analyze(t).forEach(function(it){if(it.dup)return; it.src=f[1]; it.origen=f[2]; it.srcText=t; if(f[0]==="f_ant")it.tipo="Secundario"; items.push(it);});
  });
  // El mismo diagnóstico en varias secciones: se muestra una sola vez (el dictado del diagnóstico primero)
  var seen={}, negSeen={};
  items.forEach(function(it){
    if(!it.id||it.dup)return;
    if(it.state==="negated"){if(negSeen[it.id]){it.dup=true;it.state="removed";}negSeen[it.id]=1;return;}
    if(seen[it.id]){it.dup=true;it.state="removed";} seen[it.id]=1;
  });
  return items;
}
$("analyze").addEventListener("click",function(){
  stopAll();
  var t=cap(fixVoz($("txt").value)).trim(); if(!t&&!otrasFuentes()){setMsg("Dicte o escriba la evolución y el diagnóstico antes de analizar.",true);$("txt").focus();return;} $("txt").value=t;
  S.text=t; $("analyze").disabled=true; $("sampleBtn").disabled=true; var box=$("analyzing"); box.classList.remove("hidden");
  var rows=box.querySelectorAll("div"); rows.forEach(function(r){r.className="";r.querySelector("i").textContent="";});
  var reduce=matchMedia("(prefers-reduced-motion: reduce)").matches, d=reduce?60:520, i=0;
  (function next(){
    if(i>0){rows[i-1].className="ok";rows[i-1].querySelector("i").textContent="✓";}
    if(i>=rows.length){
      S.items=analyzeAll(S.text); S.extra=[];
      setTimeout(function(){box.classList.add("hidden");$("analyze").disabled=false;$("sampleBtn").disabled=false;renderS3();go(2);},d/2);
      return;
    }
    rows[i].className="run"; i++; setTimeout(next,d);
  })();
});

/* ---- Paso 3: validación ---- */
function active(){return S.items.filter(function(it){return it.state!=="negated"&&!it.dup;}).concat(S.extra);}
function renderHL(){
  var t=S.text,out="",pos=0;
  S.items.filter(function(it){return !it.src;}).sort(function(a,b){return a.start-b.start;}).forEach(function(it){
    if(it.start<pos)return; out+=esc(t.slice(pos,it.start));
    var c="m-dx",tip="";
    if(it.state==="negated"){c="m-neg";tip="Negado: no se registrará";}
    else if(it.dup||it.state==="removed"){c="";}
    else if(it.ambiguous&&!it.id){c="m-pend";tip="Necesita su elección";}
    else if(it.via==="correccion"&&it.state==="pending"){c="m-fix";tip="Palabra corregida: "+(it.fixes||[]).join(", ");}
    else if(it.state==="pending"&&it.conf<0.8){c="m-pend";tip="Revise esta sugerencia";}
    out+=c?'<mark class="'+c+'" title="'+esc(tip)+'">'+esc(t.slice(it.start,it.end))+"</mark>":esc(t.slice(it.start,it.end)); pos=it.end;
  });
  $("hl").innerHTML=t?out+esc(t.slice(pos)):'<span class="from">Sin dictado de diagnóstico. Se analizaron las otras secciones de la atención.</span>';
  // Lo negado («se descarta ACV», «niega fiebre») no se sugiere: se lista aparte para que el médico vea qué se excluyó y por qué
  var negados=S.items.filter(function(it){return it.state==="negated"&&it.id&&!it.dup;});
  $("negs").innerHTML=negados.length?"<b>No se registrarán (negados):</b>"+negados.map(function(it){return "<span>"+esc(C[it.id].es)+' <span class="from">· '+(it.src?esc(it.src)+": ":"")+"«"+esc((it.srcText||t).slice(Math.max(0,it.start-14),it.end).replace(/^\S*\s/,""))+"»</span></span>";}).join(""):"";
}
function sugCard(it,idx,isExtra){
  var cls="sug"+(it.state==="confirmed"?" ok":"")+(it.state==="removed"?" off":"");
  var chips="";
  if(it.via==="abreviatura") chips+='<span class="chip c-acc">«'+esc(it.abbr)+'» expandida'+(it.ctx?" por contexto":"")+'</span>';
  if(it.via==="correccion") chips+='<span class="chip c-fix">Corregido: '+esc((it.fixes||[]).join(", "))+'</span>';
  if(it.via==="hallazgo") chips+='<span class="chip c-acc" title="'+esc(it.why||"")+'">Deducido del examen</span>';
  if(it.via==="manual") chips+='<span class="chip c-acc">Agregado por usted</span>';
  if(it.origen==="paciente") chips+='<span class="chip c-pac" title="El paciente lo mencionó; usted decide si es un diagnóstico">Lo relató el paciente</span>';
  if(it.state==="confirmed") chips+='<span class="chip c-ok">Aceptado</span>';
  else if(it.state==="removed") chips+='<span class="chip c-neg">Descartado</span>';
  else if((it.ambiguous&&!it.id)||it.conf<0.8) chips+='<span class="chip c-warn">Revisar</span>';
  var h='<div class="'+cls+'"><div class="sug-top"><div>';
  if(it.ambiguous&&!it.id){
    h+='<h3>«'+esc(it.abbr)+'»</h3>';
  } else {
    var c=C[it.id]; h+='<h3>'+esc(c.es)+'</h3><div class="codes">'+codigosHtml(c.id,it.cie11)+'</div>';
  }
  h+='</div><div class="chips">'+chips+'</div></div>';
  if(it.surface) h+='<div class="from">'+(it.src?"En "+esc(it.src)+(it.origen==="paciente"?" (relato del paciente)":" (registro del médico)"):"En su dictado")+': <q>'+esc(it.surface)+'</q>'+(it.via==="hallazgo"&&it.why&&!/^deducido/.test(it.why)?" · "+esc(it.why):"")+'</div>';
  if(it.ambiguous&&!it.id){
    h+='<div class="ask"><span>«'+esc(it.abbr)+'» puede tener más de un significado. ¿A cuál se refiere?</span><div class="row">';
    it.options.forEach(function(o){h+='<button class="btn" data-a="pick" data-i="'+idx+'" data-x="'+(isExtra?1:0)+'" data-id="'+o+'">'+esc((ABBR_LABEL[norm(it.abbr)]||{})[o]||C[o].es)+'</button>';});
    h+='</div></div>';
  } else {
    h+='<div class="row">';
    if(it.state==="confirmed"||it.state==="removed") h+='<button class="btn" data-a="undo" data-i="'+idx+'" data-x="'+(isExtra?1:0)+'">Deshacer</button>';
    else h+='<button class="btn primary" data-a="ok" data-i="'+idx+'" data-x="'+(isExtra?1:0)+'">Aceptar</button><button class="btn" data-a="chg" data-i="'+idx+'" data-x="'+(isExtra?1:0)+'">Cambiar</button><button class="btn" data-a="rm" data-i="'+idx+'" data-x="'+(isExtra?1:0)+'">Descartar</button>';
    h+='</div><div class="finder hidden" id="f-'+(isExtra?"x":"")+idx+'"><input type="search" placeholder="Buscar el diagnóstico correcto" aria-label="Buscar el diagnóstico correcto" data-i="'+idx+'" data-x="'+(isExtra?1:0)+'"><div class="flist"></div></div>';
  }
  return h+'</div>';
}
function renderS3(){
  renderHL();
  // Primero las enfermedades (SNOMED CT + CIE-11) y después los síntomas (solo SNOMED CT)
  var enf="", sint="";
  function add(it,i,x){if(it.state==="negated"||it.dup)return;var card=sugCard(it,i,x);if(!it.id||esEnf(it.id))enf+=card;else sint+=card;}
  S.items.forEach(function(it,i){add(it,i,false);});
  S.extra.forEach(function(it,i){add(it,i,true);});
  var html=(enf?'<p class="label grp">Enfermedades · SNOMED CT y CIE-11</p>'+enf:"")+(sint?'<p class="label grp">Síntomas y hallazgos · solo SNOMED CT</p>'+sint:"");
  $("sugs").innerHTML=html||'<p class="from">No se identificaron diagnósticos en el dictado. Puede agregarlos con el buscador.</p>';
  var act=active().filter(function(it){return it.state!=="removed";});
  var pend=act.filter(function(it){return it.state!=="confirmed";}).length;
  var acc=act.length-pend;
  $("pendInfo").textContent=pend?(pend+" por revisar"):(acc?acc+" diagnóstico(s) aceptado(s)":"");
  $("toS4").disabled=!(acc>0&&pend===0);
}
function findIt(b){var i=+b.getAttribute("data-i");return b.getAttribute("data-x")==="1"?S.extra[i]:S.items[i];}
$("sugs").addEventListener("click",function(e){
  var b=e.target.closest("button");if(!b)return; var it=findIt(b); if(!it)return; var a=b.getAttribute("data-a");
  if(a==="pick"){it.id=b.getAttribute("data-id");it.ambiguous=false;it.conf=0.9;it.ctx=null;}
  if(a==="ok")it.state="confirmed";
  if(a==="rm")it.state="removed";
  if(a==="undo")it.state="pending";
  if(a==="chg"){var f=b.closest(".sug").querySelector(".finder");f.classList.toggle("hidden");if(!f.classList.contains("hidden")){var inp=f.querySelector("input");inp.focus();fill(f.querySelector(".flist"),"",function(id){return 'data-a="set" data-i="'+b.getAttribute("data-i")+'" data-x="'+b.getAttribute("data-x")+'" data-id="'+id+'"';});}return;}
  if(a==="set"){it.id=b.getAttribute("data-id");it.via=it.via==="manual"?"manual":"termino";it.fixes=null;it.conf=0.95;it.state="confirmed";}
  renderS3();
});
$("sugs").addEventListener("input",function(e){
  var inp=e.target; if(inp.type!=="search")return;
  fill(inp.parentNode.querySelector(".flist"),inp.value,function(id){return 'data-a="set" data-i="'+inp.getAttribute("data-i")+'" data-x="'+inp.getAttribute("data-x")+'" data-id="'+id+'"';});
});
function fill(box,q,attrs){
  var nq=norm(q.trim());
  var hits=RAW.filter(function(r){return !nq||norm(r[1]).indexOf(nq)>=0||r[3].some(function(p){return p.indexOf(nq)>=0;});}).slice(0,7);
  box.innerHTML=hits.map(function(r){return '<button '+attrs(r[0])+'>'+esc(r[1])+' <span class="codes">'+r[0]+'</span></button>';}).join("")||'<span class="from">Sin resultados.</span>';
}
$("addq").addEventListener("input",function(){
  var q=$("addq").value; if(!q.trim()){$("addlist").innerHTML="";return;}
  fill($("addlist"),q,function(id){return 'data-add="'+id+'"';});
});
$("addlist").addEventListener("click",function(e){
  var b=e.target.closest("button[data-add]");if(!b)return;
  var id=b.getAttribute("data-add");
  if(active().some(function(it){return it.id===id&&it.state!=="removed";})){$("addq").value="";$("addlist").innerHTML="";return;}
  S.extra.push({id:id,via:"manual",conf:1,state:"confirmed",cert:"Confirmado",estado:"Activo",surface:""});
  $("addq").value="";$("addlist").innerHTML="";renderS3();
});
$("back2").addEventListener("click",function(){go(1);});
$("toS4").addEventListener("click",function(){renderS4();go(3);});

/* ---- Paso 4: resumen ---- */
function finals(){return active().filter(function(it){return it.state==="confirmed";});}
function renderS4(){
  var f=finals();
  // El diagnóstico principal por defecto es la primera enfermedad (no un síntoma)
  var princ=f.filter(function(it){return esEnf(it.id);})[0]||f[0];
  f.forEach(function(it){if(!it.tipo)it.tipo=it===princ?"Principal":"Secundario";});
  $("sumBody").innerHTML=f.map(function(it,i){var c=C[it.id];
    function sel(field,opts){return '<select data-f="'+field+'" data-k="'+i+'" aria-label="'+field+' de '+esc(c.es)+'">'+opts.map(function(o){return "<option"+(it[field]===o?" selected":"")+">"+o+"</option>";}).join("")+"</select>";}
    return "<tr><td><b>"+esc(c.es)+"</b>"+(it.surface?'<div class="from">'+(it.src?esc(it.src)+": ":"")+'«'+esc(it.surface)+'»</div>':"")+"</td><td>"+sel("tipo",["Principal","Secundario"])+"</td><td>"+sel("cert",["Confirmado","Presuntivo"])+"</td><td>"+sel("estado",["Activo","Resuelto"])+'</td><td class="codes">SNOMED CT '+c.id+"<br>"+(c.enf?cie11Html(c.id,it.cie11)+c11Acciones(i,it):'<span class="sint">síntoma · solo SNOMED CT</span>')+"</td></tr>"
      +'<tr class="c11-row hidden" id="c11r-'+i+'"><td colspan="5"><div class="finder"><label class="from" for="c11q-'+i+'">Buscar el código CIE-11 correcto para «'+esc(c.es)+'»</label><input type="search" id="c11q-'+i+'" data-c11q="'+i+'"><div class="flist"></div></div></td></tr>';
  }).join("");
  $("origTxt").textContent=S.text;
}
$("sumBody").addEventListener("change",function(e){var s=e.target;if(!s.getAttribute("data-f"))return;var f=finals()[+s.getAttribute("data-k")];if(f)f[s.getAttribute("data-f")]=s.value;});
/* Revisión del código CIE-11 por el médico: Confirmar el sugerido o Cambiar por otro de la búsqueda */
function c11Acciones(i,it){
  var ok=it.cie11&&it.cie11.medico;
  return '<div class="c11-acc" data-c11-acc'+(CIE11.estado!=="on"?" hidden":"")+'>'
    +(ok?"":'<button class="btn mini" data-c11="ok" data-k="'+i+'" data-c11-ok="'+it.id+'"'+(cie11Sugerido(it.id)?"":" disabled")+'>Confirmar CIE-11</button>')
    +'<button class="btn mini" data-c11="chg" data-k="'+i+'">Cambiar</button></div>';
}
var c11Res=[], c11Turno=0, c11Espera=null;
function c11Buscar(k,q){
  var box=document.querySelector("#c11r-"+k+" .flist"); if(!box)return;
  if(q.trim().length<2){box.innerHTML="";return;}
  box.innerHTML='<span class="from">Buscando en la CIE-11…</span>';
  var n=++c11Turno;
  cie11Get("/buscar?q="+encodeURIComponent(q.trim())).then(function(d){
    if(n!==c11Turno)return; c11Res=d.resultados||[];
    box.innerHTML=c11Res.map(function(r,j){return '<button data-c11-set="'+k+'" data-j="'+j+'"><span class="codes">'+esc(r.codigo)+"</span> "+esc(r.titulo)+"</button>";}).join("")||'<span class="from">Sin resultados en la CIE-11.</span>';
  }).catch(function(){if(n===c11Turno)box.innerHTML='<span class="from">La API CIE-11 no respondió. Intente de nuevo.</span>';});
}
$("sumBody").addEventListener("click",function(e){
  var b=e.target.closest("button"); if(!b)return;
  if(b.hasAttribute("data-c11-set")){
    var it=finals()[+b.getAttribute("data-c11-set")], r=c11Res[+b.getAttribute("data-j")];
    if(it&&r){it.cie11={codigo:r.codigo,titulo:r.titulo,uri:r.uri,version:CIE11.version,medico:true};renderS4();}
    return;
  }
  var k=+b.getAttribute("data-k"), f=finals()[k]; if(!f)return;
  if(b.getAttribute("data-c11")==="ok"){var sg=cie11Sugerido(f.id);if(sg){sg.medico=true;f.cie11=sg;renderS4();}}
  if(b.getAttribute("data-c11")==="chg"){
    var row=$("c11r-"+k); row.classList.toggle("hidden");
    if(!row.classList.contains("hidden")){var inp=$("c11q-"+k);inp.value=C[f.id].es;inp.focus();c11Buscar(k,inp.value);}
  }
});
$("sumBody").addEventListener("input",function(e){
  var inp=e.target; if(!inp.hasAttribute("data-c11q"))return;
  clearTimeout(c11Espera); c11Espera=setTimeout(function(){c11Buscar(+inp.getAttribute("data-c11q"),inp.value);},350);
});
$("back3").addEventListener("click",function(){go(2);});
$("save").addEventListener("click",function(){
  var f=finals(); var now=new Date();
  $("doneTime").textContent="Registrado el "+now.toLocaleDateString("es-CL")+" a las "+now.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"})+" · firmado por "+VitalisAuth.firma();
  $("doneList").innerHTML=f.map(function(it){var c=C[it.id];return "<div><span><b>"+esc(c.es)+"</b> · "+esc(it.tipo)+" · "+esc(it.cert)+" · "+esc(it.estado)+'</span><span class="codes">'+codigosHtml(c.id,cie11Final(it))+"</span></div>";}).join("");
  go(4);
});
$("edit").addEventListener("click",function(){go(3);});
$("newAt").addEventListener("click",function(){showSec("plan");});

/* ================= Secciones de la atención ================= */
var SEC=["paciente","examen","diagnostico","plan"]; // S, O, A, P
S.rx=[]; S.savedDx=null; S.closed=false;
function val(id){var el=$(id);if(!el)return "";if(el.type==="checkbox")return el.checked;return (el.value||"").trim();}
function showSec(name){
  stopField();
  SEC.forEach(function(n){$("sec-"+n).classList.toggle("hidden",n!==name);});
  document.querySelectorAll(".side button").forEach(function(b){if(b.getAttribute("data-sec")===name)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");});
  if(name==="plan") renderSummary();
  var m=document.querySelector(".main"); if(m&&m.getBoundingClientRect().top<0) window.scrollTo(0,m.offsetTop-8);
}
document.querySelectorAll(".side button").forEach(function(b){b.addEventListener("click",function(){showSec(b.getAttribute("data-sec"));});});
document.addEventListener("click",function(e){var g=e.target.closest("[data-go]");if(g){showSec(g.getAttribute("data-go"));}});

/* ---- Dictado por campo ---- */
var fRec=null, fTarget=null;
function stopField(){
  var r=fRec; fTarget=null; fRec=null;
  if(r){try{r.stop();}catch(err){}}
  document.querySelectorAll(".dict.on").forEach(function(b){b.classList.remove("on");b.setAttribute("aria-pressed","false");});
  document.querySelectorAll(".interim").forEach(function(d){if(!d.getAttribute("data-err"))d.textContent="";});
}
$("mic").addEventListener("click",stopField,true);
$("sampleBtn").addEventListener("click",stopField,true);
document.addEventListener("click",function(e){
  var b=e.target.closest(".dict"); if(!b) return;
  var id=b.getAttribute("data-target"), ta=$(id), out=$("i-"+id);
  if(fTarget===id){stopField();return;}
  stopField(); if(S.listening||S.timer) stopAll();
  out.removeAttribute("data-err");
  if(!SR){out.setAttribute("data-err","1");out.textContent="Este navegador no permite dictado por voz. Use Google Chrome o Microsoft Edge, o escriba el texto.";return;}
  var r=new SR(); r.lang="es-CL"; r.continuous=true; r.interimResults=true;
  fRec=r; fTarget=id; b.classList.add("on"); b.setAttribute("aria-pressed","true");
  out.textContent="Escuchando… diga «punto» o «coma» para separar las frases.";
  r.onresult=function(ev){
    var interim="";
    for(var i=ev.resultIndex;i<ev.results.length;i++){
      var res=ev.results[i];
      if(res.isFinal){ta.value=cap(punct((ta.value+" "+res[0].transcript).trim()));refreshStatus();}
      else interim+=res[0].transcript;
    }
    out.textContent=interim?("… "+interim):"Escuchando…";
  };
  r.onerror=function(ev){
    if(ev.error==="no-speech") return;
    var m={"not-allowed":"No hay permiso para usar el micrófono. Permítalo en el ícono del candado de la barra de direcciones.","audio-capture":"No se encontró un micrófono conectado.","network":"El reconocimiento de voz del navegador necesita conexión a internet.","service-not-allowed":"El navegador no permite el reconocimiento de voz en esta página."}[ev.error]||("Error de reconocimiento: "+ev.error);
    stopField(); out.setAttribute("data-err","1"); out.textContent=m;
  };
  r.onend=function(){ if(fTarget===id&&fRec===r){try{r.start();}catch(err){}} };
  try{r.start();}catch(err){stopField();out.setAttribute("data-err","1");out.textContent="No se pudo iniciar el micrófono: "+err.message;}
});

/* ---- Signos vitales ---- */
function num(id){var v=parseFloat(String(val(id)).replace(",","."));return isNaN(v)?null:v;}
function flag(id,txt,hi){var f=$(id);f.textContent=txt||"";f.className="flag"+(txt?(hi?" hi":" ok"):"");}
function vitals(){
  var pas=num("f_pas"),pad=num("f_pad");
  if(pas&&pad) flag("fl-pa",(pas>=140||pad>=90)?"Elevada (≥140/90)":"En rango",pas>=140||pad>=90); else flag("fl-pa","");
  var fc=num("f_fc"); flag("fl-f_fc",fc?(fc>100?"Taquicardia":fc<60?"Bradicardia":"En rango"):"",fc&&(fc>100||fc<60));
  var fr=num("f_fr"); flag("fl-f_fr",fr?(fr>20?"Taquipnea":"En rango"):"",fr&&fr>20);
  var t=num("f_temp"); flag("fl-f_temp",t?(t>=38?"Fiebre":t>=37.5?"Subfebril":"En rango"):"",t&&t>=37.5);
  var sat=num("f_sat"); flag("fl-f_sat",sat?(sat<92?"Baja":"En rango"):"",sat&&sat<92);
  flag("fl-f_peso",""); flag("fl-f_talla","");
  var p=num("f_peso"),h=num("f_talla"); if(h&&h>3)h=h/100;
  if(p&&h){var imc=p/(h*h);$("f_imc").textContent=imc.toFixed(1).replace(".",",");
    flag("fl-imc",imc<18.5?"Bajo peso":imc<25?"Normal":imc<30?"Sobrepeso":"Obesidad",imc<18.5||imc>=25);}
  else{$("f_imc").textContent="—";flag("fl-imc","");}
}
document.addEventListener("input",function(e){if(e.target.getAttribute&&e.target.getAttribute("data-store")){vitals();refreshStatus();}});
document.addEventListener("change",function(e){if(e.target.getAttribute&&e.target.getAttribute("data-store"))refreshStatus();});

/* ---- Recetas ---- */
function renderRx(){
  $("rxBody").innerHTML=S.rx.map(function(r,i){
    function inp(k,ph,list){return '<input class="inp" data-rx="'+i+'" data-k="'+k+'" value="'+esc(r[k]||"")+'" placeholder="'+ph+'"'+(list?' list="meds"':'')+' aria-label="'+ph+'">';}
    return "<tr><td style=\"min-width:200px\">"+inp("med","Medicamento",1)+"</td><td>"+inp("dosis","Dosis")+"</td><td>"+inp("frec","Frecuencia")+"</td><td>"+inp("dur","Duración")+'</td><td><button class="btn" data-rxdel="'+i+'" aria-label="Quitar medicamento">Quitar</button></td></tr>';
  }).join("")||'<tr><td colspan="5" class="from">Sin medicamentos indicados. Use «Agregar medicamento».</td></tr>';
}
$("rxBody").addEventListener("input",function(e){var t=e.target;if(!t.getAttribute("data-rx"))return;S.rx[+t.getAttribute("data-rx")][t.getAttribute("data-k")]=t.value;refreshStatus();});
$("rxBody").addEventListener("click",function(e){var b=e.target.closest("[data-rxdel]");if(!b)return;S.rx.splice(+b.getAttribute("data-rxdel"),1);renderRx();refreshStatus();});
$("rxAdd").addEventListener("click",function(){S.rx.push({med:"",dosis:"",frec:"",dur:""});renderRx();var ins=$("rxBody").querySelectorAll('input[data-k="med"]');if(ins.length)ins[ins.length-1].focus();});

/* ---- Estado de cada sección ---- */
function has(sec){
  if(sec==="paciente") return !!(val("f_motivo")||val("f_ea")||val("f_ant")||val("f_med"));
  if(sec==="examen") return !!(val("f_pas")||val("f_fc")||val("f_temp")||val("f_ef"));
  if(sec==="diagnostico") return !!(S.savedDx&&S.savedDx.length);
  if(sec==="plan") return S.closed;
  return false;
}
function planListo(){return !!(val("f_ind")||val("f_exa")||$("f_der").selectedIndex>0||$("f_ctrl").selectedIndex>0||val("f_rep")||val("f_lic")||S.rx.some(function(r){return (r.med||"").trim();}));}
function refreshStatus(){document.querySelectorAll(".side button").forEach(function(b){var n=b.getAttribute("data-sec");b.querySelector(".st").textContent=has(n)?"✓":"";b.setAttribute("aria-label",b.querySelector(".lbl").textContent.trim()+(has(n)?", completado":""));});if(curSec()==="plan"&&!S.closed)renderSummary();}
$("save").addEventListener("click",function(){S.savedText=S.text;S.savedDx=finals().map(function(it){return {id:it.id,tipo:it.tipo,cert:it.cert,estado:it.estado,surface:it.surface,cie11:esEnf(it.id)?cie11Final(it):null};});refreshStatus();});

/* ---- Resumen y cierre ---- */
// Cada bloque del resumen indica quién aporta la información: el paciente (S) o el médico (O, A, P)
function block(title,body,quien){var q=quien==="paciente"?'<span class="quien q-pac">Lo relató el paciente</span>':quien==="medico"?'<span class="quien q-med">Lo registró el médico</span>':"";
  return '<section><h3>'+title+q+"</h3>"+(body||'<p class="empty">Sin registro.</p>')+"</section>";}
function p(t){return t?"<p>"+esc(t)+"</p>":"";}
function renderSummary(){
  var v=[];
  if(val("f_pas")&&val("f_pad"))v.push("PA "+val("f_pas")+"/"+val("f_pad")+" mmHg");
  [["f_fc","FC","lpm"],["f_fr","FR","rpm"],["f_temp","T°","°C"],["f_sat","SatO₂","%"],["f_peso","Peso","kg"],["f_talla","Talla","m"]].forEach(function(x){if(val(x[0]))v.push(x[1]+" "+val(x[0])+" "+x[2]);});
  if($("f_imc").textContent!=="—")v.push("IMC "+$("f_imc").textContent);
  var mot=p(val("f_motivo"));
  var an=(val("f_ea")?"<p><b>Enfermedad actual:</b> "+esc(val("f_ea"))+"</p>":"")+(val("f_ant")?"<p><b>Antecedentes:</b> "+esc(val("f_ant"))+"</p>":"")+(val("f_med")?"<p><b>Medicamentos habituales:</b> "+esc(val("f_med"))+"</p>":"")+((val("f_ea")||val("f_ant")||val("f_med"))?"<p><b>Hábitos:</b> "+esc(val("f_tab"))+" · "+esc(val("f_alc"))+"</p>":"");
  var ex=(v.length?"<p>"+esc(v.join(" · "))+"</p>":"")+p(val("f_ef"));
  var dx=S.savedDx&&S.savedDx.length?S.savedDx.map(function(d){var c=C[d.id];return "<p><b>"+esc(c.es)+"</b> · "+esc(d.tipo)+" · "+esc(d.cert)+" · "+esc(d.estado)+' <span class="codes">'+codigosHtml(c.id,d.cie11)+"</span></p>";}).join(""):'<p class="empty">Pendiente: registre el diagnóstico en la sección Diagnóstico.</p>';
  var ind=p(val("f_ind"))+(val("f_exa")?"<p><b>Exámenes:</b> "+esc(val("f_exa"))+"</p>":"")+($("f_der").selectedIndex>0?"<p><b>Derivación:</b> "+esc(val("f_der"))+"</p>":"")+($("f_ctrl").selectedIndex>0?"<p><b>Próximo control:</b> "+esc(val("f_ctrl"))+"</p>":"")+((val("f_rep")||val("f_lic"))?"<p><b>"+[val("f_rep")?"Reposo":"",val("f_lic")?"Licencia médica":""].filter(Boolean).join(" y ")+"</b>"+(val("f_dias")?" por "+esc(val("f_dias"))+" días":"")+"</p>":"");
  var rx=S.rx.filter(function(r){return (r.med||"").trim();}).map(function(r){return "<p><b>"+esc(r.med)+"</b> · "+esc([r.dosis,r.frec,r.dur].filter(Boolean).join(" · "))+"</p>";}).join("")+(val("f_rxobs")?p(val("f_rxobs")):"");
  if(S.savedDx&&S.savedText) dx+='<p class="from"><b>Evolución dictada:</b> '+esc(S.savedText)+"</p>";
  var s1=(mot?"<p><b>Motivo de consulta:</b> "+esc(val("f_motivo"))+"</p>":"")+an;
  $("sumAll").innerHTML=block("S · Relato del paciente",s1,"paciente")+block("O · Examen físico",ex,"medico")+block("A · Diagnóstico",dx,"medico")+block("P · Indicaciones",ind,"medico")+block("P · Recetas",rx,"medico");
  $("closeAt").disabled=S.closed;
}
$("closeAt").addEventListener("click",function(){
  if(!(S.savedDx&&S.savedDx.length)){$("closeMsg").innerHTML='<p class="from" style="color:var(--warn)">Falta registrar el diagnóstico antes de cerrar la atención.</p>';return;}
  S.closed=true; var now=new Date();
  $("closeMsg").innerHTML='<div class="closed">Atención cerrada el '+now.toLocaleDateString("es-CL")+" a las "+now.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"})+" · firmada por "+esc(VitalisAuth.firma())+"</div>";
  $("atTag").textContent="Atención cerrada"; $("closeAt").disabled=true; refreshStatus();
});

/* ---- Casos de ejemplo ---- */
var FILL=[
 {motivo:"Dolor de cabeza de tres días de evolución.",ea:"Paciente refiere cefalea holocránea, opresiva, de intensidad moderada, de tres días de evolución, que cede parcialmente con paracetamol. Niega fiebre, vómitos y alteraciones visuales. Refiere mediciones de presión elevadas en domicilio.",ant:"Hipertensión arterial y diabetes mellitus tipo 2 en tratamiento.",med:"Losartán 50 mg cada 12 horas. Metformina 850 mg cada 12 horas.",tab:0,alc:1,pas:152,pad:94,fc:78,fr:16,temp:"36,6",sat:98,peso:78,talla:"1,62",ef:"Lúcida, orientada, hidratada. Sin signos meníngeos ni focalidad neurológica. Examen cardiopulmonar sin hallazgos patológicos.",ind:"Control de presión arterial en domicilio dos veces al día, con registro. Dieta baja en sodio. Consultar en urgencia si presenta cefalea intensa, alteración visual o debilidad de extremidades.",exa:"Hemoglobina glicosilada, perfil lipídico, creatinina.",der:0,ctrl:3,rep:false,lic:false,dias:"",rx:[["Paracetamol 500 mg comprimido","1 comprimido","Cada 8 horas","5 días"],["Losartán 50 mg comprimido","1 comprimido","Cada 12 horas","Uso crónico"]]},
 {motivo:"Tos y fiebre desde hace dos días.",ea:"Cuadro de dos días de tos seca, odinofagia, rinorrea y fiebre hasta 38,5 °C. Sin dificultad respiratoria.",ant:"Sin antecedentes mórbidos relevantes.",med:"No usa.",tab:0,alc:0,pas:118,pad:76,fc:92,fr:18,temp:"38,2",sat:97,peso:70,talla:"1,60",ef:"Faringe congestiva, sin exudado. Murmullo pulmonar conservado, sin ruidos agregados.",ind:"Reposo relativo e hidratación abundante. Consultar si presenta dificultad para respirar o fiebre por más de tres días.",exa:"",der:0,ctrl:0,rep:true,lic:true,dias:3,rx:[["Paracetamol 500 mg comprimido","1 comprimido","Cada 8 horas","5 días"]]},
 {motivo:"Disminución de la orina y exámenes alterados.",ea:"Paciente refiere disminución del volumen urinario y edema de extremidades inferiores de una semana de evolución. Exámenes recientes con creatinina elevada.",ant:"Hipertensión arterial de difícil manejo.",med:"Enalapril 10 mg cada 12 horas.",tab:2,alc:0,pas:168,pad:98,fc:96,fr:20,temp:"36,8",sat:94,peso:82,talla:"1,60",ef:"Edema de extremidades inferiores. Crépitos en ambas bases pulmonares.",ind:"Restricción de sal y líquidos. Suspender antiinflamatorios. Registrar la diuresis diaria.",exa:"Creatinina, nitrógeno ureico, electrolitos plasmáticos, orina completa, ecocardiograma.",der:2,ctrl:1,rep:false,lic:false,dias:"",rx:[]},
 {motivo:"Dolor lumbar de una semana.",ea:"Dolor lumbar de una semana, posterior a esfuerzo físico, sin irradiación, que aumenta con el movimiento. Sin síntomas urinarios.",ant:"Hipotiroidismo. Episodio depresivo hace dos años, en remisión.",med:"Levotiroxina 50 mcg al día.",tab:0,alc:1,pas:124,pad:80,fc:72,fr:16,temp:"36,5",sat:98,peso:68,talla:"1,58",ef:"Contractura paravertebral lumbar. Lasègue negativo bilateral. Fuerza y sensibilidad conservadas.",ind:"Calor local y evitar cargar peso. Ejercicios de elongación según pauta entregada.",exa:"",der:0,ctrl:2,rep:true,lic:true,dias:5,rx:[["Ibuprofeno 400 mg comprimido","1 comprimido","Cada 8 horas","5 días"]]},
 {motivo:"Dolor en el pecho.",ea:"Dolor retroesternal tipo ardor, posprandial, que empeora al acostarse. No se relaciona con el esfuerzo.",ant:"Obesidad.",med:"No usa.",tab:0,alc:1,pas:132,pad:84,fc:80,fr:16,temp:"36,6",sat:98,peso:96,talla:"1,62",ef:"Abdomen blando, depresible, levemente sensible en epigastrio. Examen cardiopulmonar normal. Electrocardiograma sin alteraciones.",ind:"Evitar comidas abundantes y acostarse inmediatamente después de comer. Elevar la cabecera de la cama. Plan de alimentación y actividad física.",exa:"Perfil lipídico y glicemia.",der:4,ctrl:3,rep:false,lic:false,dias:"",rx:[["Omeprazol 20 mg cápsula","1 cápsula","Cada 24 horas, en ayunas","30 días"]]},
 {motivo:"Síntomas respiratorios desde ayer.",ea:"Paciente asmática en control refiere desde ayer congestión nasal, tos y sensación de opresión torácica leve.",ant:"Asma bronquial.",med:"Salbutamol 100 mcg inhalador según necesidad.",tab:0,alc:0,pas:120,pad:78,fc:88,fr:20,temp:"37,2",sat:96,peso:64,talla:"1,60",ef:"Sibilancias espiratorias escasas. Sin uso de musculatura accesoria.",ind:"Mantener el tratamiento inhalatorio. Consultar en urgencia si aumenta la dificultad para respirar.",exa:"",der:0,ctrl:1,rep:false,lic:false,dias:"",rx:[["Salbutamol 100 mcg inhalador","2 inhalaciones","Cada 6 horas si hay síntomas","7 días"]]}
];
function setv(id,v){var el=$(id);if(el.type==="checkbox")el.checked=!!v;else if(el.tagName==="SELECT")el.selectedIndex=v||0;else el.value=(v===undefined||v===null)?"":String(v);}
function fillCase(i){
  var f=FILL[i]||{};
  [["f_motivo","motivo"],["f_ea","ea"],["f_ant","ant"],["f_med","med"],["f_tab","tab"],["f_alc","alc"],["f_pas","pas"],["f_pad","pad"],["f_fc","fc"],["f_fr","fr"],["f_temp","temp"],["f_sat","sat"],["f_peso","peso"],["f_talla","talla"],["f_ef","ef"],["f_ind","ind"],["f_exa","exa"],["f_der","der"],["f_ctrl","ctrl"],["f_rep","rep"],["f_lic","lic"],["f_dias","dias"],["f_rxobs","rxobs"]].forEach(function(x){setv(x[0],f[x[1]]);});
  S.rx=(f.rx||[]).map(function(r){return {med:r[0],dosis:r[1],frec:r[2],dur:r[3]};});
  S.closed=false; $("atTag").textContent="Atención en curso"; $("closeMsg").innerHTML="";
  renderRx(); vitals(); refreshStatus();
}
$("clearAll").addEventListener("click",function(){
  $("caseSel").value="-1";
  stopField(); stopAll(); fillCase(-1); resetS1(); S.items=[]; S.extra=[]; S.savedDx=null; go(1); refreshStatus(); showSec("paciente");
});

fillCase(-1); // la ficha parte vacía; los casos se cargan desde la barra de demostración
showSec("paciente");

/* ================= Grabación con botón =================
   El micrófono graba solo cuando el médico pulsa el botón
   (en pantalla o el botón físico del micrófono; ver GRAB_KEYS).
   Mientras graba, cada frase reconocida es, o un comando de voz,
   o texto que se escribe en el campo activo (resaltado en rosado). */
var HF={on:false,rec:null,sec:"paciente",idx:0,undo:[],el:null};
var SEC_ALIAS={paciente:["paciente","relato","relato del paciente","anamnesis","historia","subjetivo"],examen:["examen","examen fisico","objetivo"],diagnostico:["diagnostico","diagnosticos","evaluacion"],plan:["plan","plan y cierre","indicaciones","indicacion"]};
var SEC_NAME={paciente:"Relato del paciente",examen:"Examen físico",diagnostico:"Diagnóstico",plan:"Plan y cierre"};
var NUMW={cero:0,un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,once:11,doce:12,quince:15,veinte:20,treinta:30};

function clean(t){return norm(t).replace(/[.,;:¡!¿?«»"]/g," ").replace(/\s+/g," ").trim();}
function numText(t){ // números dictados → "36,6"
  return norm(t).replace(/\b(cero|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta)\b/g,function(w){return NUMW[w];})
    .replace(/(\d+)\s*metros?\s*(?:con\s*)?(\d+)/g,"$1,$2").replace(/(\d+)\s*(?:coma|punto)\s*(\d+)/g,"$1,$2").replace(/(\d)\.(\d)/g,"$1,$2");
}
function curSec(){var s=document.querySelector(".sec:not(.hidden)");return s?s.id.replace("sec-",""):"paciente";}
function fields(sec){return Array.prototype.filter.call($("sec-"+sec).querySelectorAll("[data-store], #rxBody input"),function(el){return el.offsetParent!==null;});}
function lbl(el){
  var l=el.id&&document.querySelector('label[for="'+el.id+'"]');
  if(l) return l.childNodes[0].textContent.trim();
  if(el.type==="checkbox"&&el.closest("label")) return el.closest("label").textContent.trim();
  if(el.getAttribute("data-k")) return (el.getAttribute("placeholder")||"")+" (medicamento "+(+el.getAttribute("data-rx")+1)+")";
  if(el.closest("label")) return el.closest("label").childNodes[0].textContent.trim();
  return el.getAttribute("aria-label")||"campo";
}
function isNum(el){var m=el.getAttribute("inputmode");return m==="numeric"||m==="decimal";}

/* ---- Campo activo ---- */
function setField(i){
  var fs=fields(HF.sec); if(HF.el)HF.el.classList.remove("hf-target"); HF.el=null;
  if(!fs.length){hfWhere();return;}
  HF.idx=Math.max(0,Math.min(i,fs.length-1)); HF.el=fs[HF.idx];
  if(HF.on){var box=HF.el.type==="checkbox"?HF.el.parentNode:HF.el; box.classList.add("hf-target"); reveal(box);}
  hfWhere();
}
function reveal(box){
  var r=box.getBoundingClientRect(), bar=$("hfBar"), lim=bar.hidden?innerHeight:bar.getBoundingClientRect().top;
  if(r.bottom>lim-16) window.scrollBy(0,Math.min(r.bottom-lim+32,r.top-90));
  else if(r.top<16) window.scrollBy(0,r.top-90);
}
function target(){var fs=fields(HF.sec);return fs[HF.idx]||null;}
function clearMark(){document.querySelectorAll(".hf-target").forEach(function(e){e.classList.remove("hf-target");});}
function hfWhere(){
  var w=$("hfWhere"); if(!w)return;
  if(HF.sec==="diagnostico") w.textContent=SEC_NAME.diagnostico+" · "+["","Dictar o escribir","Validar diagnósticos","Firmar","Guardado"][S.step];
  else {var t=target(); w.textContent=SEC_NAME[HF.sec]+(t?" · Campo: "+lbl(t):"");}
  $("hfHelp").innerHTML=helpHTML();
}
function enterSec(name){
  HF.sec=name; clearMark();
  var fs=fields(name), first=0;
  for(var i=0;i<fs.length;i++){var v=fs[i].type==="checkbox"?fs[i].checked:fs[i].tagName==="SELECT"?fs[i].selectedIndex>0:fs[i].value.trim();if(!v){first=i;break;}}
  setField(first); wizUI();
}
function wizUI(){ // el micrófono grande del paso 1 refleja la grabación
  if(HF.on&&HF.sec==="diagnostico"&&S.step===1){uiOn();$("recState").textContent="Grabando: dicte la evolución y diga «analizar»";if(!S.clock)startClock();}
  else if(!S.listening&&!S.timer){uiOff(/^Grabando:/.test($("recState").textContent)?(S.finalTxt?"Dictado en pausa. Corrija el texto si es necesario y pulse «Analizar».":"Pulse el micrófono para dictar, o escriba directamente en el cuadro"):null);}
}
var _showSec=showSec; showSec=function(n){_showSec(n);enterSec(n);};
var _go=go; go=function(n){_go(n);if(HF.sec==="diagnostico"){wizUI();hfWhere();}};

/* ---- Mensajes en la barra ---- */
function say(msg,warn){var a=$("hfAct");a.textContent=(warn?"":"✓ ")+msg;a.className="act"+(warn?" warn":"");clearTimeout(HF.t);HF.t=setTimeout(function(){a.textContent="";},6000);}

/* ---- Escribir en el campo activo ---- */
function fire(el){el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));}
function dictate(raw){
  raw=raw.trim(); if(!raw)return; $("hfAct").textContent="";
  if(HF.sec==="diagnostico"){
    if(S.step===1){var tx=$("txt");HF.undo.push({el:tx,prev:tx.value});tx.value=cap(punct((tx.value+" "+raw).trim()));showLive("");return;}
    say("En este paso use comandos: "+(S.step===2?"«aceptar todos», «opción 1», «descartar …» o «continuar».":S.step===3?"«firmar y guardar» o «volver».":"«continuar» para seguir con el plan."),true);return;
  }
  var el=target();
  if(!el){say("No hay un campo activo. Diga «ir a …».",true);return;}
  HF.undo.push({el:el,prev:el.type==="checkbox"?el.checked:el.tagName==="SELECT"?el.selectedIndex:el.value});
  if(el.type==="checkbox"){
    var n=clean(raw); if(/^(si|marcar|activar|con)\b/.test(n))el.checked=true; else if(/^(no|desmarcar|sin|quitar)\b/.test(n))el.checked=false; else {say("Para «"+lbl(el)+"» diga «sí» o «no».",true);HF.undo.pop();return;}
    fire(el); say(lbl(el)+": "+(el.checked?"sí":"no")); setField(HF.idx+1); return;
  }
  if(el.tagName==="SELECT"){
    var q=clean(numText(raw)),best=-1,bl=0;
    Array.prototype.forEach.call(el.options,function(o,i){var t=clean(numText(o.textContent));
      if(t===q){best=i;bl=999;} else if(bl<999&&q.indexOf(t)>=0&&t.length>bl){best=i;bl=t.length;} else if(bl===0&&t.indexOf(q)>=0){best=i;}});
    if(best<0){HF.undo.pop();say("No encontré «"+raw+"» en "+lbl(el)+". Opciones: "+Array.prototype.map.call(el.options,function(o){return o.textContent;}).join(", ")+".",true);return;}
    el.selectedIndex=best; fire(el); say(lbl(el)+": "+el.options[best].textContent); setField(HF.idx+1); return;
  }
  if(isNum(el)){
    var m=numText(raw).match(/\d+(,\d+)?/); if(!m){HF.undo.pop();say("Para «"+lbl(el)+"» dicte un número.",true);return;}
    el.value=m[0]; fire(el); say(lbl(el)+": "+m[0]); setField(HF.idx+1); return;
  }
  var txt=punct(raw);
  el.value=el.tagName==="TEXTAREA"?cap((el.value+" "+txt).trim()):(el.value?el.value+" "+txt:txt.charAt(0).toUpperCase()+txt.slice(1));
  fire(el);
}

/* ---- Atajos del examen físico: «presión 150 sobre 90», «temperatura 37 coma 5»… ---- */
function vitalsByVoice(raw){
  var v=numText(raw).replace(/[.;:¡!¿?]/g," ").replace(/\s+/g," "), done=[];
  function put(id,val,name){var el=$(id);HF.undo.push({el:el,prev:el.value});el.value=val;fire(el);done.push(name+" "+val);}
  var m;
  if((m=v.match(/presion(?: arterial)?(?: de)? (\d{2,3})\s*(?:sobre|con|\/|partido por) (\d{2,3})/))){put("f_pas",m[1],"PA");HF.undo.push({el:$("f_pad"),prev:$("f_pad").value});$("f_pad").value=m[2];fire($("f_pad"));done[done.length-1]="PA "+m[1]+"/"+m[2];}
  if((m=v.match(/(?:frecuencia cardiaca|pulso)(?: de)? (\d{2,3})/)))put("f_fc",m[1],"FC");
  if((m=v.match(/frecuencia respiratoria(?: de)? (\d{1,2})/)))put("f_fr",m[1],"FR");
  if((m=v.match(/temperatura(?: de)? (\d{2}(?:,\d)?)/)))put("f_temp",m[1],"T°");
  if((m=v.match(/saturacion(?: de oxigeno| o2| de o2)?(?: de)? (\d{2,3})/)))put("f_sat",m[1],"SatO₂");
  if((m=v.match(/peso(?: de)? (\d{2,3}(?:,\d+)?)/)))put("f_peso",m[1],"Peso");
  if((m=v.match(/(?:talla|estatura|mide)(?: de)? (\d,\d{1,2}|\d{3})/)))put("f_talla",m[1],"Talla");
  if(done.length){say("Signos vitales: "+done.join(" · "));return true;}
  return false;
}

/* ---- Recetas: «agregar medicamento paracetamol 500 mg 1 comprimido cada 8 horas por 5 días» ---- */
function addRx(raw){
  var r=raw.replace(/[.]+$/,""), n=norm(r), m=n.match(/^agregar (?:un |el )?(?:medicamento|farmaco|remedio)\s*/);
  r=r.slice(m[0].length); n=n.slice(m[0].length);
  var row={med:"",dosis:"",frec:"",dur:""}, cut=n.length;
  var p=n.search(/ por \d+ /); if(p<0)p=n.search(/ por (un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|treinta) /);
  if(p>=0){row.dur=r.slice(p+5).trim();cut=p;}
  var c=n.slice(0,cut).search(/(^| )cada /); if(c>=0){row.frec=r.slice(c,cut).trim();row.frec=row.frec.charAt(0).toUpperCase()+row.frec.slice(1);cut=c;}
  var d=n.slice(0,cut).match(/(\d+|un|una|medio|media) (comprimidos?|capsulas?|inhalaciones?|gotas|sobres?|ampollas?|puff)\b/);
  var medPart=n.slice(0,cut);
  if(d){row.dosis=r.slice(d.index,d.index+d[0].length);medPart=n.slice(0,d.index);cut=d.index;}
  row.med=r.slice(0,cut).trim().replace(/,$/,"");
  if(row.med){ // usar el nombre del vademécum si coincide
    var opts=Array.prototype.map.call(document.querySelectorAll("#meds option"),function(o){return o.value;});
    var hit=opts.filter(function(o){return norm(o).indexOf(norm(row.med).replace(/ miligramos?/g," mg").replace(/ mg/," mg"))===0;})[0];
    row.med=hit||row.med.charAt(0).toUpperCase()+row.med.slice(1);
  }
  S.rx.push(row); renderRx(); refreshStatus();
  var key=!row.med?"med":!row.dosis?"dosis":!row.frec?"frec":!row.dur?"dur":null;
  if(key)setField(fields("plan").indexOf(document.querySelector('#rxBody input[data-rx="'+(S.rx.length-1)+'"][data-k="'+key+'"]')));
  say(row.med?"Medicamento agregado: "+[row.med,row.dosis,row.frec,row.dur].filter(Boolean).join(" · "):"Fila agregada. Dicte el medicamento.");
}

/* ---- Diagnóstico por voz (paso 3) ---- */
function pendings(){return active().filter(function(it){return it.state!=="removed"&&it.state!=="confirmed";});}
function dxName(it){return it.id?C[it.id].es:"«"+it.abbr+"»";}
function findDx(q){q=clean(q);return active().filter(function(it){return it.id&&(clean(C[it.id].es).indexOf(q)>=0||q.indexOf(clean(C[it.id].es))>=0||(it.surface&&clean(it.surface)===q));})[0];}
function stepAmb(){var a=active().filter(function(it){return it.ambiguous&&!it.id&&it.state!=="removed";})[0];
  if(a) say("Falta elegir el significado de «"+a.abbr+"»: "+a.options.map(function(o,i){return "«opción "+(i+1)+"» "+((ABBR_LABEL[norm(a.abbr)]||{})[o]||C[o].es);}).join(", ")+".",true);
  return a;}

/* ---- Comandos ---- */
function goSec(dir){
  var i=SEC.indexOf(HF.sec), n=SEC[i+dir];
  if(!n){say(dir>0?"Ya está en la última sección. Diga «cerrar atención».":"Ya está en la primera sección.",true);return;}
  showSec(n); say("Sección: "+SEC_NAME[n]);
}
function next(){
  if(HF.sec==="diagnostico"){
    if(S.step===1){analyzeV();return;}
    if(S.step===2){if($("toS4").disabled){if(!stepAmb())say(pendings().length?"Aún hay "+pendings().length+" diagnóstico(s) por revisar. Diga «aceptar todos».":"Acepte al menos un diagnóstico.",true);return;}$("toS4").click();say("Revise tipo, certeza y estado. Para firmar diga «firmar y guardar».");return;}
    if(S.step===3){say("Para firmar el diagnóstico diga «firmar y guardar».",true);return;}
    if(S.step===4){$("newAt").click();say("Sección: Plan y cierre");return;}
  }
  goSec(1);
}
function prev(){
  if(HF.sec==="diagnostico"){
    if(S.step===2){$("back2").click();say("Volvió al dictado.");return;}
    if(S.step===3){$("back3").click();say("Volvió a validar diagnósticos.");return;}
  }
  goSec(-1);
}
function analyzeV(){if(!$("txt").value.trim()&&!otrasFuentes()){say("No hay texto para analizar.",true);return;}$("analyze").click();say("Analizando el dictado…");}
function gotoTarget(q){
  q=q.replace(/^(el|la|los|las|al) /,"").trim(); if(!q)return false;
  if(q==="signos vitales"){showSec("examen");setField(0);say("Campo: Presión arterial");return true;}
  if(/^(recetas?|medicamentos)$/.test(q)){showSec("plan");var rx=fields("plan").filter(function(el){return el.hasAttribute("data-rx");})[0];if(rx)setField(fields("plan").indexOf(rx));$("recetas").scrollIntoView({block:"start"});say("Plan y cierre · Recetas");return true;}
  if(/^(resumen|cierre|resumen y cierre)$/.test(q)){showSec("plan");$("cierre").scrollIntoView({block:"start"});say("Plan y cierre · Resumen");return true;}
  for(var s in SEC_ALIAS){if(SEC_ALIAS[s].indexOf(q)>=0){showSec(s);say("Sección: "+SEC_NAME[s]);return true;}}
  var order=[HF.sec].concat(SEC.filter(function(s){return s!==HF.sec&&s!=="diagnostico";}));
  for(var k=0;k<order.length;k++){var fs=fields2(order[k]);
    for(var j=0;j<fs.length;j++){var l=clean(lbl(fs[j]));if(l===q||l.indexOf(q)===0||(q.length>4&&l.indexOf(q)>=0)){if(order[k]!==HF.sec)showSec(order[k]);setField(fields(order[k]).indexOf(fs[j]));say("Campo: "+lbl(fs[j]));return true;}}}
  for(var s2 in SEC_ALIAS){if(SEC_ALIAS[s2].some(function(a){return q.indexOf(a)>=0;})){showSec(s2);say("Sección: "+SEC_NAME[s2]);return true;}}
  say("No encontré «"+q+"». Diga por ejemplo «ir a recetas» o «ir a antecedentes».",true); return true;
}
function fields2(sec){ // campos de una sección aunque esté oculta
  return Array.prototype.slice.call($("sec-"+sec).querySelectorAll("[data-store], #rxBody input"));
}
function undo(){
  var u=HF.undo.pop(); if(!u){say("No hay nada que borrar.",true);return;}
  if(u.wiz){S.finalTxt=u.prev;showLive("");}
  else{if(u.el.type==="checkbox")u.el.checked=u.prev;else if(u.el.tagName==="SELECT")u.el.selectedIndex=u.prev;else u.el.value=u.prev;fire(u.el);}
  say("Se borró lo último que dictó.");
}
function clearField(){
  var el=HF.sec==="diagnostico"&&S.step===1?$("txt"):target(); if(!el){say("No hay un campo activo.",true);return;}
  HF.undo.push({el:el,prev:el.type==="checkbox"?el.checked:el.tagName==="SELECT"?el.selectedIndex:el.value});
  if(el.type==="checkbox")el.checked=false;else if(el.tagName==="SELECT")el.selectedIndex=0;else el.value=""; fire(el); say("Campo borrado: "+lbl(el));
}
// frases que son comando completas; las marcadas con * también se reconocen al final de una frase dictada
var CMDS=[
  [["siguiente campo*","campo siguiente*","proximo campo*"],function(){if(HF.sec==="diagnostico"){say("En diagnóstico diga «continuar» para pasar al siguiente paso.",true);return;}var fs=fields(HF.sec);if(HF.idx>=fs.length-1){say("Es el último campo. Diga «siguiente sección».",true);return;}setField(HF.idx+1);say("Campo: "+lbl(target()));}],
  [["campo anterior*"],function(){if(HF.idx<=0){say("Es el primer campo.",true);return;}setField(HF.idx-1);say("Campo: "+lbl(target()));}],
  [["siguiente seccion*","siguiente etapa*","siguiente paso*","continuar","avanzar"],next],
  [["seccion anterior*","etapa anterior*","paso anterior*","volver","atras"],prev],
  [["terminar dictado*","fin del dictado*","termine el dictado*"],function(){if(HF.sec==="diagnostico"&&S.step===1)say("Revise el texto y diga «analizar» cuando esté listo.");else say("«Terminar dictado» se usa en el paso Dictar del diagnóstico.",true);}],
  [["analizar","analizar texto","analizar dictado"],function(){if(HF.sec==="diagnostico"&&S.step===1)analyzeV();else say("«Analizar» se usa en el paso Dictar del diagnóstico.",true);}],
  [["aceptar todos","aceptar todo","aceptar todas","aceptar"],function(){
    if(!(HF.sec==="diagnostico"&&S.step===2)){say("«Aceptar todos» se usa al validar diagnósticos.",true);return;}
    var n=0; pendings().forEach(function(it){if(it.id){it.state="confirmed";n++;}}); renderS3();
    if(!stepAmb()) say(n?n+" diagnóstico(s) aceptado(s). Diga «continuar».":"No quedan diagnósticos por aceptar.");}],
  [["firmar y guardar","firmar diagnostico","firmar","guardar diagnostico"],function(){
    if(!(HF.sec==="diagnostico"&&S.step===3)){say(HF.sec==="diagnostico"&&S.step===2?"Primero diga «continuar» para revisar lo que se va a firmar.":"«Firmar y guardar» se usa en el paso Firmar del diagnóstico.",true);return;}
    $("save").click(); say("Diagnóstico firmado y guardado en la ficha. Diga «continuar» para seguir con el plan.");}],
  [["cerrar atencion","cerrar la atencion","finalizar atencion"],function(){if(HF.sec!=="plan")showSec("plan");$("closeAt").click();if(S.closed){say("Atención cerrada.");hfStop("Atención cerrada. Grabación detenida.");}else say("Falta registrar el diagnóstico antes de cerrar.",true);}],
  [["borrar ultima frase*","borrar lo ultimo*","deshacer"],undo],
  [["borrar campo*","limpiar campo*"],clearField],
  [["ver comandos","comandos","ayuda","que puedo decir"],function(){var h=$("hfHelp");h.hidden=!h.hidden;$("hfHelpBtn").setAttribute("aria-expanded",String(!h.hidden));}],
  [["detener grabacion*","parar grabacion*","pausar dictado*","apagar microfono*","detener dictado*"],function(){hfStop("Grabación detenida.");}]
];
function command(t){
  for(var i=0;i<CMDS.length;i++){for(var j=0;j<CMDS[i][0].length;j++){if(CMDS[i][0][j].replace("*","")===t){CMDS[i][1]();return true;}}}
  return false;
}
function tailCommand(raw,t){ // «… sin hallazgos punto siguiente sección»
  for(var i=0;i<CMDS.length;i++){for(var j=0;j<CMDS[i][0].length;j++){var p=CMDS[i][0][j];if(p.slice(-1)!=="*")continue;p=p.slice(0,-1);
    if(t.length>p.length&&t.slice(-(p.length+1))===" "+p){var words=raw.trim().split(/\s+/);dictate(words.slice(0,words.length-p.split(" ").length).join(" "));CMDS[i][1]();return true;}}}
  return false;
}
function handle(raw){
  var t=clean(raw); if(!t)return;
  $("hfHeard").textContent="«"+raw.trim()+"»";
  if(command(t)) return;
  var m=t.match(/^(?:ir a|ir al|vamos a|abrir|pasar a) (.+)$/); if(m&&gotoTarget(m[1]))return;
  if(HF.sec==="diagnostico"&&S.step===2){
    var o=numText(t).match(/^opcion (\d)$/), amb=active().filter(function(it){return it.ambiguous&&!it.id&&it.state!=="removed";})[0];
    if(o&&amb){var id=amb.options[+o[1]-1];if(!id){say("Esa opción no existe.",true);return;}amb.id=id;amb.ambiguous=false;amb.conf=0.9;amb.ctx=null;amb.state="confirmed";renderS3();if(!stepAmb())say("«"+amb.abbr+"» = "+C[id].es+". "+(pendings().length?"Diga «aceptar todos».":"Diga «continuar»."));return;}
    var a=t.match(/^(aceptar|descartar|quitar) (.+)$/);
    if(a){var it=findDx(a[2]);if(!it){say("No encontré «"+a[2]+"» entre los diagnósticos sugeridos.",true);return;}it.state=a[1]==="aceptar"?"confirmed":"removed";renderS3();say(dxName(it)+(a[1]==="aceptar"?" aceptado.":" descartado."));return;}
  }
  if(/^agregar (?:un |el )?(?:medicamento|farmaco|remedio)\b/.test(t)){if(HF.sec!=="plan")showSec("plan");addRx(raw);return;}
  if(HF.sec==="examen"&&vitalsByVoice(raw))return;
  if(tailCommand(raw,t))return;
  dictate(raw);
}

/* ---- Reconocimiento mientras el botón está activo ----
   El navegador corta el reconocimiento tras unos segundos de silencio;
   mientras la grabación siga activa se reinicia solo. */
function hfStart(){
  var bar=$("hfBar"); bar.hidden=false; placeBar();
  if(!SR){setState("off","Este navegador no permite dictado por voz. Use Google Chrome o Microsoft Edge.");return;}
  stopField(); stopAll();
  var r=new SR(); r.lang="es-CL"; r.continuous=true; r.interimResults=true; HF.rec=r; HF.on=true;
  r.onresult=function(e){
    var interim="";
    for(var i=e.resultIndex;i<e.results.length;i++){var x=e.results[i]; if(x.isFinal) handle(x[0].transcript); else interim+=x[0].transcript;}
    if(interim){$("hfHeard").textContent="… "+interim; if(HF.sec==="diagnostico"&&S.step===1)showLive(interim);}
  };
  r.onerror=function(e){
    if(e.error==="no-speech"||e.error==="aborted")return;
    var m={"not-allowed":"No hay permiso para usar el micrófono. Permítalo en el ícono del candado de la barra de direcciones.","audio-capture":"No se encontró un micrófono conectado.","network":"El reconocimiento de voz del navegador necesita conexión a internet.","service-not-allowed":"El navegador no permite el reconocimiento de voz en esta página."}[e.error]||("Error de reconocimiento: "+e.error);
    hfStop(m,true);
  };
  r.onend=function(){if(HF.on&&HF.rec===r){try{r.start();}catch(err){}}};
  try{r.start();}catch(err){hfStop("No se pudo iniciar el micrófono: "+err.message,true);return;}
  setState("on"); enterSec(curSec());
  if(!localStorageGet("hfSeen")){$("hfHelp").hidden=false;$("hfHelpBtn").setAttribute("aria-expanded","true");localStorageSet("hfSeen","1");}
}
function hfStop(msg,err){
  var r=HF.rec; HF.on=false; HF.rec=null; if(r){try{r.stop();}catch(e){}}
  clearMark(); setState("off",msg,err); wizUI();
}
function setState(s,msg,err){
  var on=s==="on";
  $("hfBtn").setAttribute("aria-pressed",String(on)); $("hfBtn").classList.toggle("on",on);
  $("hfBtnTxt").textContent=on?"Grabando…":"Grabar";
  $("hfBar").classList.toggle("on",on); document.body.classList.toggle("hf",on);
  $("hfState").textContent=on?"Grabando":"Micrófono detenido";
  $("hfPause").textContent=on?"Detener":"Grabar";
  if(on)$("hfHeard").textContent="Hable con normalidad. Diga «ver comandos» para ver qué puede decir. Pulse el botón del micrófono para detener.";
  if(msg){$("hfAct").textContent=msg;$("hfAct").className="act"+(err?" warn":"");}
  hfWhere();
}
function localStorageGet(k){try{return localStorage.getItem(k);}catch(e){return null;}}
function localStorageSet(k,v){try{localStorage.setItem(k,v);}catch(e){}}
function placeBar(){var d=document.querySelector(".demo");$("hfBar").style.bottom=(d?d.offsetHeight:0)+"px";}
window.addEventListener("resize",placeBar);

function toggleRec(){if(HF.on)hfStop("Grabación detenida.");else hfStart();}
$("hfBtn").addEventListener("click",toggleRec);
$("hfPause").addEventListener("click",toggleRec);
$("hfClose").addEventListener("click",function(){if(HF.on)hfStop();$("hfBar").hidden=true;});
$("hfHelpBtn").addEventListener("click",function(){var h=$("hfHelp");h.hidden=!h.hidden;this.setAttribute("aria-expanded",String(!h.hidden));});

/* ---- Botón físico del micrófono ----
   Los micrófonos de dictado con botón envían una tecla al pulsarlo.
   Configure el micrófono para que envíe la tecla L, o agregue aquí la tecla que envía.
   · Pulsación corta: empieza a grabar; otra pulsación corta, detiene.
   · Mantener pulsado: graba mientras se mantiene y se detiene al soltar.
   La L es una letra: mientras se escribe en un campo de texto, escribe una «l»
   normal y no graba. Fuera de los campos de texto, inicia o detiene la grabación. */
var GRAB_KEYS=["l","L","MediaPlayPause","MediaPlay","MediaPause","MediaRecord"], GRAB_HOLD=600, kDown=0, kStarted=false;
function isGrabKey(e){
  if(GRAB_KEYS.indexOf(e.key)<0||e.ctrlKey||e.altKey||e.metaKey)return false;
  if(e.key.length===1){var t=e.target; if(t&&(t.isContentEditable||t.tagName==="TEXTAREA"||(t.tagName==="INPUT"&&!/^(checkbox|radio|button|submit|reset)$/i.test(t.type))))return false;}
  return true;
}
document.addEventListener("keydown",function(e){
  if(!isGrabKey(e))return; e.preventDefault(); if(e.repeat)return;
  kDown=Date.now(); kStarted=!HF.on; toggleRec();
});
document.addEventListener("keyup",function(e){
  if(!kDown||!isGrabKey(e))return; e.preventDefault();
  var held=Date.now()-kDown; kDown=0;
  if(kStarted&&held>=GRAB_HOLD&&HF.on)hfStop("Grabación detenida.");
});

// Si el médico usa un micrófono de campo o el relato de ejemplo, se detiene la grabación general
document.addEventListener("click",function(e){if(HF.on&&e.target.closest(".dict,#mic,#sampleBtn"))hfStop("Grabación detenida: está usando el micrófono de un campo.");},true);
// Si el médico hace clic en un campo, ese pasa a ser el campo activo (también con el micrófono detenido)
document.addEventListener("focusin",function(e){var fs=fields(HF.sec),i=fs.indexOf(e.target);if(i>=0&&i!==HF.idx)setField(i);});

/* ---- Ayuda contextual ---- */
function li(cmd,txt){return "<li><q>"+cmd+"</q> "+txt+"</li>";}
function helpHTML(){
  var h="<div><h4>En esta sección</h4><ul>";
  if(HF.sec==="diagnostico"){
    if(S.step===1)h+=li("…su dictado…","se escribe en el cuadro de evolución")+li("analizar","busca diagnósticos y códigos");
    if(S.step===2)h+=li("aceptar todos","acepta las sugerencias")+li("opción 1","elige el significado de una abreviatura")+li("aceptar / descartar [diagnóstico]","ej. «descartar cefalea»")+li("continuar","pasa a firmar");
    if(S.step===3)h+=li("firmar y guardar","firma el diagnóstico")+li("volver","regresa a la validación");
    if(S.step===4)h+=li("continuar","pasa al plan");
  } else if(HF.sec==="examen") h+=li("presión 150 sobre 90","")+li("frecuencia cardíaca 80","")+li("temperatura 37 coma 5","")+li("saturación 96 · peso 70 · talla 1 coma 60","")+li("…su dictado…","se escribe en el campo resaltado");
  else if(HF.sec==="plan") h+=li("…su dictado…","se escribe en el campo resaltado")+li("agregar medicamento paracetamol 500 mg 1 comprimido cada 8 horas por 5 días","")+li("sí / no","en reposo o licencia")+li("cerrar atención","firma y cierra la atención");
  else h+=li("…su dictado…","se escribe en el campo resaltado")+li("sí / no","en casillas como reposo o licencia")+li("una opción de la lista","ej. «cardiología», «en un mes»");
  h+="</ul></div><div><h4>Siempre disponibles</h4><ul>"+li("continuar","siguiente sección o paso")+li("volver","sección o paso anterior")+li("siguiente campo / campo anterior","")+li("ir a recetas · ir a antecedentes","salta a una sección o campo")+li("borrar última frase · borrar campo","")+li("punto · coma · punto aparte","puntuación")+li("detener grabación","apaga el micrófono (o pulse su botón)")+"</ul></div>";
  return h;
}


/* ---- 6. Paciente de la atención ----
   La ficha se abre como ficha.html?paciente=<N° de ficha>, elegido en la lista de pacientes. */
var FICHA=new URLSearchParams(location.search).get("paciente"), PAC=FICHA?VitalisDatos.paciente(FICHA):null;
if(!PAC){location.replace("pacientes.html");return;}
$("pNombre").textContent=PAC.nombre; $("pEdad").textContent=PAC.edad+" años"; $("pSexo").textContent=PAC.sexo;
$("pPrev").textContent=PAC.prevision; $("pFicha").textContent="N° "+PAC.ficha; $("pAlerg").textContent=PAC.alergias;
if(PAC.alergias!=="Sin alergias conocidas") $("pAlerg").classList.add("alerta");
document.title="Vitalis Help · "+PAC.nombre;
VitalisDatos.iniciar(FICHA);
// Al cerrar la atención: guardar el resumen y ofrecer volver a la lista
$("closeAt").addEventListener("click",function(){
  if(!S.closed||$("volverLista")) return;
  VitalisDatos.cerrar(FICHA,$("sumAll").innerHTML);
  $("closeMsg").insertAdjacentHTML("beforeend",'<p style="margin:14px 0 0"><a class="btn primary" id="volverLista" href="pacientes.html">Volver a mis pacientes</a></p>');
});
// Volver a la lista: si hay algo registrado y no se cerró la atención, avisar antes
function irALista(){location.href="pacientes.html";}
$("volverPac").addEventListener("click",function(){
  var hayDatos=SEC.some(has)||planListo();
  if(S.closed||!hayDatos){irALista();return;}
  $("avisoSalir").hidden=false; $("avisoQuedar").focus();
});
$("avisoQuedar").addEventListener("click",function(){$("avisoSalir").hidden=true;$("volverPac").focus();});
$("avisoVolver").addEventListener("click",irALista);

/* ---- 7. Funciones que usa dictado.js (dictado de la atención completa) ---- */
window.VitalisFicha={
  punct:punct, cap:cap, fixVoz:fixVoz, esc:esc, fire:fire, SR:SR,
  rx:function(){return S.rx;}, setRx:function(l){S.rx=l;renderRx();refreshStatus();},
  vitals:vitals, refreshStatus:refreshStatus, showSec:showSec, go:go, curSec:curSec,
  setTxt:function(t){$("txt").value=t;}, getTxt:function(){return $("txt").value;},
  meds:function(){return Array.prototype.map.call(document.querySelectorAll("#meds option"),function(o){return o.value;});},
  // detiene cualquier otro micrófono de la ficha antes de empezar el dictado completo
  detenerTodo:function(){stopField();stopAll();if(HF.on)hfStop("Grabación detenida: está usando el dictado de la atención completa.");},
  cie11Base:function(){return CIE11.base;}, cie11Estado:function(){return CIE11.estado;}
};

go(1);
})();
