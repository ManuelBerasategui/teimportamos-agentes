@echo off
cd /d "%~dp0"
echo Se abre una ventana de Mercado Libre.
echo Si pide INICIAR SESION, ingresa con tu cuenta ahi (queda guardada para las proximas veces).
echo Si pide "completa este paso", hacelo ahi y espera: el programa sigue solo.
python tendencias_ml.py --ver
pause
