[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('prd', 'stg')]
    [string]$Target,

    [string]$Remote = 'origin',
    [string]$Branch = 'master'
)

$ErrorActionPreference = 'Stop'

$expectedRepository = @{
    prd = 'scpjpReaderActions.git'
    stg = 'scpjpReaderActions-stg.git'
}[$Target]

$repositoryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repositoryRoot
try {
    $remoteUrl = (git remote get-url $Remote).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "Remote '$Remote' が見つかりません。"
    }

    if ($remoteUrl -notmatch [regex]::Escape($expectedRepository)) {
        throw "PUSH先不一致: Target=$Target, remote=$remoteUrl"
    }

    $currentBranch = (git branch --show-current).Trim()
    if ($currentBranch -ne $Branch) {
        throw "PUSH対象ブランチは '$Branch' です。現在のブランチ: '$currentBranch'"
    }

    $status = git status --porcelain
    if ($status) {
        throw "未コミット変更があります。先にコミットまたは変更を整理してください。"
    }

    $head = (git rev-parse --short HEAD).Trim()
    Write-Host "PUSH先: $Target"
    Write-Host "Repository: $remoteUrl"
    Write-Host "Branch: $currentBranch"
    Write-Host "Commit: $head"

    $confirmation = Read-Host "続行する場合は 'PUSH $Target' と入力してください"
    if ($confirmation -cne "PUSH $Target") {
        Write-Host "PUSHを中止しました。"
        exit 1
    }

    git push $Remote "HEAD:$Branch"
    if ($LASTEXITCODE -ne 0) {
        throw "git push に失敗しました。"
    }
}
finally {
    Pop-Location
}

