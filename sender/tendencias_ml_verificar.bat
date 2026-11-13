@echo off
cd /d "%~dp0"
echo Se abre una ventana de Mercado Libre. Si pide "completa este paso", hacelo ahi y espera: el programa sigue solo.
python tendencias_ml.py --ver
pause
