$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$project = Join-Path $repoRoot 'native/audio-backends/windows/SurroundAudioBackend.vcxproj'
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"

if (!(Test-Path $vswhere)) {
  throw 'vswhere.exe was not found. Install Visual Studio 2022 with Desktop development with C++.'
}

$installationPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$installationPath) {
  throw 'Visual Studio C++ tools were not found. Install the Desktop development with C++ workload.'
}

$msbuild = Join-Path $installationPath 'MSBuild/Current/Bin/amd64/MSBuild.exe'
if (!(Test-Path $msbuild)) {
  $msbuild = Join-Path $installationPath 'MSBuild/Current/Bin/MSBuild.exe'
}
if (!(Test-Path $msbuild)) {
  throw 'MSBuild.exe was not found in the Visual Studio installation.'
}

& $msbuild $project /p:Configuration=Release /p:Platform=x64 /m
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
