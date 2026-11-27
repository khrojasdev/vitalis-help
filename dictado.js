/* Vitalis Help · dictado de la atención completa
   El médico dicta toda la atención de una vez y, al terminar, el texto se reparte en los campos
   de la ficha (relato del paciente, examen físico, diagnóstico y plan). Nada se firma solo:
   cada campo llenado queda marcado «Desde el dictado» para que el médico lo revise.

   Dos formas de repartir:
   1. Reglas (siempre disponible, también en la versión publicada): reconoce las secciones que el
      médico nombra («motivo de consulta…», «antecedentes…», «al examen…», «diagnóstico…»,
      «indicaciones…», «receta…») y, si no las nombra, clasifica cada frase por su contenido.
   2. IA (opcional): si servidor.py está iniciado y tiene ANTHROPIC_API_KEY en .env, el texto se
      envía al servidor, que lo reparte con un modelo de lenguaje. Si falla, se usan las reglas.
   Este archivo no se comunica con la OMS ni con la IA directamente: solo con servidor.py. */

var VitalisReparto = (function () {
  "use strict";

  // Minúsculas y sin tildes, con el mismo largo que el texto original (para cortar en las mismas posiciones)
  function nrm(s) { return String(s || "").normalize("NFC").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function limpiar(t) { return String(t || "").replace(/\s+/g, " ").replace(/^[\s,;:.\-–y]+(?=\S)/i, "").replace(/^y\s+/i, "").replace(/[\s,;:\-–]+$/, "").trim(); }
  function mayus(t) { t = limpiar(t); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ""; }
  function punto(t) { t = mayus(t); return t && !/[.!?]$/.test(t) ? t + "." : t; }

  var NUM = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30 };
  // «treinta y seis coma seis» → 36,6 · «uno coma sesenta» → 1,60 (para leer signos vitales)
  function numeros(t) {
    return nrm(t).replace(/\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta)\b/g, function (w) { return NUM[w]; })
      .replace(/(\d+)\s*(?:coma|punto)\s*(\d+)/g, "$1,$2").replace(/(\d)\.(\d)/g, "$1,$2").replace(/(\d+)\s*metros?\s*(?:con\s*)?(\d+)/g, "$1,$2");
  }

  /* ---------- Secciones que el médico puede nombrar ----------
     Cada una: [clave, expresión al comienzo de la frase, ¿se quita el encabezado?] */
  var ENCABEZADOS = [
    ["motivo", /^(?:el\s+)?motivo(?:\s+de\s+(?:la\s+)?consulta)?\s*(?:es\s+)?[:,\-–]?\s*/, true],
    ["motivo", /^(?:consulta|acude|viene|asiste)\s+(?:por|debido a|a control)\b/, false],
    ["ea", /^(?:enfermedad actual|historia(?: de la enfermedad)? actual|anamnesis(?: proxima)?|relato del paciente)\s*[:,\-–]?\s*/, true],
    ["ant", /^(?:como\s+)?antecedentes?(?:\s+(?:morbidos|medicos|personales|de importancia|relevantes))?\s*[:,\-–]?\s*(?:de\s+)?/, true],
    ["med", /^(?:medicamentos?|farmacos|tratamiento)(?:\s+de\s+uso)?(?:\s+habituale?s?)?\s*[:,\-–]\s*/, true],
    ["med", /^(?:medicamentos|farmacos) habituales\s*[:,\-–]?\s*/, true],
    ["hab", /^habitos\s*[:,\-–]?\s*/, true],
    ["exa", /^(?:examenes(?:\s+solicitados)?|laboratorio)\s*[:,\-–]?\s*/, true],
    ["ef", /^(?:al\s+)?examen(?!es)(?:\s+fisico)?(?:\s+general)?(?:\s+y\s+segmentario)?\b\s*[:,\-–]?\s*/, true],
    ["ef", /^signos vitales\s*[:,\-–]?\s*/, true],
    ["dx", /^(?:los\s+|el\s+)?(?:diagnosticos?|impresion diagnostica|hipotesis diagnosticas?|evaluacion)\s*(?:es|son)?\s*[:,\-–]?\s*/, true],
    ["ind", /^(?:las\s+)?(?:indicaciones|plan(?:\s+de\s+(?:manejo|tratamiento))?|manejo)\s*[:,\-–]?\s*/, true],
    ["exa", /^(?:se\s+)?solicit(?:o|an?|amos)\s+(?:examenes\s*(?:de\s+)?)?/, true],
    ["rx", /^(?:recetas?|receta medica|medicamentos indicados|tratamiento indicado|farmacos indicados)\s*[:,\-–]?\s*/, true],
    ["rx", /^(?:se\s+)?(?:receta|receto|prescribo)\s+/, true]
  ];
  // Encabezados que también se reconocen en medio de una frase (dictado sin «punto»)
  var CORTES = /\b(motivo de (?:la )?consulta|enfermedad actual|antecedentes(?: morbidos)?(?! de (?:esfuerzo|hoy))|medicamentos habituales|habitos|al examen(?: fisico)?|examen fisico|signos vitales|impresion diagnostica|diagnosticos?(?! de\b| del\b| diferencial)|impresion|indicaciones|examenes(?: solicitados)?(?=\s*:|\s+(?:solicitados|de laboratorio|hemograma|perfil|hemoglobina|creatinina|orina|glicemia))|receta(?: medica)?(?=\s*:|\s+[a-z]+ \d)|(?:el |la )?paciente (?:refiere|relata|cuenta|comenta)|(?:usa|toma|utiliza)(?= [a-z]+ \d)|control en|se solicita|solicito|(?:se )?deriv(?:o|a|ar|amos)\b|en tratamiento con(?= [a-z]+ \d)|(?:se indica |indico )?(?:reposo|licencia(?: medica)?)(?= (?:por|de) \w+ dias))\b/g;
  var NO_CORTE_ANTES = /\b(con|el|un|su|sus|de|del|sin|al|por|los|las|la|y|e|o|en)\s*$/;

  /* ---------- Clasificación por contenido (frases sin encabezado) ---------- */
  var R = {
    hab: /\b(no fuma|fuma|fumador[a]?|exfumador[a]?|ex fumador[a]?|tabaco|tabaquismo|cigarrillos?|alcohol|bebe(?:dor)?|consume alcohol)\b/,
    motivo: /\b(consulta por|motivo|acude por|viene por)\b/,
    ant: /\b(antecedentes?|es (?:hipertens|diabetic|asmatic)\w*|operad[oa] de|cirugia previa|historia de)\b/,
    usa: /\b(usa|toma|utiliza|en tratamiento con|tratamiento habitual)\b/,
    dosis: /\b\d+(?:,\d+)?\s?(?:mg|mcg|g|ml|ui|miligramos?|microgramos?|gramos?)\b/,
    frec: /\b(cada \d+|cada \w+ horas|veces al dia|al dia|diari[oa]|en ayunas|en la noche|en la manana|segun necesidad|sos)\b/,
    indicarRx: /^(?:se\s+)?(?:indica|indico|receta|receto|prescribe|prescribo|inicia|inicio|iniciar|agrego|agregar|tomar|dejo|mantener|mantengo)\b/,
    ef: /\b(al examen|se ausculta|ausculta|auscultacion|murmullo|crepitos|sibilancias|roncus|abdomen|faringe|amigdalas|lucid[oa]|orientad[oa]|hidratad[oa]|edema|pupilas|ruidos cardiacos|soplos?|mucosas|lasegue|contractura|blando|depresible|otoscopia|signos meningeos|focalidad|palpacion|se palpa|sin hallazgos|conjuntivas|adenopatias|ritmo regular|bien perfundid[oa]|afebril)\b/,
    dx: /\b(diagnostico|impresion|compatible con|se plantea|se descarta|descarto|sospecha de|probable|cuadro de)\b/,
    exaVerbo: /\b(solicito|se solicitan?|pido|pedir|examenes solicitados|tomar examenes)\b/,
    exa: /\b(examenes?|hemograma|perfil lipidico|perfil bioquimico|hemoglobina glicosilada|creatinina|orina completa|urocultivo|radiografia|ecografia|electrocardiograma|ecocardiograma|glicemia|tsh|t4|pcr|vhs|electrolitos)\b/,
    ind: /\b(se indica|indico|reposo|dieta|control en|controlarse|consultar|evitar|hidratacion|licencia|deriv\w*|elevar|ejercicios|calor local|frio local|registro|medir|regimen|restriccion|restringir|suspender|suspende|aumentar|disminuir|reducir|bajar de peso|actividad fisica|alimentacion|educacion|acudir|volver a consultar|signos de alarma)\b/,
    ea: /\b(refiere|relata|cuenta|comenta|niega|presenta|evolucion|desde hace|hace \d+ (?:horas|dias|semanas|meses)|hace (?:un|una|dos|tres|cuatro|cinco|varios|varias) (?:horas|dias|semanas|meses)|desde ayer|desde anoche|inicio|comenzo|empezo)\b/
  };
  var PLAN = { ind: 1, exa: 1, rx: 1 };

  function clasificar(n, actual) {
    if (R.hab.test(n) && n.split(" ").length <= 14) return "hab";
    if (/^(?:el |la )?(?:paciente )?(?:refiere|relata|cuenta|comenta|niega|presenta desde|senala)\b/.test(n) && !PLAN[actual] && actual !== "dx") return "ea";
    if (R.motivo.test(n) && !actual) return "motivo";
    if (/^(?:sin|no tiene|no refiere) antecedentes/.test(n) || /^antecedentes?\b/.test(n)) return "ant";
    var esRx = R.dosis.test(n) && (R.frec.test(n) || R.indicarRx.test(n));
    if (esRx && (R.indicarRx.test(n) || PLAN[actual] || actual === "dx")) return "rx";
    if (R.usa.test(n) && (R.dosis.test(n) || R.frec.test(n))) return "med";
    if (R.ant.test(n) && !PLAN[actual] && actual !== "ef") return "ant";
    if (R.exaVerbo.test(n)) return "exa";
    if (R.exa.test(n) && (PLAN[actual] || actual === "dx")) return "exa";
    if (R.ind.test(n) && (PLAN[actual] || actual === "dx" || /^(se indica|indico|reposo|control|dieta|licencia|deriv)/.test(n))) return "ind";
    if (R.dx.test(n) && actual !== "ea" && actual !== "motivo") return "dx";
    if (vitales(n, true) || R.ef.test(n)) return actual === "dx" || PLAN[actual] ? (R.ef.test(n) && !vitales(n, true) ? actual : "ef") : "ef";
    if (R.ea.test(n) && !PLAN[actual] && actual !== "dx") return "ea";
    return null;
  }

  /* ---------- Signos vitales ---------- */
  var VITALES = [
    ["pas", /\b(?:presion(?: arterial)?|pa)(?: de)?\s*(\d{2,3})\s*(?:sobre|con|\/|partido por|-|,)?\s*(\d{2,3})\b(?:\s*(?:mmhg|milimetros de mercurio))?/],
    ["fc", /\b(?:frecuencia cardiaca|pulso|fc)(?: de)?\s*(\d{2,3})\b(?:\s*(?:lpm|latidos(?: por minuto)?|por minuto))?/],
    ["fr", /\b(?:frecuencia respiratoria|fr)(?: de)?\s*(\d{1,2})\b(?:\s*(?:rpm|respiraciones(?: por minuto)?|por minuto))?/],
    ["temp", /\b(?:temperatura(?: axilar)?|t°?|temp)(?: de)?\s*(\d{2}(?:,\d)?)\b(?:\s*(?:grados|°c?|°))?/],
    ["sat", /\b(?:saturacion(?: de oxigeno| o2| de o2| oxigeno)?|sat(?: o2)?|so2)(?: de)?\s*(\d{2,3})\b\s*(?:%|por ciento)?/],
    ["peso", /\b(?:peso|pesa)(?: de)?\s*(\d{2,3}(?:,\d+)?)\b(?:\s*(?:kilos|kilogramos|kg))?/],
    ["talla", /\b(?:talla|estatura|mide)(?: de)?\s*(\d,\d{1,2}|\d{3})\b(?:\s*(?:metros?|m|centimetros|cm))?/]
  ];
  // Devuelve los signos vitales de un texto (o solo si hay alguno, con soloProbar)
  function vitales(t, soloProbar) {
    var v = numeros(t), out = {}, hay = false;
    VITALES.forEach(function (x) {
      var m = v.match(x[1]); if (!m) return; hay = true;
      if (x[0] === "pas") { out.pas = m[1]; out.pad = m[2]; } else out[x[0]] = m[1];
    });
    return soloProbar ? hay : out;
  }
  var RESTO_VITAL = /^(?:y|e|de|con|en|la|el|los|las|una?|mmhg|lpm|rpm|kg|kilos|grados|metros?|cm|por|minuto|ciento|%|°c?|signos|vitales|presion|arterial|frecuencia|cardiaca|respiratoria|temperatura|saturacion|oxigeno|o2|peso|talla|sobre|axilar|\d+(?:,\d+)?)$/;
  // Quita del texto las partes que son solo signos vitales (ya quedan en sus casillas)
  function sinVitales(t) {
    var n0 = nrm(t), tramos = [];
    VITALES.forEach(function (x) { var re = new RegExp(x[1].source, "g"), m; while ((m = re.exec(n0))) tramos.push([m.index, m.index + m[0].length]); });
    tramos.sort(function (a, b) { return b[0] - a[0]; }).forEach(function (r) { t = t.slice(0, r[0]) + " " + t.slice(r[1]); });
    t = t.replace(/(?:^|[\s,;])(?:y|e)(?=\s*(?:[,;.]|$))/g, " ").replace(/\s*,\s*(?:,\s*)+/g, ", ").replace(/^[\s,;.]+/, "").replace(/\s{2,}/g, " ");
    var protegido = t.replace(/(\d)\s*,\s*(\d)/g, "$1‚$2");
    return protegido.split(/(?<=[,;.])\s*|\s+y\s+(?=(?:frecuencia|temperatura|saturacion|saturación|peso|talla|pulso|presión|presion)\b)/i)
      .filter(function (c) {
        var n = numeros(c.replace(/‚/g, ",")).replace(/\//g, " ");
        if (!vitales(n, true)) return true;
        return !n.replace(/[.,;:]/g, " ").split(/\s+/).filter(Boolean).every(function (w) { return RESTO_VITAL.test(w); });
      }).join(" ").replace(/‚/g, ",").replace(/\s+([,.;])/g, "$1").replace(/[,;]\s*$/, ".").trim();
  }

  /* ---------- Hábitos, derivación, control, reposo ---------- */
  function habitos(n, out) {
    if (/\b(no fuma|niega (?:tabaco|tabaquismo|fumar)|sin tabaco|no fumador)/.test(n)) out.tab = 0;
    else if (/\b(ex ?fumador|dejo de fumar|exfumadora)/.test(n)) out.tab = 2;
    else if (/\b(fuma|fumador|fumadora|tabaquismo|cigarrillos)\b/.test(n)) out.tab = 1;
    if (/\b(no (?:bebe|consume alcohol|toma alcohol)|niega (?:alcohol|oh)|sin alcohol|no consume)\b/.test(n)) out.alc = 0;
    else if (/\b(alcohol (?:frecuente|diario|todos los dias)|bebe (?:frecuentemente|todos los dias|a diario)|consumo frecuente)/.test(n)) out.alc = 2;
    else if (/\b(alcohol ocasional|ocasional(?:mente)?|bebe (?:ocasionalmente|socialmente|los fines de semana)|consumo social)/.test(n)) out.alc = 1;
  }
  var DERIV = ["cardiologia", "nefrologia", "endocrinologia", "gastroenterologia", "traumatologia", "psiquiatria", "broncopulmonar"];
  var CONTROL = [[/\b(?:1|una) semana\b/, 1], [/\b(?:2|dos) semanas\b|\b15 dias\b|\bquince dias\b/, 2], [/\b(?:1|un) mes\b/, 3], [/\b(?:3|tres) meses\b/, 4]];
  function plan(n, out) {
    var m = n.match(/\bderiv\w*(?: (?:a|al|con|hacia))?(?: (?:la|el|especialista en|policlinico de))? (\w+)/);
    if (m) DERIV.forEach(function (d, i) { if (d.indexOf(m[1].slice(0, 6)) === 0 || (m[1] === "broncopulmonar" && i === 6)) out.der = i + 1; });
    if (/\bcontrol\b/.test(n)) { var v = numeros(n); CONTROL.forEach(function (c) { if (out.ctrl == null && c[0].test(v)) out.ctrl = c[1]; }); }
    if (/\breposo\b/.test(n)) out.rep = true;
    if (/\blicencia\b/.test(n)) out.lic = true;
    var d = numeros(n).match(/\b(?:por|de|x)\s+(\d{1,2})\s+dias\b/);
    if (d && /\b(reposo|licencia)\b/.test(n)) out.dias = d[1];
  }
  // Frases del plan que ya quedaron en una casilla (control, derivación, reposo/licencia) no se repiten como texto
  function esSoloCasilla(n) {
    return /^(?:y\s+)?(?:control(?: en| a| dentro de)? [\w\s]{1,20}|(?:se\s+)?deriv\w*(?: a| al| con)? \w+|(?:se\s+)?(?:indica\s+)?(?:reposo|licencia(?: medica)?)(?: y (?:reposo|licencia(?: medica)?))?(?: (?:por|de) \w+ dias)?)\.?$/.test(n.trim());
  }

  /* ---------- Recetas ---------- */
  var INICIO_RX = /^(?:y\s+)?(?:se\s+)?(?:indica|indico|receta|receto|prescribe|prescribo|inicia|inicio|iniciar|agrego|agregar|tomar|toma|dejo|mantener|mantengo)?\s*(?:con\s+)?(?:el\s+|la\s+)?(?:medicamento\s+)?/;
  var NUEVO_RX = /^(?:y\s+)?(?:se\s+)?(?:(?:indica|indico|receta|receto|agrego|iniciar|inicio)\s+)?[a-z]+(?:\s+[a-z]+)?\s+\d+(?:,\d+)?\s?(?:mg|mcg|g|ml|ui|miligramos?|microgramos?)\b/;
  function separarRx(t) {
    var partes = t.split(/;\s*|,\s*(?=y\s|[a-záéíóúñ])|\s+y\s+(?=[a-záéíóúñ]+(?:\s+[a-záéíóúñ]+)?\s+\d)/i).map(limpiar).filter(Boolean), out = [];
    partes.forEach(function (p) { if (!out.length || NUEVO_RX.test(nrm(p))) out.push(p); else out[out.length - 1] += ", " + p; });
    return out;
  }
  function parseRx(texto, vademecum) {
    var r = limpiar(texto).replace(/\.$/, ""), n = nrm(r), m = n.match(INICIO_RX);
    if (m && m[0]) { r = r.slice(m[0].length); n = n.slice(m[0].length); }
    var row = { med: "", dosis: "", frec: "", dur: "" }, cut = n.length;
    var p = n.search(/,?\s+(?:por|durante)\s+(?:\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|treinta)\s+(?:dias|semanas|meses)/);
    if (p >= 0) { row.dur = limpiar(r.slice(p).replace(/^,?\s*(?:por|durante)\s+/i, "")); cut = p; }
    else { var pc = n.search(/,?\s+(?:de\s+)?(?:uso cronico|en forma permanente|permanente|indefinid[oa])/); if (pc >= 0) { row.dur = mayus(r.slice(pc).replace(/^,?\s*(?:de\s+)?/, "")); cut = pc; } }
    var c = n.slice(0, cut).search(/,?\s*(?:^|\s)(?:cada|\d+ veces al dia|una vez al dia|dos veces al dia|tres veces al dia|al dia|en ayunas|en la noche|en la manana|segun necesidad|si hay (?:dolor|fiebre|sintomas))/);
    if (c >= 0) { row.frec = mayus(r.slice(c, cut)); cut = c; }
    var d = n.slice(0, cut).match(/,?\s*(?:\d+|un|una|medio|media)\s+(?:comprimidos?|capsulas?|tabletas?|inhalaciones?|puff|gotas|sobres?|ampollas?|cucharadas?|ml)\b/);
    if (d) { row.dosis = limpiar(r.slice(d.index, d.index + d[0].length)); cut = d.index; }
    row.med = limpiar(r.slice(0, cut));
    if (row.med) {
      var nm = nrm(row.med).replace(/ miligramos?/g, " mg").replace(/ microgramos?/g, " mcg");
      var hit = (vademecum || []).filter(function (o) { return nrm(o).indexOf(nm) === 0; })[0];
      row.med = hit || mayus(row.med.replace(/ miligramos?/gi, " mg").replace(/ microgramos?/gi, " mcg"));
    }
    return row;
  }

  /* ---------- Reparto principal ---------- */
  function frases(texto) {
    var t = String(texto || "").normalize("NFC").replace(/(\d+)\s+(?:coma)\s+(\d+)/gi, "$1,$2"), out = [];
    t.split(/(?<=[.;!?])\s+|\n+/).forEach(function (f) {
      f = f.trim(); if (!f) return;
      // Corta también donde el médico nombra una sección sin haber dicho «punto»
      var n = nrm(f), pos = [0], m; CORTES.lastIndex = 0;
      while ((m = CORTES.exec(n))) { if (m.index > 0 && !NO_CORTE_ANTES.test(n.slice(0, m.index))) pos.push(m.index); }
      pos.push(f.length);
      for (var i = 0; i < pos.length - 1; i++) { var s = f.slice(pos[i], pos[i + 1]).trim(); if (s) out.push(s); }
    });
    return out;
  }

  function repartir(texto, opciones) {
    opciones = opciones || {};
    var sec = { motivo: [], ea: [], ant: [], med: [], ef: [], dx: [], ind: [], exa: [], rx: [] };
    var out = { vit: {}, rx: [] }, actual = null;
    frases(texto).forEach(function (f) {
      var n = nrm(f), clave = null, cuerpo = f;
      for (var i = 0; i < ENCABEZADOS.length; i++) {
        var m = n.match(ENCABEZADOS[i][1]);
        if (m) { clave = ENCABEZADOS[i][0]; if (ENCABEZADOS[i][2]) cuerpo = f.slice(m[0].length); break; }
      }
      var nc = nrm(cuerpo);
      if (!clave) clave = clasificar(nc, actual) || actual || "ea";
      // Signos vitales: en cualquier parte del dictado
      var v = vitales(nc); for (var k in v) if (out.vit[k] == null) out.vit[k] = v[k];
      if (R.hab.test(nc)) {
        habitos(nc, out);
        var resto = cuerpo.split(/,\s*|;\s*|\s+y\s+(?=(?:no\s+)?(?:fuma|bebe|consume|alcohol|tabaco))/i).filter(function (c) { return !R.hab.test(nrm(c)); }).join(", ");
        if (!limpiar(resto)) { actual = actual || "ant"; return; }
        if (clave === "hab") { cuerpo = resto; nc = nrm(cuerpo); clave = clasificar(nc, actual) || actual || "ant"; if (clave === "hab") clave = "ant"; }
        else { cuerpo = resto; nc = nrm(cuerpo); }
      }
      if (PLAN[clave] || clave === "dx") plan(nc, out);
      if (Object.keys(v).length) { cuerpo = sinVitales(cuerpo); if (!limpiar(cuerpo)) { actual = clave === "ef" || !actual ? "ef" : actual; return; } }
      if (clave === "ind" && R.dosis.test(nrm(cuerpo)) && R.frec.test(nrm(cuerpo))) clave = "rx";
      if (PLAN[clave] && esSoloCasilla(nrm(limpiar(cuerpo)))) { actual = clave === "rx" ? "rx" : "ind"; return; }
      if (clave === "rx") { separarRx(cuerpo).forEach(function (p) { var row = parseRx(p, opciones.vademecum); if (row.med) out.rx.push(row); }); actual = "rx"; return; }
      if (limpiar(cuerpo)) sec[clave].push(cuerpo);
      actual = clave;
    });
    out.motivo = sec.motivo.map(punto).join(" ");
    out.ea = sec.ea.map(punto).join(" ");
    out.ant = sec.ant.map(punto).join(" ");
    out.med = sec.med.map(punto).join(" ");
    out.ef = sec.ef.map(punto).join(" ");
    out.dx = sec.dx.map(punto).join(" ");
    out.ind = sec.ind.map(punto).join(" ");
    out.exa = sec.exa.map(punto).join(" ");
    return out;
  }

  return { repartir: repartir, parseRx: parseRx, numeros: numeros, nrm: nrm };
})();
if (typeof module !== "undefined") module.exports = VitalisReparto;

