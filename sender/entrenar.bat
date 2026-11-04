@echo off
cd /d "%~dp0"
rem Muestra lo que aprendió el contestador. Para pedir practica ahora: entrenar.bat --ya   Para enseñarle una regla: entrenar.bat --regla "texto"
python entrenar.py %*
pause
