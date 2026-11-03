@echo off
cd /d "%~dp0"
if exist PAUSA del PAUSA
echo Agente ACTIVADO: vuelve a contestar en unos segundos (mira la ventana negra).
timeout /t 3 >nul
