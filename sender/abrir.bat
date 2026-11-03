@echo off
cd /d "%~dp0"
rem Abre el WhatsApp del agente SIN contestar. Para que conteste: activar.bat. Para frenarlo de nuevo: pausar.bat
set VENTANA=visible
python responder.py --seguir --pausado
pause
