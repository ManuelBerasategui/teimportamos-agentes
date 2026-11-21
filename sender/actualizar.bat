@echo off
cd /d "%~dp0\.."
echo Bajando la ultima version del repositorio...
git pull origin main
if errorlevel 1 (echo No se pudo actualizar. Si esta carpeta no es un repositorio de git, avisale a Claude.) else (echo Listo, actualizado.)
pause
