param(
    [string]$ToolchainRoot = "",
    [string]$WorkRoot = "",
    [string]$WebRoot = "",
    [string]$OutputApk = ""
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$WorkRoot) { $WorkRoot = Join-Path $taskProject 'work\android-build' }
if (!$ToolchainRoot) { $ToolchainRoot = Join-Path $WorkRoot 'toolchain' }
if (!$WebRoot) { $WebRoot = Join-Path $PSScriptRoot '..\web' }
if (!$OutputApk) { $OutputApk = Join-Path $PSScriptRoot '..\medtime-1.6.0.apk' }
$taskJava = Join-Path $ToolchainRoot 'jdk17\jdk-17.0.20.1+1\bin'
$taskSdk = Join-Path $ToolchainRoot 'build-tools35\android-15'
$taskAndroidJar = Join-Path $ToolchainRoot 'platform35\android-35-ext15\android.jar'
foreach ($taskRequired in @((Join-Path $taskJava 'javac.exe'), (Join-Path $taskSdk 'aapt2.exe'), $taskAndroidJar, (Join-Path $WebRoot 'index.html'))) {
    if (!(Test-Path -LiteralPath $taskRequired)) { throw "Missing $taskRequired. Run prepare-toolchain.ps1 first, and provide the completed web folder." }
}
function Invoke-BuildTool([string]$Program, [string[]]$ToolArguments) {
    & $Program @ToolArguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
$taskBuild = Join-Path $WorkRoot ('build-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss-fff'))
$taskClasses = Join-Path $taskBuild 'classes'
$taskDex = Join-Path $taskBuild 'dex'
$taskAssets = Join-Path $taskBuild 'assets'
$taskGenerated = Join-Path $taskBuild 'generated'
foreach ($taskDirectory in @($taskClasses, $taskDex, $taskAssets, $taskGenerated)) {
    New-Item -ItemType Directory -Force -Path $taskDirectory | Out-Null
}
Copy-Item -LiteralPath $WebRoot -Destination (Join-Path $taskAssets 'www') -Recurse
$taskResources = Join-Path $taskBuild 'resources.zip'
$taskUnaligned = Join-Path $taskBuild 'app-unaligned.apk'
$taskAligned = Join-Path $taskBuild 'app-aligned.apk'
Invoke-BuildTool (Join-Path $taskSdk 'aapt2.exe') @('compile', '--dir', (Join-Path $PSScriptRoot 'res'), '-o', $taskResources)
Invoke-BuildTool (Join-Path $taskSdk 'aapt2.exe') @('link', '-o', $taskUnaligned, '-I', $taskAndroidJar, '--manifest', (Join-Path $PSScriptRoot 'AndroidManifest.xml'), '--java', $taskGenerated, $taskResources)
$taskSources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src'), $taskGenerated -Recurse -File -Filter '*.java' | ForEach-Object { $_.FullName })
Invoke-BuildTool (Join-Path $taskJava 'javac.exe') (@('-encoding', 'UTF-8', '--release', '8', '-classpath', $taskAndroidJar, '-d', $taskClasses) + $taskSources)
$taskClassJar = Join-Path $taskBuild 'classes.jar'
Invoke-BuildTool (Join-Path $taskJava 'jar.exe') @('cf', $taskClassJar, '-C', $taskClasses, '.')
Invoke-BuildTool (Join-Path $taskJava 'java.exe') @('-cp', (Join-Path $taskSdk 'lib\d8.jar'), 'com.android.tools.r8.D8', '--lib', $taskAndroidJar, '--min-api', '26', '--output', $taskDex, $taskClassJar)
Invoke-BuildTool (Join-Path $taskJava 'jar.exe') @('uf', $taskUnaligned, '-C', $taskDex, 'classes.dex')
# JDK jar normalizes ZIP entry separators. AAPT2 -A on Windows can emit backslashes.
Invoke-BuildTool (Join-Path $taskJava 'jar.exe') @('uf', $taskUnaligned, '-C', $taskBuild, 'assets')
Invoke-BuildTool (Join-Path $taskSdk 'zipalign.exe') @('-f', '-p', '4', $taskUnaligned, $taskAligned)

# This private local signing key is retained in work/. Keep it for compatible updates.
$taskSigning = Join-Path $WorkRoot 'signing'
New-Item -ItemType Directory -Force -Path $taskSigning | Out-Null
$taskKey = Join-Path $taskSigning 'medtime-local.p12'
$taskPasswordFile = Join-Path $taskSigning 'password.txt'
if (!(Test-Path -LiteralPath $taskKey)) {
    $taskPassword = [Guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllText($taskPasswordFile, $taskPassword, [Text.Encoding]::ASCII)
    Invoke-BuildTool (Join-Path $taskJava 'keytool.exe') @('-genkeypair', '-keystore', $taskKey, '-storetype', 'PKCS12', '-storepass:file', $taskPasswordFile, '-alias', 'medtime', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Medtime Personal Build, OU=Local App, O=Medtime')
}
if (!(Test-Path -LiteralPath $taskPasswordFile)) { throw 'The existing signing key needs its original password.txt.' }
$OutputApk = [IO.Path]::GetFullPath($OutputApk)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputApk) | Out-Null
Invoke-BuildTool (Join-Path $taskJava 'java.exe') @('-jar', (Join-Path $taskSdk 'lib\apksigner.jar'), 'sign', '--ks', $taskKey, '--ks-key-alias', 'medtime', '--ks-pass', ('file:' + $taskPasswordFile), '--out', $OutputApk, $taskAligned)
Invoke-BuildTool (Join-Path $taskJava 'java.exe') @('-jar', (Join-Path $taskSdk 'lib\apksigner.jar'), 'verify', '--verbose', '--print-certs', $OutputApk)
Invoke-BuildTool (Join-Path $taskSdk 'zipalign.exe') @('-c', '-p', '4', $OutputApk)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskZip = [IO.Compression.ZipFile]::OpenRead($OutputApk)
try {
    if (@($taskZip.Entries | Where-Object { $_.FullName.Contains('\') }).Count -gt 0) {
        throw 'APK contains noncanonical ZIP paths.'
    }
    foreach ($taskWebFile in @(Get-ChildItem -LiteralPath (Join-Path $taskAssets 'www') -Recurse -File)) {
        $taskRelative = $taskWebFile.FullName.Substring($taskAssets.Length + 1).Replace('\', '/')
        $taskEntry = $taskZip.GetEntry('assets/' + $taskRelative)
        if ($null -eq $taskEntry) { throw ('APK is missing asset: ' + $taskRelative) }
        $taskStream = $taskEntry.Open()
        $taskHasher = [Security.Cryptography.SHA256]::Create()
        try {
            $taskPackedHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskStream)).Replace('-', '')
        } finally { $taskStream.Dispose(); $taskHasher.Dispose() }
        if ($taskPackedHash -ne (Get-FileHash -LiteralPath $taskWebFile.FullName -Algorithm SHA256).Hash) {
            throw ('APK asset differs from source: ' + $taskRelative)
        }
    }
} finally { $taskZip.Dispose() }
Write-Output 'All APK web assets match staged source files; ZIP paths are canonical.'
$taskHash = (Get-FileHash -LiteralPath $OutputApk -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($OutputApk + '.sha256'), ($taskHash + '  ' + [IO.Path]::GetFileName($OutputApk) + "`n"), [Text.Encoding]::ASCII)
Write-Output "APK ready: $OutputApk"
Write-Output "SHA256: $taskHash"
Write-Output "Build intermediates: $taskBuild"
