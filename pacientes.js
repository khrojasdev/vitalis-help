/* Vitalis Help · lista de pacientes del médico */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }

  var medico = (VitalisAuth.sesion() || {}).correo;
  var CLASE = { "Por atender": "e-agenda", "En atención": "e-atencion", "Atendido": "e-ok" };
  var abierto = null; // ficha cuyo resumen está desplegado

  var hoy = new Date().toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  $("hoy").textContent = hoy.charAt(0).toUpperCase() + hoy.slice(1);

  function atender(ficha) { location.href = "ficha.html?paciente=" + encodeURIComponent(ficha); }

  // Lista de pacientes
  function render() {
    var q = norm($("buscar").value.trim()), todos = VitalisDatos.agenda(medico);
    var lista = todos.filter(function (p) {
      return !q || norm(p.nombre).indexOf(q) >= 0 || p.ficha.indexOf(q) >= 0 || norm(p.rut).replace(/\./g, "").indexOf(q.replace(/\./g, "")) >= 0;
    });
    var atendidos = todos.filter(function (p) { return VitalisDatos.atencion(p.ficha).estado === "Atendido"; }).length;
    $("cuenta").textContent = todos.length + (todos.length === 1 ? " paciente · " : " pacientes · ") + atendidos + (atendidos === 1 ? " atendido" : " atendidos");

    $("lista").innerHTML = lista.map(function (p) {
      var a = VitalisDatos.atencion(p.ficha), est = a.estado;
      var boton = est === "Atendido"
        ? '<button class="btn" type="button" data-resumen="' + p.ficha + '" aria-expanded="' + (abierto === p.ficha) + '">' + (abierto === p.ficha ? "Ocultar resumen" : "Ver resumen") + "</button>"
        : '<button class="btn primary" type="button" data-atender="' + p.ficha + '">' + (est === "En atención" ? "Continuar" : "Atender") + "</button>";
      var alergia = p.alergias !== "Sin alergias conocidas" ? '<span class="alerg">Alergia: ' + esc(p.alergias) + "</span>" : "";
      var h = '<article class="pac-item">' +
        '<div class="pac-hora">' + (p.hora ? esc(p.hora) : '<span class="tag-nuevo">Nuevo</span>') + "</div>" +
        '<div class="pac-datos"><b>' + esc(p.nombre) + "</b>" +
        '<div class="sub">' + p.edad + " años · " + esc(p.sexo) + " · " + esc(p.prevision) + " · Ficha N° " + esc(p.ficha) + "</div>" +
        '<div class="sub">' + esc(p.cita) + " " + alergia + "</div></div>" +
        '<div class="pac-estado"><span class="estado ' + CLASE[est] + '">' + est + (a.hora ? " · " + esc(a.hora) : "") + "</span></div>" +
        '<div class="pac-accion">' + boton + "</div></article>";
      if (abierto === p.ficha && a.resumen) h += '<div class="pac-resumen">' + a.resumen + "</div>";
      return h;
    }).join("") || '<p class="pac-vacio">No hay pacientes que coincidan con la búsqueda.</p>';
  }

  $("lista").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.atender) atender(b.dataset.atender);
    if (b.dataset.resumen) { abierto = abierto === b.dataset.resumen ? null : b.dataset.resumen; render(); }
  });
  $("buscar").addEventListener("input", render);

  // Formulario de paciente nuevo
  function mostrarForm(ver) {
    $("formNuevo").hidden = !ver;
    $("btnNuevo").setAttribute("aria-expanded", String(ver));
    if (ver) { $("nErr").textContent = ""; $("nNombres").focus(); }
  }
  $("btnNuevo").addEventListener("click", function () { mostrarForm($("formNuevo").hidden); });
  $("nCancelar").addEventListener("click", function () { $("formNuevo").reset(); mostrarForm(false); });
  $("nRut").addEventListener("blur", function () { var r = VitalisDatos.rutValido(this.value); if (r) this.value = r; });
  $("formNuevo").addEventListener("submit", function (e) {
    e.preventDefault();
    var r = VitalisDatos.crear({
      nombres: $("nNombres").value, paterno: $("nPaterno").value, materno: $("nMaterno").value, rut: $("nRut").value,
      nacimiento: $("nNac").value, sexo: $("nSexo").value, prevision: $("nPrev").value, alergias: $("nAlerg").value, cita: $("nCita").value
    }, medico);
    if (!r.ok) { $("nErr").textContent = r.error; $(r.campo).focus(); return; }
    atender(r.paciente.ficha);
  });

  $("reiniciar").addEventListener("click", function () { VitalisDatos.reiniciar(); abierto = null; render(); });
  window.addEventListener("storage", render);
  render();
})();
