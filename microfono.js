/* Vitalis Help · panel «Micrófono»
   Permite elegir el micrófono de solapa o cintillo y probarlo durante 5 segundos antes de la atención:
   indica si la voz se capta bien, baja o saturada, y avisa si parece el micrófono del computador.
   Nota: el reconocimiento de voz del navegador (Web Speech API) usa el micrófono predeterminado;
   la elección queda guardada para la versión final, en que Whisper grabará desde ese micrófono. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  var btn = $("micCfgBtn"), pan = $("micPanel"), sel = $("micSel"), res = $("micRes"), bar = $("micBar"), test = $("micTest");
  if (!btn || !pan) return;
  var CLAVE = "vitalis_microfono", probando = false;
  // Nombres típicos de micrófonos integrados al computador o a la cámara
  var INTEGRADO = /(integrad|interno|internal|built-?in|array|realtek|laptop|port[aá]til|webcam|c[aá]mara|camera|conexant|intel.*smart sound)/i;

  function leer() { try { return localStorage.getItem(CLAVE) || ""; } catch (e) { return ""; } }
  function guardar(v) { try { localStorage.setItem(CLAVE, v); } catch (e) {} }
  function msg(html, tipo) { res.innerHTML = html; res.className = "mp-res" + (tipo ? " " + tipo : ""); }

  function listar() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      msg("Este navegador no permite elegir el micrófono. Use Google Chrome o Microsoft Edge.", "warn"); return Promise.resolve();
    }
    return navigator.mediaDevices.enumerateDevices().then(function (ds) {
      var mics = ds.filter(function (d) { return d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications"; });
      var elegido = leer();
      sel.innerHTML = '<option value="">Predeterminado del navegador</option>' + mics.map(function (d, i) {
        var n = d.label || ("Micrófono " + (i + 1) + " (pruébelo para ver su nombre)");
        return '<option value="' + d.deviceId.replace(/"/g, "&quot;") + '"' + (d.deviceId === elegido ? " selected" : "") + ">" + n.replace(/[<>&]/g, "") + "</option>";
      }).join("");
    });
  }

  function abrir(ver) {
    pan.hidden = !ver; btn.setAttribute("aria-expanded", String(ver));
    if (ver) { listar(); test.focus(); }
  }
  btn.addEventListener("click", function () { abrir(pan.hidden); });
  $("micClose").addEventListener("click", function () { abrir(false); btn.focus(); });
  sel.addEventListener("change", function () { guardar(sel.value); msg(""); });

  test.addEventListener("click", function () {
    if (probando) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg("Este navegador no permite usar el micrófono aquí. Abra la app con https o desde localhost en Chrome o Edge.", "warn"); return; }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var restr = sel.value ? { deviceId: { exact: sel.value } } : true;
    probando = true; test.disabled = true; msg("Pidiendo permiso para usar el micrófono…");
    navigator.mediaDevices.getUserMedia({ audio: restr }).then(function (stream) {
      var pista = stream.getAudioTracks()[0], nombre = pista ? pista.label : "";
      var ctx = new Ctx(), fuente = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
      an.fftSize = 2048; fuente.connect(an);
      var datos = new Float32Array(an.fftSize), inicio = performance.now(), cuadros = 0, conVoz = 0, saturados = 0, suma = 0, maximo = 0;
      msg("Hable con normalidad durante 5 segundos… (" + (nombre || "micrófono predeterminado") + ")");
      (function medir() {
        an.getFloatTimeDomainData(datos);
        var cuad = 0, pico = 0;
        for (var i = 0; i < datos.length; i++) { var v = Math.abs(datos[i]); cuad += v * v; if (v > pico) pico = v; }
        var rms = Math.sqrt(cuad / datos.length);
        cuadros++; if (rms > 0.02) { conVoz++; suma += rms; } if (pico > 0.98) saturados++; if (rms > maximo) maximo = rms;
        bar.style.width = Math.min(100, Math.round(rms * 400)) + "%";
        if (performance.now() - inicio < 5000) { requestAnimationFrame(medir); return; }
        stream.getTracks().forEach(function (t) { t.stop(); }); ctx.close();
        bar.style.width = "0"; probando = false; test.disabled = false;
        var prom = conVoz ? suma / conVoz : 0, tipo, texto;
        if (saturados / cuadros > 0.02) { tipo = "warn"; texto = "<b>Voz saturada.</b> Aleje un poco el micrófono o baje su volumen."; }
        else if (conVoz / cuadros < 0.15 || prom < 0.04) { tipo = "warn"; texto = "<b>Voz baja.</b> Acerque el micrófono a la boca o suba su volumen."; }
        else { tipo = "ok"; texto = "<b>La voz se capta bien.</b>"; }
        if (INTEGRADO.test(nombre)) texto += "<br>Parece el micrófono del computador: capta ruido y la voz del paciente. Se recomienda el de solapa o cintillo.";
        msg(texto + '<br><span class="from">Probado: ' + (nombre || "micrófono predeterminado").replace(/[<>&]/g, "") + "</span>", tipo);
        if (pista && pista.getSettings && pista.getSettings().deviceId && !sel.value) guardar("");
        listar(); // tras dar permiso, el navegador muestra los nombres de los micrófonos
      })();
    }).catch(function (e) {
      probando = false; test.disabled = false;
      var m = { NotAllowedError: "No hay permiso para usar el micrófono. Permítalo en el ícono del candado de la barra de direcciones.", NotFoundError: "No se encontró ese micrófono. Revise que esté conectado.", OverconstrainedError: "Ese micrófono ya no está disponible. Elija otro." }[e.name];
      msg(m || ("No se pudo usar el micrófono: " + e.message), "warn");
    });
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !pan.hidden) { abrir(false); btn.focus(); } });
})();
