$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\welcome-bot.js'
$text = Get-Content $path -Raw -Encoding utf8

$text = $text.Replace('    .setTitle("PNG Panel")', '    .setTitle("PNG Panel • gp-2026-05-15-b")')

$fixedConsoleLine = '      console.log("[graphic-panel] open marker=gp-2026-05-15-b tiers=5,4,3,2,1,6 user=" + (interaction.user?.id || "unknown"));'
$staleConsoleLine = '      console.log("[graphic-panel] open marker=" + GRAPHIC_PANEL_RUNTIME_MARKER + " tiers=" + GRAPHIC_PANEL_TIERS.join(",") + " user=" + (interaction.user?.id || "unknown"));'
$text = $text.Replace($staleConsoleLine + "`r`n", '')
$text = [regex]::Replace(
  $text,
  '^[ ]*console\.log\([^\r\n]*\[graphic-panel\] open marker[^\r\n]*\);[ ]*$' ,
  $fixedConsoleLine,
  [System.Text.RegularExpressions.RegexOptions]::Multiline
)
if (-not $text.Contains('[graphic-panel] open marker=gp-2026-05-15-b')) {
  $target = '      await interaction.reply(buildGraphicPanelPayload());'
  $replacement = $fixedConsoleLine + "`r`n" + $target
  $text = $text.Replace($target, $replacement)
}

Set-Content -Path $path -Value $text -Encoding utf8
node --check $path
Select-String -Path $path -Pattern 'PNG Panel • gp-2026-05-15-b|graphic-panel\] open marker' -Encoding utf8 | ForEach-Object { $_.Line }
