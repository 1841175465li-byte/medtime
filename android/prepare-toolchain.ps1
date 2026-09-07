param([string]$WorkRoot = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (!$WorkRoot) {
    $taskProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $WorkRoot = Join-Path $taskProject 'work\android-build'
}
$taskDownloads = Join-Path $WorkRoot 'downloads'
$taskTools = Join-Path $WorkRoot 'toolchain'
New-Item -ItemType Directory -Force -Path $taskDownloads, $taskTools | Out-Null
$taskPackages = @(
    @{
        Name = 'jdk17'; Url = 'https://aka.ms/download-jdk/microsoft-jdk-17.0.20.1-windows-x64.zip'
        Hash = '3d9006956fc8af5601cd24ffc4f468bef48279c7ebd8171b9bdf90d0aabfbf1f'
        Marker = 'jdk-17.0.20.1+1\bin\javac.exe'
    },
    @{
        Name = 'build-tools35'; Url = 'https://dl.google.com/android/repository/build-tools_r35_windows.zip'
        Hash = '5753c679a1b90bcf6fbc9945a2ce39dfb9e74f1df0831a1e1866ae5b594326f0'
        Marker = 'android-15\aapt2.exe'
    },
    @{
        Name = 'platform35'; Url = 'https://dl.google.com/android/repository/platform-35-ext15_r01.zip'
        Hash = 'a93712aedd4f851d9cf1f7281f7c4fe5581ce03a9df37ffc8c53a487eadf311f'
        Marker = 'android-35-ext15\android.jar'
    }
)
foreach ($taskPackage in $taskPackages) {
    $taskArchive = Join-Path $taskDownloads ($taskPackage.Name + '.zip')
    if (!(Test-Path -LiteralPath $taskArchive)) {
        Write-Output ('Downloading official portable dependency: ' + $taskPackage.Name)
        & curl.exe --fail --location --retry 2 --max-time 600 --output $taskArchive $taskPackage.Url
        if ($LASTEXITCODE -ne 0) { throw ('Download failed: ' + $taskPackage.Name) }
    }
    if ((Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash -ne $taskPackage.Hash) {
        throw ('Checksum mismatch: ' + $taskArchive + '. Remove this archive and retry.')
    }
    $taskDestination = Join-Path $taskTools $taskPackage.Name
    if (!(Test-Path -LiteralPath (Join-Path $taskDestination $taskPackage.Marker))) {
        New-Item -ItemType Directory -Force -Path $taskDestination | Out-Null
        & tar.exe -xf $taskArchive -C $taskDestination
        if ($LASTEXITCODE -ne 0) { throw ('Extraction failed: ' + $taskPackage.Name) }
    }
    Write-Output ('Verified: ' + $taskPackage.Name)
}
Write-Output ('Portable toolchain ready: ' + $taskTools)
