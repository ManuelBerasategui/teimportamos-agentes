@echo off
cd /d "%~dp0"
echo Prueba la lectura de tendencias con la ventana a la vista.
echo Mercado Libre: si ya lo conectaste por la API desde el panel, no se abre (lo lee el panel solo).
echo Google Trends: se abre y consulta despacio. Si Google pide un paso, hacelo en la ventana.
python tendencias_ml.py --ver
pause
