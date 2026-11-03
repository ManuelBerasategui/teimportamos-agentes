@echo off
cd /d "%~dp0"
type nul > PAUSA
echo Agente EN PAUSA: termina el mensaje que estaba escribiendo y no contesta mas hasta que uses activar.bat.
timeout /t 3 >nul
