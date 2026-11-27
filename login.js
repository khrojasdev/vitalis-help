/* Vitalis Help · pantalla de ingreso de médicos */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }

  // Si ya hay una sesión abierta, ir directo a la vista del perfil
  if (VitalisAuth.sesion()) { location.replace(VitalisAuth.INICIO); return; }

  // Al escribir el correo, mostrar a qué médico corresponde
  function mostrarPerfil() {
    var u = VitalisAuth.buscar($("correo").value);
    $("perfil").innerHTML = u ? '<span class="chip-perfil">Médico</span> ' + u.nombre : "";
  }
  $("correo").addEventListener("input", function () { mostrarPerfil(); $("loginErr").textContent = ""; });
  $("clave").addEventListener("input", function () { $("loginErr").textContent = ""; });

  // Mostrar u ocultar la contraseña
  $("verClave").addEventListener("click", function () {
    var ver = $("clave").type === "password";
    $("clave").type = ver ? "text" : "password";
    this.textContent = ver ? "Ocultar" : "Mostrar";
    this.setAttribute("aria-pressed", String(ver));
  });

  // Ingresar
  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!$("clave").value) { $("loginErr").textContent = "Ingrese su contraseña."; $("clave").focus(); return; }
    var r = VitalisAuth.ingresar($("correo").value, $("clave").value);
    if (!r.ok) { $("loginErr").textContent = r.error; return; }
    $("loginErr").textContent = "";
    location.href = VitalisAuth.INICIO;
  });

  // Botones de las cuentas de demostración
  $("cuentas").innerHTML = VitalisAuth.USUARIOS.map(function (u, i) {
    return '<button type="button" class="cuenta" data-i="' + i + '"><span class="chip-perfil">Médico</span><b>' +
      u.nombre + "</b><span>" + u.correo + "</span></button>";
  }).join("");
  $("cuentas").addEventListener("click", function (e) {
    var b = e.target.closest(".cuenta"); if (!b) return;
    var u = VitalisAuth.USUARIOS[+b.getAttribute("data-i")];
    $("correo").value = u.correo; $("clave").value = u.clave; $("loginErr").textContent = "";
    mostrarPerfil(); $("clave").focus();
  });
})();
