@echo off
cd /d "%~dp0\.."
echo Actualizando desde GitHub (no toca tu .env ni los perfiles)...
where git >nul 2>nul || (echo Falta instalar Git: https://git-scm.com/download/win & pause & exit /b)
if not exist .git (
  echo Primera vez: conecto esta carpeta con el repositorio.
  git init -q
  git remote add origin https://github.com/ManuelBerasategui/teimportamos-agentes.git
)
git fetch --depth 1 origin main
if errorlevel 1 (
  echo No pude bajar. Si se abrio una ventana para iniciar sesion en GitHub, hacelo y volve a abrir este archivo.
  pause
  exit /b
)
git reset -q --hard origin/main
echo Listo, actualizado a la ultima version.
pause
