#Requires -Version 5.1
<#
.SYNOPSIS
  VioletCode Windows 安装器（对标 install.sh）。
.PARAMETER Channel
  更新频道：stable 或 preview（默认 preview）。
.PARAMETER Version
  指定安装版本标签，如 v0.1.0-preview.3。
.PARAMETER BinDir
  安装目录（默认 %LOCALAPPDATA%\Programs\violet）。
#>
[CmdletBinding()]
param(
  [string]$Channel = 'preview',
  [string]$Version = '',
  [string]$BinDir = ''
)

$ErrorActionPreference = 'Stop'
# 以 UTF-8 输出，便于捕获与跨代码页一致。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$Repository = 'Viviana-Luna/violetcode'
$ApiBase = if ($env:VIOLET_GITHUB_API_BASE) { $env:VIOLET_GITHUB_API_BASE } else { "https://api.github.com/repos/$Repository" }
$DownloadBase = if ($env:VIOLET_GITHUB_DOWNLOAD_BASE) { $env:VIOLET_GITHUB_DOWNLOAD_BASE } else { "https://github.com/$Repository/releases/download" }
$Asset = 'violet-windows-x64.zip'

if ($BinDir -eq '') {
  $BinDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\violet' } else { Join-Path $HOME '.local\bin' }
}

if ($Channel -ne 'stable' -and $Channel -ne 'preview') {
  throw '错误：更新频道必须是 stable 或 preview。'
}

function Invoke-Api {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -Headers @{
      'Accept'               = 'application/vnd.github+json'
      'User-Agent'           = 'violet-installer'
      'X-GitHub-Api-Version' = '2022-11-28'
    }
  } catch {
    $status = 0
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -eq 403) { throw 'GitHub Release 请求失败：HTTP 403，可能已触发 GitHub API 访问频率限制。' }
    throw "GitHub Release 请求失败：HTTP $status"
  }
  return $response.Content | ConvertFrom-Json
}

function Test-ValidVersion {
  param([string]$Value)
  return $Value -match '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$'
}

function Get-PreviewKey {
  param([string]$Tag)
  $value = $Tag -replace '^v', ''
  if ($value -notmatch '^(\d+)\.(\d+)\.(\d+)-preview\.(\d+)$') { return $null }
  return ('{0:D9}{1:D9}{2:D9}{3:D9}' -f [int]$Matches[1], [int]$Matches[2], [int]$Matches[3], [int]$Matches[4])
}

# 解析标签
if ($Version -ne '') {
  $Tag = $Version
  if ($Tag -notlike 'v*') { $Tag = "v$Tag" }
} elseif ($Channel -eq 'stable') {
  $release = Invoke-Api "$ApiBase/releases/latest"
  $Tag = $release.tag_name
} else {
  $releases = @(Invoke-Api "$ApiBase/releases?per_page=30")
  $bestTag = $null
  $bestKey = $null
  foreach ($r in $releases) {
    if ($r.draft) { continue }
    if (-not $r.prerelease) { continue }
    $version = $r.tag_name -replace '^v', ''
    if (-not (Test-ValidVersion $version)) { continue }
    $key = Get-PreviewKey $r.tag_name
    if ($null -eq $key) { continue }
    if ($null -eq $bestKey -or [uint64]$key -gt [uint64]$bestKey) {
      $bestKey = $key
      $bestTag = $r.tag_name
    }
  }
  if ($null -eq $bestTag) { throw '错误：没有找到可用的 VioletCode 预览版本。' }
  $Tag = $bestTag
}

if (-not $Tag) { throw '错误：无法解析 VioletCode Release 标签。' }

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "violet-install-$([System.Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
try {
  $ArchivePath = Join-Path $TempDir $Asset
  $ChecksumPath = Join-Path $TempDir 'SHA256SUMS'
  $BaseUrl = "$DownloadBase/$Tag"

  try {
    Invoke-WebRequest -Uri "$BaseUrl/$Asset" -UseBasicParsing -OutFile $ArchivePath
    Invoke-WebRequest -Uri "$BaseUrl/SHA256SUMS" -UseBasicParsing -OutFile $ChecksumPath
  } catch {
    throw "下载发布资产失败（$Tag）：$($_.Exception.Message)"
  }

  # 校验 SHA-256
  $expected = $null
  foreach ($line in (Get-Content $ChecksumPath -Encoding UTF8)) {
    if ($line -match '^\s*([a-fA-F0-9]{64})\s+\*?(.+)$') {
      if ($Matches[2].Trim() -eq $Asset) { $expected = $Matches[1].ToLower(); break }
    }
  }
  if (-not $expected) { throw "错误：SHA256SUMS 中没有 $Asset。" }
  $actual = (Get-FileHash -Algorithm SHA256 -Path $ArchivePath).Hash.ToLower()
  if ($actual -ne $expected) { throw "错误：$Asset 的 SHA-256 校验失败。" }

  # 解压（优先用 Windows 自带 bsdtar，比 Expand-Archive 快且与更新器一致）
  $ExtractDir = Join-Path $TempDir 'extracted'
  New-Item -ItemType Directory -Path $ExtractDir -Force | Out-Null
  $systemTar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (Test-Path $systemTar) {
    & $systemTar -xf $ArchivePath -C $ExtractDir
  } else {
    Expand-Archive -Path $ArchivePath -DestinationPath $ExtractDir -Force
  }
  $NewBinary = Join-Path $ExtractDir 'violet.exe'
  if (-not (Test-Path $NewBinary)) { throw '错误：发布包内未找到 violet.exe。' }

  # 验证版本
  $expectedVersion = $Tag -replace '^v', ''
  $versionOutput = (& $NewBinary --version 2>&1) -join "`n"
  if ($versionOutput.Trim() -ne "v$expectedVersion (VioletCode)") {
    throw "错误：新二进制版本验证失败：$versionOutput"
  }

  # 安装
  New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
  $Target = Join-Path $BinDir 'violet.exe'
  if (Test-Path $Target) {
    $currentOutput = (& $Target --version 2>$null) -join "`n"
    if ($currentOutput -notmatch '\(VioletCode\)') {
      throw "错误：$Target 已存在且不是 VioletCode，拒绝覆盖。"
    }
    # Windows 不允许覆盖运行中的 exe：先改名让位。
    $OldPath = "$Target.old"
    if (Test-Path $OldPath) { Remove-Item $OldPath -Force -ErrorAction SilentlyContinue }
    Move-Item -Path $Target -Destination $OldPath -Force
  }
  Move-Item -Path $NewBinary -Destination $Target -Force

  # 加入用户 PATH（测试可用 VIOLET_INSTALL_SKIP_PATH 跳过，避免污染真实环境）
  if (-not $env:VIOLET_INSTALL_SKIP_PATH) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $pathParts = if ($userPath) { $userPath -split ';' | Where-Object { $_ -ne '' } } else { @() }
    if ($pathParts -notcontains $BinDir) {
      $newPath = if ($userPath) { "$userPath;$BinDir" } else { $BinDir }
      [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
      Write-Host "提示：已将 $BinDir 加入用户 PATH，请重新打开终端使其生效。"
    }
  }

  Write-Host "VioletCode $Tag 已安装：$Target"
  Write-Host '提示：VioletCode 在 Windows 上运行需要 git-bash。请安装 Git for Windows，或在 PATH 中可发现 git，或设置 CLAUDE_CODE_GIT_BASH_PATH 指向 bash.exe。'
}
finally {
  Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
