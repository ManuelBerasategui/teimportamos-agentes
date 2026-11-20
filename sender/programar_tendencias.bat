@echo off
cd /d "%~dp0"
echo Programa la lectura de tendencias todos los dias a las 07:30 (Google Trends + Mercado Libre).
echo La PC tiene que estar prendida y con tu usuario iniciado a esa hora.
schtasks /Create /SC DAILY /ST 07:30 /TN "TeImportamos Tendencias" /TR "cmd /c cd /d \"%~dp0\" && python tendencias_ml.py >> tendencias_log.txt 2>&1" /F
if errorlevel 1 (
  echo No se pudo programar. Proba abrir este archivo con clic derecho - Ejecutar como administrador.
) else (
  echo Listo. Para sacarlo: schtasks /Delete /TN "TeImportamos Tendencias" /F
  echo Lo que hace cada dia queda en tendencias_log.txt
)
pause
