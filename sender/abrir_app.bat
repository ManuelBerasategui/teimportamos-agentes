@echo off
cd /d "%~dp0"
rem Contestador con la APP de WhatsApp de escritorio (tiene que estar abierta y con sesion). Arranca EN PAUSA.
rem Para que conteste: activar.bat (mientras esta activo no uses el teclado ni el mouse). Para usar la PC: pausar.bat
set ESCRITORIO=app
python responder.py --escritorio --seguir --pausado
pause
