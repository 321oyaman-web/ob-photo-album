# =====================================================================
#  api/ の統合テストページを組み立てる
#
#  ブラウザが file:// を強くキャッシュするため、毎回ファイル名を変えて
#  生成する。同じ名前だと古い内容が実行され、修正が反映されていないのに
#  「成功」と表示されてしまう。
#
#  使い方:  powershell -File tests/build-test.ps1
#  そのあと 生成された TEST<数字>.html をダブルクリックし、最下行を確認する
# =====================================================================

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'tests'
$template = Join-Path $out 'api-test.template.html'

if (-not (Test-Path $template)) {
    Write-Error "テストの雛形が見つかりません: $template"
}

# api/ の全モジュールを1つの JS に固める（ブラウザから読み込むため）
$files = @(
    '_r2.js', '_auth.js', '_scenes.js', '_items.js',
    'login.js', 'photos.js', 'upload-url.js', 'register.js',
    'update.js', 'delete.js', 'health.js', 'videos.js'
)

$map = [ordered]@{}
foreach ($f in $files) {
    $path = Join-Path $root "api\$f"
    if (-not (Test-Path $path)) { Write-Error "見つかりません: $path" }
    $map[$f] = Get-Content $path -Raw -Encoding UTF8
}

$stamp = [DateTimeOffset]::Now.ToUnixTimeSeconds()
$srcName = "src$stamp.js"
$htmlName = "TEST$stamp.html"

Set-Content (Join-Path $out $srcName) `
    -Value ("window.API_SOURCES = " + ($map | ConvertTo-Json -Depth 3 -Compress) + ";") `
    -Encoding UTF8 -NoNewline

$html = Get-Content $template -Raw -Encoding UTF8
$html = $html.Replace('src="API_SOURCES_PLACEHOLDER"', "src=`"$srcName`"")
Set-Content (Join-Path $out $htmlName) -Value $html -Encoding UTF8 -NoNewline

# 前回までの生成物を片付け、取り違えを防ぐ
Get-ChildItem $out -Filter 'TEST*.html' |
    Where-Object { $_.Name -ne $htmlName } | Remove-Item -Force
Get-ChildItem $out -Filter 'src*.js' |
    Where-Object { $_.Name -ne $srcName } | Remove-Item -Force

Write-Host ""
Write-Host "生成しました: tests\$htmlName" -ForegroundColor Green
Write-Host "このファイルをダブルクリックし、最下行の件数を確認してください。"
Write-Host ""
