/* Vitalis Help · configuración de la página
   cie11Api: dirección del servidor que entrega los códigos CIE-11 (servidor.py).
   · En el computador con iniciar.bat se deja vacío: la app usa http://localhost:8000 sola.
   · Si publica servidor.py en internet (por ejemplo en Render o Railway, con ICD_CLIENT_ID e
     ICD_CLIENT_SECRET como variables de entorno), escriba aquí su dirección terminada en /api/cie11,
     por ejemplo "https://vitalis-help-api.onrender.com/api/cie11".
   iaApi: igual que cie11Api, pero para repartir el dictado completo con IA (servidor.py, termina en /api/ia).
   Nunca escriba aquí claves (OMS o IA): este archivo lo puede ver cualquiera. */
window.VITALIS_CONFIG = {
  cie11Api: "",
  iaApi: ""
};
