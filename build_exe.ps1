$ErrorActionPreference = 'Stop'

# Builds a standalone Windows exe using PyInstaller.
# Output: .\dist\BudgetApp.exe

py -m pip install --upgrade pip
py -m pip install --upgrade pyinstaller

# Clean previous builds
if (Test-Path .\build) { Remove-Item -Recurse -Force .\build }
if (Test-Path .\dist) { Remove-Item -Recurse -Force .\dist }
if (Test-Path .\BudgetApp.spec) { Remove-Item -Force .\BudgetApp.spec }

New-Item -ItemType Directory -Force .\build | Out-Null

# Preferred: use the final .ico directly.
$iconFinal = Join-Path .\Resources 'BA_Logo_Final.ico'
$iconOut = Join-Path .\build 'BudgetApp.ico'

if (Test-Path $iconFinal) {
  # Ensure the icon has the common Windows sizes (16/32/48/etc).
  py -m pip install --upgrade pillow

  $py = @"
from __future__ import annotations

from pathlib import Path

from PIL import Image

src = Path(r'$iconFinal')
dst = Path(r'$iconOut')

img = Image.open(src).convert('RGBA')
sizes = [(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)]
img.save(dst, format='ICO', sizes=sizes)
print(f'Wrote icon: {dst.resolve()}')
"@
  py -c $py
} else {
  # Fallback: generate a multi-size .ico from the PNG.
  py -m pip install --upgrade pillow

  $iconSrc = Join-Path .\Resources 'BA_Logo1.png'
  $py = @"
from __future__ import annotations

from pathlib import Path

from PIL import Image

src = Path(r'$iconSrc')
dst = Path(r'$iconOut')

img = Image.open(src).convert('RGBA')
sizes = [(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)]
img.save(dst, format='ICO', sizes=sizes)
print(f'Wrote icon: {dst.resolve()}')
"@
  py -c $py
}

py -m PyInstaller `
  --noconsole `
  --onefile `
  --name BudgetApp `
  --icon .\build\BudgetApp.ico `
  --add-data=.\Resources\BA_Logo_Final.ico:Resources `
  --paths .\src `
  .\budgetapp_gui.py

Write-Host "Built: $PWD\dist\BudgetApp.exe"
