# Vitalis Help · prototipo

Prototipo académico de ficha clínica ambulatoria para médicos, con dictado por voz y diagnóstico estructurado y estandarizado (SNOMED CT y CIE-11). Usa solo pacientes y datos ficticios.

## Cómo abrirlo
**En línea (celular u otro computador):** https://khrojasdev.github.io/vitalis-help/ — use Chrome o Edge y permita el micrófono. En la versión en línea todo funciona salvo los códigos CIE-11, que necesitan el servidor con la clave de la OMS (ver más abajo).

**En el computador, con CIE-11:** doble clic en `iniciar.bat` (instala los paquetes de Python la primera vez y abre http://localhost:8000).

**En el computador, sin CIE-11:** abra la carpeta en Visual Studio Code, instale **Live Server** y haga clic derecho en `index.html` → **Open with Live Server**.

## La ficha: esquema SOAP
La atención se registra en **cuatro vistas**, separando lo que **cuenta el paciente** (color ámbar) de lo que **registra el médico** (color azul):

| Vista | Quién aporta la información | Contenido |
|---|---|---|
| **S · Relato del paciente** | El paciente | Motivo de consulta (en sus palabras), enfermedad actual, antecedentes que refiere, medicamentos habituales y hábitos |
| **O · Examen físico** | El médico | Signos vitales (con alertas e IMC) y examen físico |
| **A · Diagnóstico** | El médico | Asistente en 3 pasos: **Dictar o escribir** (el dictado se escribe en un cuadro que se puede corregir directamente) → **Validar diagnósticos** → **Firmar** |
| **P · Plan y cierre** | El médico | Indicaciones, recetas y el resumen de toda la atención con el botón **Firmar y cerrar atención** |

Al analizar el diagnóstico también se revisan el relato del paciente y el examen físico. Lo que viene del relato del paciente aparece con la etiqueta **«Lo relató el paciente»**: es información que el médico decide si convierte en diagnóstico. Lo negado («se descarta ACV», «niega fiebre») aparece **tachado** en el texto y en la lista **«No se registrarán»**.

El botón **Micrófono** (barra superior) permite elegir el micrófono de solapa o cintillo y probarlo durante 5 segundos: indica si la voz se capta bien, baja o saturada, y avisa si parece el micrófono del computador. El reconocimiento de voz del navegador usa el micrófono predeterminado; la elección queda guardada para cuando Whisper reemplace al navegador.

## Archivos
| Archivo | Qué contiene |
|---|---|
| `index.html` + `login.js` | Ingreso de médicos con correo institucional |
| `auth.js` | Médicos habilitados, sesión, control de acceso y almacenamiento |
| `pacientes.html` + `pacientes.js` | Mis pacientes de hoy: elegir a quién atender y registrar pacientes nuevos |
| `datos.js` | Agenda de cada médico, pacientes nuevos y estado de cada atención |
| `ficha.html` + `app.js` | Ficha clínica SOAP: dictado, diagnóstico estructurado y grabación con botón (botón «Grabar» o botón del micrófono, tecla L) con comandos de voz |
| `microfono.js` | Panel «Micrófono»: elegir el micrófono y probar su nivel durante 5 segundos |
| `config.js` | Dirección del servidor CIE-11 cuando la app está publicada en internet |
| `snomed.js` | Catálogo de 343 conceptos SNOMED CT con sus frases en español |
| `sinonimos.js` | Otras formas de decir cada enfermedad o síntoma (siglas, nombres coloquiales), para estandarizarlas en un solo concepto |
| `styles.css` | Todos los estilos |

## Cuentas de demostración (contraseña `Demo2026`)
- `camila.rojas@clinica-demo.cl` → Dra. Camila Rojas
- `andres.soto@clinica-demo.cl` → Dr. Andrés Soto

Para cambiar el dominio institucional, edite `DOMINIO` al inicio de `auth.js`.
Al ingresar, el médico ve **Mis pacientes de hoy**: elige a quién atender (**Atender**) o registra un **Paciente nuevo** (con RUT validado). La ficha se abre con los datos de ese paciente. Al cerrar la atención, el paciente queda como **Atendido** y su resumen se puede ver desde la lista. **Reiniciar demostración**, al pie de la lista, borra los pacientes nuevos y los estados.

Si alguien abre `ficha.html` o `pacientes.html` sin haber ingresado, vuelve a la pantalla de ingreso.

**Importante:** las contraseñas en `auth.js` son solo para la demostración. En la clínica el ingreso se haría con la cuenta institucional (SSO) y los médicos habilitados vendrían del directorio de usuarios o de MasterKey, validados en el servidor.

## Conexión con la API CIE-11 de la OMS
Cada **enfermedad** muestra su código **SNOMED CT** y su código **CIE-11**. Los **síntomas y hallazgos** (cefalea, mareo, tos…) se registran solo con SNOMED CT. La app ya no usa CIE-10. El código lo sugiere la OMS y queda **«por revisar»** hasta que el médico lo **confirma** o elige otro con **Cambiar** (paso 3 del diagnóstico, «Firmar»).

La clave de la OMS **nunca va en `app.js`**: la guarda `servidor.py`, que es el único que habla con la OMS. A la OMS solo se envía el nombre del diagnóstico, nunca datos del paciente.

1. Instale Python 3.10 o superior.
2. En la terminal de VS Code (dentro de esta carpeta):
   `pip install -r requirements.txt`
3. Copie `.env.ejemplo` con el nombre `.env` y pegue ahí su `ICD_CLIENT_ID` e `ICD_CLIENT_SECRET`. No comparta ni suba este archivo (ya está en `.gitignore`).
   El `.env` va en esta misma carpeta, junto a `servidor.py`. El .zip de la app nunca incluye el `.env`: si extrae un .zip nuevo, copie su `.env` a la carpeta nueva.
4. Inicie el servidor con doble clic en **`iniciar.bat`** (abre la app sola en http://localhost:8000; deje la ventana negra abierta mientras la usa).
   También puede iniciarlo desde la terminal: `python -m uvicorn servidor:app --reload`
5. Si no se abrió sola, abra **http://localhost:8000** en Chrome o Edge.

Si abre la app con Live Server sin iniciar `servidor.py`, todo funciona igual, pero el código CIE-11 aparece como «sin conexión».

### CIE-11 en la versión en línea
GitHub Pages solo publica archivos: no puede ejecutar `servidor.py` ni guardar la clave de la OMS, por eso ahí el código CIE-11 aparece como «no disponible en la versión online». Para tenerlo en línea, publique `servidor.py` en un servicio que ejecute Python (por ejemplo Render o Railway) con las variables `ICD_CLIENT_ID`, `ICD_CLIENT_SECRET` y `CORS_ORIGINS=https://khrojasdev.github.io`, y escriba su dirección en `config.js` (`cie11Api: "https://…/api/cie11"`). Nunca escriba la clave en `config.js`.

| Archivo | Qué contiene |
|---|---|
| `iniciar.bat` | Doble clic: inicia `servidor.py` y abre la app |
| `servidor.py` | Servidor local: guarda la clave, pide el token a la OMS y entrega los códigos CIE-11 |
| `.env.ejemplo` | Plantilla para su cliente y clave (cópiela como `.env`) |
| `requirements.txt` | Paquetes de Python necesarios |

## Catálogo SNOMED CT (`snomed.js`)
El prototipo reconoce **343 conceptos SNOMED CT** (hallazgos clínicos y trastornos frecuentes en la atención ambulatoria), con **624 frases en español** y **37 siglas** (por ejemplo HTA, DM2, FA, TEP, ERC, EPOC, SAHOS, NAC, TEC).
Cada fila de `snomed.js` tiene: SCTID, término en español, nombre en inglés (FSN) y frases en español sin tildes. Si el FSN termina en `(disorder)` el concepto es una **enfermedad** (SNOMED CT + CIE-11); si termina en `(finding)` es un **síntoma o hallazgo** (solo SNOMED CT). Algunos signos que SNOMED CT clasifica como `(disorder)` (vómitos, disfagia, síncope, melena, exantema, adenopatías, retención urinaria) se tratan como síntomas: la lista está en `SINTOMA_IDS`, al inicio de `app.js`.

### Estandarización
Cada enfermedad es **un solo concepto**, sin importar cómo se diga. «DM2», «DM tipo 2», «diabetes mellitus 2», «diabetes tipo II», «diabetes mellitus tipo dos», «diabético tipo 2» y «diabetes no insulinodependiente» quedan todas como **Diabetes mellitus tipo 2 · SNOMED CT 44054006**. Lo mismo con «HTA», «hipertensa», «presión alta» → Hipertensión arterial, o «ERC estadio III» → Enfermedad renal crónica etapa 3. Si se dicen varias formas en la misma atención, aparece una sola vez.

Esto funciona en dos capas:
1. **Normalización automática** (`app.js`): iguala números y romanos («tipo 2» = «tipo II» = «tipo dos»; «etapa 3» = «estadio III»), ignora palabras de relleno («de», «la», «tipo», «mellitus»…), plurales («cálculos renales» = «cálculo renal») y expande siglas que forman frases (DM, DM1, DM2, DBT, HTA, ERC, IRC, EPOC).
2. **Sinónimos** (`sinonimos.js`): términos que no se parecen entre sí («ataque al corazón» = infarto agudo de miocardio, «pulmonía» = neumonía, «almorranas» = hemorroides). Para agregar uno, súmelo a la lista del código SNOMED CT correspondiente, en minúsculas y sin tildes.

Al pulsar **Analizar** en el diagnóstico se revisa el dictado del diagnóstico y también el **motivo de consulta, la enfermedad actual, los antecedentes y el examen físico**. Cada sugerencia indica de qué sección viene; si un diagnóstico aparece en varias, se muestra una vez. Los antecedentes quedan como diagnóstico «Secundario». Lo negado («niega fiebre, vómitos y diarrea», «sin edema») no se sugiere.

Además de las frases exactas, `app.js` reconoce hallazgos del examen dictados con otras palabras: une «dolor», «molestias» o «sensibilidad» con la zona del cuerpo más cercana (por ejemplo «molestias a la palpación en región lumbar» → Lumbago, «abdomen sensible en epigastrio» → Dolor de estómago) y sugiere «mucosas secas» → Deshidratación. Estas sugerencias aparecen como «Deducido del examen · Revisar» y solo se registran si el médico las acepta. También corrige errores frecuentes del dictado por voz («como cosas secas» → «mucosas secas», «ruedos cardíacos» → «ruidos cardíacos», «toraximétrico» → «tórax simétrico»).

Para agregar un concepto, copie una fila y cambie sus datos. Las frases van en minúsculas y sin tildes (por ejemplo `"insuficiencia cardiaca"`).

Todos los SCTID pasan el dígito verificador oficial de SNOMED CT. Antes del piloto, cuando Snowstorm esté instalado, verifique el catálogo completo:

`python verificar_snomed.py http://localhost:8080/fhir`

El script revisa que cada concepto exista, esté activo y que su nombre coincida. El resultado queda en `verificacion_snomed.csv`.
