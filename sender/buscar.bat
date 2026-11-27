@echo off
cd /d "%~dp0"
set /p Q=Que palabra busco en los chats? (ej: led): 
python buscar.py %Q%
pause
