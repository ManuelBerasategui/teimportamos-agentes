@echo off
cd /d "%~dp0"
if not exist ".env" (
  if not exist ".env.example" (
    echo No encuentro .env.example en esta carpeta.
    pause
    exit /b 1
  )
  copy ".env.example" ".env" >nul
  echo Se creo sender\.env desde la plantilla.
  echo En Notepad, busca LECTOR_TOKEN y reemplaza el texto de ejemplo por el token del lector en Cloudflare.
  echo Guarda el archivo, cierra Notepad y este programa empezara a leer una vez por dia.
  start /wait "" notepad.exe "%~dp0.env"
)
python tendencias_ml.py --cada 1440
pause
