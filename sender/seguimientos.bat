@echo off
cd /d "%~dp0"
rem Ventana visible: si WhatsApp pide QR o tarda, lo ves
set VENTANA=visible
python responder.py --solo-seguimientos
pause
