/* Vitalis Help · inicio de sesión de médicos
   PROTOTIPO: los usuarios y contraseñas están aquí solo para la demostración.
   En la clínica, el ingreso se haría con la cuenta institucional (SSO) y los
   médicos habilitados vendrían del directorio de usuarios o de MasterKey. */

var VitalisAuth = (function () {
  "use strict";

  // Dominio del correo institucional (cambiar por el dominio real de la clínica)
  var DOMINIO = "clinica-demo.cl";

  // Página a la que entra el médico después de ingresar
  var INICIO = "pacientes.html";

  // Médicos habilitados (cuentas de demostración)
  var USUARIOS = [
    { correo: "camila.rojas@clinica-demo.cl", clave: "Demo2026", nombre: "Dra. Camila Rojas", detalle: "Medicina interna · Box 4" },
    { correo: "andres.soto@clinica-demo.cl", clave: "Demo2026", nombre: "Dr. Andrés Soto", detalle: "Medicina general · Box 2" }
  ];
  var CLAVE_SESION = "vitalis_sesion";

  // El navegador puede bloquear el almacenamiento: siempre con try/catch.
  // Como respaldo, todo se copia también en window.name, que se mantiene
  // al cambiar de página dentro de la misma pestaña.
  function respaldo() {
    if (/^vitalis:/.test(window.name)) { try { return JSON.parse(window.name.slice(8)) || {}; } catch (e) {} }
    return {};
  }
  function guardarRespaldo(clave, valor) {
    var r = respaldo(); r[clave] = valor;
    try { window.name = "vitalis:" + JSON.stringify(r); } catch (e) {}
  }
  function leerSesion() { try { return JSON.parse(sessionStorage.getItem(CLAVE_SESION)); } catch (e) { return null; } }
  function guardarSesion(s) { try { sessionStorage.setItem(CLAVE_SESION, JSON.stringify(s)); } catch (e) {} guardarRespaldo("sesion", s); }

  // Datos que deben durar más que la sesión (pacientes nuevos, estado de las atenciones)
  function leerDato(clave) {
    try { var v = JSON.parse(localStorage.getItem("vitalis_" + clave)); if (v !== null) return v; } catch (e) {}
    return respaldo()[clave] || null;
  }
  function guardarDato(clave, valor) {
    try { localStorage.setItem("vitalis_" + clave, JSON.stringify(valor)); } catch (e) {}
    guardarRespaldo(clave, valor);
  }

  function buscar(correo) {
    correo = (correo || "").trim().toLowerCase();
    for (var i = 0; i < USUARIOS.length; i++) if (USUARIOS[i].correo === correo) return USUARIOS[i];
    return null;
  }

  // Revisa el correo y la contraseña. Devuelve {ok:true, usuario} o {ok:false, error}
  function ingresar(correo, clave) {
    correo = (correo || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return { ok: false, error: "Ingrese un correo válido." };
    if (correo.split("@")[1] !== DOMINIO) return { ok: false, error: "Use su correo institucional terminado en @" + DOMINIO + "." };
    var u = buscar(correo);
    if (!u || u.clave !== clave) return { ok: false, error: "Correo o contraseña incorrectos." };
    var sesion = { correo: u.correo, nombre: u.nombre, detalle: u.detalle, desde: new Date().toISOString() };
    guardarSesion(sesion);
    return { ok: true, usuario: sesion };
  }

  function sesion() { return leerSesion() || respaldo().sesion || null; }
  function salir() { try { sessionStorage.removeItem(CLAVE_SESION); } catch (e) {} guardarRespaldo("sesion", null); location.replace("index.html"); }

  // Control de acceso: una página con <html data-privada> exige sesión iniciada
  if (document.documentElement.hasAttribute("data-privada") && !sesion()) location.replace("index.html");

  // Al cargar la página: nombre del médico y botón de salir
  document.addEventListener("DOMContentLoaded", function () {
    var s = sesion(); if (!s) return;
    document.querySelectorAll("[data-usuario]").forEach(function (el) { el.textContent = s.nombre + " · " + s.detalle; });
    document.querySelectorAll("[data-salir]").forEach(function (b) { b.addEventListener("click", salir); });
  });

  return {
    DOMINIO: DOMINIO, INICIO: INICIO, USUARIOS: USUARIOS,
    ingresar: ingresar, sesion: sesion, salir: salir, buscar: buscar,
    leerDato: leerDato, guardarDato: guardarDato,
    firma: function () { var s = sesion(); return s ? s.nombre : "Usuario de prueba"; }
  };
})();
