/* Vitalis Help · pacientes y estado de las atenciones
   PROTOTIPO: la agenda y los pacientes son ficticios y se guardan en el navegador.
   En la clínica, la agenda y los datos del paciente vendrían de MasterKey. */

var VitalisDatos = (function () {
  "use strict";

  // Agenda de hoy de cada médico (pacientes ficticios)
  var AGENDA = [
    { ficha: "000123", medico: "camila.rojas@clinica-demo.cl", hora: "09:00", nombre: "María Fernández Soto", edad: 58, sexo: "Femenino", prevision: "FONASA", alergias: "Sin alergias conocidas", cita: "Control de crónicos" },
    { ficha: "000187", medico: "camila.rojas@clinica-demo.cl", hora: "09:20", nombre: "Jorge Muñoz Paredes", edad: 41, sexo: "Masculino", prevision: "ISAPRE", alergias: "Penicilina", cita: "Consulta por morbilidad" },
    { ficha: "000231", medico: "camila.rojas@clinica-demo.cl", hora: "09:40", nombre: "Tomás Herrera Lagos", edad: 29, sexo: "Masculino", prevision: "FONASA", alergias: "Sin alergias conocidas", cita: "Primera consulta" },
    { ficha: "000278", medico: "camila.rojas@clinica-demo.cl", hora: "10:20", nombre: "Luis Bravo Castillo", edad: 50, sexo: "Masculino", prevision: "FONASA", alergias: "Ácido acetilsalicílico", cita: "Control de exámenes" },
    { ficha: "000204", medico: "andres.soto@clinica-demo.cl", hora: "09:30", nombre: "Rosa Contreras Díaz", edad: 72, sexo: "Femenino", prevision: "FONASA", alergias: "Sin alergias conocidas", cita: "Control de crónicos" },
    { ficha: "000256", medico: "andres.soto@clinica-demo.cl", hora: "10:00", nombre: "Ana Pizarro Reyes", edad: 63, sexo: "Femenino", prevision: "ISAPRE", alergias: "Sulfas", cita: "Consulta por morbilidad" }
  ];

  function nuevos() { return VitalisAuth.leerDato("nuevos") || []; }
  function estados() { return VitalisAuth.leerDato("estados") || {}; }

  // Pacientes de un médico: los agendados por hora y, al final, los nuevos que registró
  function agenda(correo) {
    var propios = AGENDA.filter(function (p) { return p.medico === correo; });
    propios.sort(function (a, b) { return a.hora < b.hora ? -1 : 1; });
    return propios.concat(nuevos().filter(function (p) { return p.medico === correo; }));
  }

  function paciente(ficha) {
    var todos = AGENDA.concat(nuevos());
    for (var i = 0; i < todos.length; i++) if (todos[i].ficha === ficha) return todos[i];
    return null;
  }

  // Estado de la atención: "Por atender", "En atención" o "Atendido"
  function atencion(ficha) { return estados()[ficha] || { estado: "Por atender" }; }
  function iniciar(ficha) {
    var e = estados();
    if (!e[ficha] || e[ficha].estado !== "Atendido") { e[ficha] = { estado: "En atención" }; VitalisAuth.guardarDato("estados", e); }
  }
  function cerrar(ficha, resumen) {
    var e = estados(), now = new Date();
    e[ficha] = { estado: "Atendido", hora: ("0" + now.getHours()).slice(-2) + ":" + ("0" + now.getMinutes()).slice(-2), resumen: resumen };
    VitalisAuth.guardarDato("estados", e);
  }

  // Edad en años a partir de la fecha de nacimiento (AAAA-MM-DD)
  function edad(fecha) {
    var n = new Date(fecha + "T12:00:00"), hoy = new Date(), a = hoy.getFullYear() - n.getFullYear();
    if (hoy.getMonth() < n.getMonth() || (hoy.getMonth() === n.getMonth() && hoy.getDate() < n.getDate())) a--;
    return a;
  }

  // RUT chileno: revisa el dígito verificador (módulo 11) y lo deja como 12.345.678-5
  function rutValido(rut) {
    var r = String(rut || "").replace(/[.\s-]/g, "").toUpperCase();
    if (!/^\d{7,8}[\dK]$/.test(r)) return null;
    var cuerpo = r.slice(0, -1), dv = r.slice(-1), suma = 0, mult = 2;
    for (var i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo.charAt(i)) * mult; mult = mult === 7 ? 2 : mult + 1; }
    var esperado = 11 - (suma % 11), dvOk = esperado === 11 ? "0" : esperado === 10 ? "K" : String(esperado);
    if (dv !== dvOk) return null;
    return cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "-" + dv;
  }

  // Registra un paciente nuevo. Devuelve {ok:true, paciente} o {ok:false, error, campo}
  function crear(d, medico) {
    if (!d.nombres.trim()) return { ok: false, error: "Ingrese los nombres.", campo: "nNombres" };
    if (!d.paterno.trim()) return { ok: false, error: "Ingrese el apellido paterno.", campo: "nPaterno" };
    var rut = rutValido(d.rut);
    if (!rut) return { ok: false, error: "El RUT no es válido. Revise el número y el dígito verificador.", campo: "nRut" };
    if (nuevos().some(function (p) { return p.rut === rut; })) return { ok: false, error: "Ya existe un paciente registrado con ese RUT.", campo: "nRut" };
    if (!d.nacimiento) return { ok: false, error: "Ingrese la fecha de nacimiento.", campo: "nNac" };
    var e = edad(d.nacimiento);
    if (isNaN(e) || e < 0 || e > 120) return { ok: false, error: "Revise la fecha de nacimiento.", campo: "nNac" };
    if (!d.sexo) return { ok: false, error: "Seleccione el sexo.", campo: "nSexo" };
    if (!d.prevision) return { ok: false, error: "Seleccione la previsión.", campo: "nPrev" };
    var lista = nuevos();
    var p = {
      ficha: String(300 + lista.length + 1).padStart(6, "0"), medico: medico, hora: "", nuevo: true, rut: rut,
      nombre: [d.nombres, d.paterno, d.materno].map(function (s) { return s.trim(); }).filter(Boolean).join(" "),
      edad: e, sexo: d.sexo, prevision: d.prevision,
      alergias: d.alergias.trim() || "Sin alergias conocidas", cita: d.cita.trim() || "Paciente nuevo"
    };
    lista.push(p); VitalisAuth.guardarDato("nuevos", lista);
    return { ok: true, paciente: p };
  }

  function reiniciar() { VitalisAuth.guardarDato("nuevos", []); VitalisAuth.guardarDato("estados", {}); }

  return { agenda: agenda, paciente: paciente, atencion: atencion, iniciar: iniciar, cerrar: cerrar, crear: crear, rutValido: rutValido, reiniciar: reiniciar };
})();
