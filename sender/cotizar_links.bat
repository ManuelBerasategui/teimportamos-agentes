@echo off
cd /d "%~dp0"
echo Lector de links de Alibaba: queda mirando la cola cada 5 minutos. Dejalo abierto.
python leer_alibaba.py --cada 5
pause