/* ======================= Panel en la ficha ======================= */
(function () {
  "use strict";
  if (typeof document === "undefined" || !document.getElementById("dictPanel") || !window.VitalisFicha) return;
  var F = window.VitalisFicha;
  function $(id) { return document.getElementById(id); }
  var EJEMPLOS = [
    "Motivo de consulta: dolor de cabeza de tres días. El paciente refiere cefalea opresiva que cede parcialmente con paracetamol, niega fiebre y vómitos, y refiere presiones elevadas en su casa. Antecedentes: hipertensión arterial y diabetes mellitus tipo 2. Usa losartán 50 mg cada 12 horas y metformina 850 mg cada 12 horas. No fuma, alcohol ocasional. Al examen: presión 152 sobre 94, frecuencia cardíaca 78, temperatura 36,6, saturación 98, peso 78, talla 1,62. Lúcida, orientada, sin signos meníngeos ni focalidad neurológica. Diagnóstico: HTA mal controlada y DM2, cefalea tensional, se descarta ACV. Indicaciones: control de presión en domicilio dos veces al día, dieta baja en sodio, consultar en urgencia si presenta cefalea intensa. Exámenes: hemoglobina glicosilada, perfil lipídico y creatinina. Receta: paracetamol 500 mg 1 comprimido cada 8 horas por 5 días. Control en un mes.",
    "Consulta por tos y fiebre desde hace dos días. Refiere tos seca, dolor de garganta y fiebre hasta 38,5. Sin antecedentes mórbidos, no usa medicamentos, no fuma. Al examen temperatura 38,2, frecuencia cardíaca 92, saturación 97. Faringe congestiva sin exudado, murmullo pulmonar conservado sin ruidos agregados. Diagnóstico IRA alta, sin disnea. Indico reposo e hidratación abundante, consultar si presenta dificultad para respirar. Paracetamol 500 mg 1 comprimido cada 8 horas por 3 días. Licencia médica por 3 días.",
    "motivo de consulta dolor lumbar de una semana paciente refiere dolor lumbar después de cargar peso sin irradiación antecedentes hipotiroidismo usa levotiroxina 50 mcg al día al examen contractura paravertebral lumbar lasègue negativo diagnóstico lumbago indicaciones calor local y evitar cargar peso receta ibuprofeno 400 mg 1 comprimido cada 8 horas por 5 días control en dos semanas"
  ];
  var CAMPOS = { motivo: "f_motivo", ea: "f_ea", ant: "f_ant", med: "f_med", ef: "f_ef", ind: "f_ind", exa: "f_exa" };
  var NOMBRES = { motivo: "S · Motivo de consulta", ea: "S · Enfermedad actual", ant: "S · Antecedentes", med: "S · Medicamentos habituales", hab: "S · Hábitos", vit: "O · Signos vitales", ef: "O · Examen físico", dx: "A · Evolución y diagnóstico", ind: "P · Indicaciones", exa: "P · Exámenes", casillas: "P · Derivación, control, reposo", rx: "P · Recetas" };
  var SECCION = { motivo: "paciente", ea: "paciente", ant: "paciente", med: "paciente", hab: "paciente", vit: "examen", ef: "examen", dx: "diagnostico", ind: "plan", exa: "plan", casillas: "plan", rx: "plan" };
  var VIT = { pas: "f_pas", pad: "f_pad", fc: "f_fc", fr: "f_fr", temp: "f_temp", sat: "f_sat", peso: "f_peso", talla: "f_talla" };
  var rec = null, escuchando = false, reloj = null, segs = 0, ejemplo = 0, copia = null, ia = { base: null, lista: false };

  /* ---- Abrir y cerrar ---- */
  function abrir(ver) {
    $("dictPanel").hidden = !ver; $("dictBtn").setAttribute("aria-expanded", String(ver));
    if (ver) { $("dictPanel").scrollIntoView({ block: "start", behavior: "smooth" }); probarIA(); } else detener();
  }
  $("dictBtn").addEventListener("click", function () { abrir($("dictPanel").hidden); });
  $("dictCerrar").addEventListener("click", function () { abrir(false); });

  /* ---- Micrófono continuo ---- */
  function estado(t, err) { var e = $("dictEstado"); e.textContent = t; e.className = "dict-estado" + (err ? " warn" : ""); }
  function reloj0() { clearInterval(reloj); reloj = setInterval(function () { segs++; $("dictReloj").textContent = ("0" + Math.floor(segs / 60)).slice(-2) + ":" + ("0" + segs % 60).slice(-2); }, 1000); }
  function ui(on) { $("dictMic").classList.toggle("on", on); $("dictMic").setAttribute("aria-label", on ? "Pausar el dictado" : "Dictar la atención"); $("dictOnda").classList.toggle("on", on); if (!on) clearInterval(reloj); }
  function escuchar() {
    if (!F.SR) { estado("Este navegador no permite dictado por voz. Use Google Chrome o Microsoft Edge, o escriba el texto.", true); return; }
    F.detenerTodo();
    var r = new F.SR(); r.lang = "es-CL"; r.continuous = true; r.interimResults = true; rec = r; escuchando = true;
    r.onresult = function (e) {
      var parcial = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var x = e.results[i];
        if (x.isFinal) { var ta = $("dictTxt"), t = x[0].transcript.replace(/(\d+)\s+coma\s+(\d+)/gi, "$1,$2"); ta.value = F.cap(F.punct((ta.value + " " + t).trim())); ta.scrollTop = ta.scrollHeight; }
        else parcial += x[0].transcript;
      }
      $("dictParcial").textContent = parcial ? "… " + parcial : "";
    };
    r.onerror = function (e) {
      if (e.error === "no-speech" || e.error === "aborted") return;
      var m = { "not-allowed": "No hay permiso para usar el micrófono. Permítalo en el ícono del candado de la barra de direcciones.", "audio-capture": "No se encontró un micrófono conectado.", "network": "El reconocimiento de voz del navegador necesita conexión a internet." }[e.error];
      detener(); estado(m || ("Error de reconocimiento: " + e.error), true);
    };
    // El navegador corta tras unos segundos de silencio: mientras el dictado siga activo, se reinicia solo
    r.onend = function () { if (escuchando && rec === r) { try { r.start(); } catch (err) {} } };
    try { r.start(); } catch (err) { estado("No se pudo iniciar el micrófono: " + err.message, true); escuchando = false; return; }
    ui(true); reloj0(); estado("Escuchando… dicte toda la atención. Diga «punto» entre frases.");
  }
  function detener() {
    var r = rec; escuchando = false; rec = null; if (r) { try { r.stop(); } catch (e) {} }
    ui(false); $("dictParcial").textContent = "";
    if ($("dictTxt").value.trim()) estado("Dictado en pausa. Corrija el texto si es necesario y pulse «Repartir en la ficha».");
  }
  $("dictMic").addEventListener("click", function () { if (escuchando) detener(); else escuchar(); });
  // Si el médico usa otro micrófono de la ficha (Grabar, un campo o el del diagnóstico), se pausa este dictado
  document.addEventListener("click", function (e) { if (escuchando && e.target.closest && e.target.closest("#hfBtn, #hfPause, .dict, #mic")) detener(); }, true);
  $("dictEjemplo").addEventListener("click", function () {
    detener(); $("dictTxt").value = EJEMPLOS[ejemplo % EJEMPLOS.length]; ejemplo++;
    estado("Dictado de ejemplo cargado" + (ejemplo === 3 ? " (sin «punto»: así se ve si el médico no dicta la puntuación)" : "") + ". Pulse «Repartir en la ficha».");
  });
  $("dictBorrar").addEventListener("click", function () { detener(); $("dictTxt").value = ""; segs = 0; $("dictReloj").textContent = "00:00"; estado("Pulse el micrófono y dicte toda la atención de corrido."); $("dictRes").innerHTML = ""; });

  /* ---- IA opcional (servidor.py con ANTHROPIC_API_KEY) ---- */
  function probarIA() {
    if (ia.base !== null) return;
    var cfg = ((window.VITALIS_CONFIG || {}).iaApi || "").replace(/\/+$/, "");
    var local = location.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    var bases = cfg ? [cfg] : location.protocol === "file:" ? ["http://localhost:8000/api/ia"] : local ? ["/api/ia", "http://localhost:8000/api/ia"] : [];
    ia.base = "";
    (function intentar(i) {
      if (i >= bases.length) { mostrarIA(); return; }
      fetch(bases[i] + "/estado").then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (d) { ia.base = bases[i]; ia.lista = !!d.configurado; ia.modelo = d.modelo || ""; mostrarIA(); })
        .catch(function () { intentar(i + 1); });
    })(0);
  }
  function mostrarIA() {
    var box = $("dictIA"), chk = $("dictUsarIA");
    if (ia.lista) { box.hidden = false; chk.disabled = false; chk.checked = true; $("dictIANota").textContent = "El texto se envía a servidor.py, que lo reparte con IA (" + ia.modelo + "). Solo para datos ficticios: en la clínica se usaría un modelo instalado en sus servidores."; }
    else if (ia.base) { box.hidden = false; chk.disabled = true; chk.checked = false; $("dictIANota").textContent = "Para repartir con IA, agregue ANTHROPIC_API_KEY al archivo .env y reinicie iniciar.bat. Mientras tanto se usan las reglas."; }
    else box.hidden = true;
  }
  function conIA(texto) {
    return fetch(ia.base + "/repartir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto: texto }) })
      .then(function (r) { if (!r.ok) return r.json().then(function (e) { throw new Error(e.detail || r.status); }); return r.json(); });
  }

  /* ---- Repartir y llenar la ficha ---- */
  function tomarCopia() {
    var c = { campos: {}, rx: JSON.parse(JSON.stringify(F.rx())), txt: F.getTxt() };
    document.querySelectorAll("[data-store]").forEach(function (el) { c.campos[el.id] = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? el.selectedIndex : el.value; });
    return c;
  }
  function marcar(el) { var b = el.closest(".field, .vital, .checks label") || el; b.classList.add("desde-dictado"); }
  function agregar(id, texto) { var el = $(id); if (!texto || !el) return false; el.value = el.value.trim() ? el.value.trim() + " " + texto : texto; F.fire(el); marcar(el); return true; }
  function llenar(r) {
    var hecho = [];
    function anota(k, detalle) { hecho.push({ k: k, d: detalle }); }
    Object.keys(CAMPOS).forEach(function (k) { if (agregar(CAMPOS[k], r[k])) anota(k, r[k]); });
    var hab = [];
    if (r.tab != null) { $("f_tab").selectedIndex = r.tab; F.fire($("f_tab")); marcar($("f_tab")); hab.push($("f_tab").value); }
    if (r.alc != null) { $("f_alc").selectedIndex = r.alc; F.fire($("f_alc")); marcar($("f_alc")); hab.push("Alcohol: " + $("f_alc").value.toLowerCase()); }
    if (hab.length) anota("hab", hab.join(" · "));
    var vit = [];
    var ET = { pas: "PA", fc: "FC", fr: "FR", temp: "T°", sat: "SatO₂", peso: "Peso", talla: "Talla" };
    Object.keys(VIT).forEach(function (k) { var v = (r.vit || {})[k]; if (v == null || v === "") return; var el = $(VIT[k]); el.value = String(v).replace(".", ","); F.fire(el); marcar(el); if (k === "pad") vit[vit.length - 1] += "/" + el.value; else vit.push(ET[k] + " " + el.value); });
    if (vit.length) anota("vit", vit.join(" · "));
    if (r.dx) { var t = F.getTxt().trim(); F.setTxt(t ? t + " " + r.dx : r.dx); F.go(1); marcar($("txt")); anota("dx", r.dx); }
    var cas = [];
    if (r.der) { $("f_der").selectedIndex = r.der; F.fire($("f_der")); marcar($("f_der")); cas.push("Derivación: " + $("f_der").value); }
    if (r.ctrl) { $("f_ctrl").selectedIndex = r.ctrl; F.fire($("f_ctrl")); marcar($("f_ctrl")); cas.push("Control: " + $("f_ctrl").value.toLowerCase()); }
    if (r.rep) { $("f_rep").checked = true; F.fire($("f_rep")); marcar($("f_rep")); cas.push("Reposo"); }
    if (r.lic) { $("f_lic").checked = true; F.fire($("f_lic")); marcar($("f_lic")); cas.push("Licencia médica"); }
    if (r.dias) { $("f_dias").value = String(r.dias); F.fire($("f_dias")); marcar($("f_dias")); cas.push(r.dias + " días"); }
    if (cas.length) anota("casillas", cas.join(" · "));
    if (r.rx && r.rx.length) {
      var lista = F.rx().filter(function (x) { return (x.med || "").trim(); }).concat(r.rx.map(function (x) { return { med: x.med || "", dosis: x.dosis || "", frec: x.frec || "", dur: x.dur || "" }; }));
      F.setRx(lista); document.querySelectorAll("#rxBody tr").forEach(function (tr, i) { if (i >= lista.length - r.rx.length) tr.classList.add("desde-dictado"); });
      anota("rx", r.rx.map(function (x) { return [x.med, x.dosis, x.frec, x.dur].filter(Boolean).join(" · "); }).join(" | "));
    }
    F.vitals(); F.refreshStatus();
    var ORDEN = ["motivo", "ea", "ant", "med", "hab", "vit", "ef", "dx", "ind", "exa", "casillas", "rx"];
    return hecho.sort(function (a, b) { return ORDEN.indexOf(a.k) - ORDEN.indexOf(b.k); });
  }
  function resumen(hecho, via) {
    var E = F.esc;
    if (!hecho.length) { $("dictRes").innerHTML = '<p class="dict-vacio">No se reconoció nada para repartir. Nombre las secciones al dictar («motivo de consulta…», «al examen…», «diagnóstico…»).</p>'; return; }
    $("dictRes").innerHTML = '<div class="dict-ok"><span><b>Se llenaron ' + hecho.length + " partes de la ficha</b> (" + E(via) + "). Revise cada una: quedan marcadas «Desde el dictado» hasta que las edite.</span>" +
      '<span class="r"><button class="btn" type="button" id="dictDeshacer">Deshacer el reparto</button></span></div><ul class="dict-lista">' +
      hecho.map(function (h) { return '<li><span class="quien ' + (SECCION[h.k] === "paciente" ? "q-pac" : "q-med") + '">' + E(NOMBRES[h.k]) + "</span> <span>" + E(h.d.length > 160 ? h.d.slice(0, 157) + "…" : h.d) + '</span> <button class="btn mini" type="button" data-ir="' + SECCION[h.k] + '">Revisar</button></li>'; }).join("") +
      "</ul>" + (hecho.some(function (h) { return h.k === "dx"; }) ? '<p class="from">El diagnóstico quedó en el paso 1 de «Diagnóstico». Pulse «Analizar» ahí para validarlo y firmarlo: nada se firma solo.</p>' : "");
  }
  $("dictRepartir").addEventListener("click", function () {
    detener(); var texto = $("dictTxt").value.trim();
    if (!texto) { estado("Primero dicte o escriba la atención.", true); return; }
    var boton = $("dictRepartir"); boton.disabled = true;
    copia = tomarCopia();
    var reglas = function () { return VitalisReparto.repartir(F.fixVoz(texto), { vademecum: F.meds() }); };
    var listo = function (r, via) { resumen(llenar(r), via); boton.disabled = false; estado("Listo. Revise lo que quedó en cada sección."); };
    if (ia.lista && $("dictUsarIA").checked) {
      estado("Repartiendo con IA…");
      conIA(texto).then(function (r) { listo(r, "con IA"); })
        .catch(function (e) { listo(reglas(), "con reglas: la IA no respondió (" + e.message + ")"); });
    } else listo(reglas(), "con reglas");
  });
  $("dictRes").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.id === "dictDeshacer" && copia) {
      Object.keys(copia.campos).forEach(function (id) { var el = $(id); if (!el) return; if (el.type === "checkbox") el.checked = copia.campos[id]; else if (el.tagName === "SELECT") el.selectedIndex = copia.campos[id]; else el.value = copia.campos[id]; F.fire(el); });
      F.setRx(copia.rx); F.setTxt(copia.txt); F.vitals(); F.refreshStatus();
      document.querySelectorAll(".desde-dictado").forEach(function (x) { x.classList.remove("desde-dictado"); });
      copia = null; $("dictRes").innerHTML = '<p class="dict-vacio">Se deshizo el reparto. El texto dictado sigue arriba.</p>';
    }
    if (b.getAttribute("data-ir")) { F.showSec(b.getAttribute("data-ir")); var m = document.querySelector("#sec-" + b.getAttribute("data-ir") + " .desde-dictado"); if (m) m.scrollIntoView({ block: "center" }); }
  });
  // Al editar un campo llenado desde el dictado, deja de estar marcado
  document.addEventListener("input", function (e) { var b = e.target.closest && e.target.closest(".desde-dictado"); if (b && e.isTrusted) b.classList.remove("desde-dictado"); }, true);
})();
