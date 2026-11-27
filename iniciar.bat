@echo off
rem Vitalis Help: inicia el servidor local (CIE-11) y abre la app en el navegador.
rem Deje esta ventana abierta mientras usa la app. Para detenerlo, cierre la ventana.
cd /d "%~dp0"
set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not exist "%PY%" set "PY=python"
if not exist ".env" (
  echo.
  echo  AVISO: no se encontro la clave de la OMS ^(archivo .env en esta carpeta^).
  echo  Los codigos CIE-11 apareceran como "falta configurar la clave".
  echo.
)
rem Si faltan los paquetes de Python, se instalan una sola vez
"%PY%" -c "import fastapi,uvicorn,requests,dotenv" 2>nul || (echo  Instalando paquetes de Python, espere... & "%PY%" -m pip install -r requirements.txt)
rem Abre el navegador recien cuando el servidor responde (en algunos equipos tarda en partir)
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 120;$i++){try{Invoke-WebRequest -UseBasicParsing http://localhost:8000/api/cie11/estado -TimeoutSec 1 | Out-Null; Start-Process 'http://localhost:8000'; break}catch{Start-Sleep -Milliseconds 500}}"
"%PY%" -m uvicorn servidor:app --port 8000
pause
