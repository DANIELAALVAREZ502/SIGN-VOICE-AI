[CmdletBinding()]
param([string]$ProjectRoot='')

$ErrorActionPreference='Stop'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $sd = Split-Path -Parent $MyInvocation.MyCommand.Path
  $ProjectRoot = Split-Path -Parent $sd
}
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $ProjectRoot "assets\icons"
if (-not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$BG_DEEP   = [System.Drawing.Color]::FromArgb(255, 5,7,13)
$BG_PANEL  = [System.Drawing.Color]::FromArgb(255,11,16,32)
$CYAN      = [System.Drawing.Color]::FromArgb(255,0,240,255)
$VIOLET    = [System.Drawing.Color]::FromArgb(255,123,43,255)
$MAGENTA   = [System.Drawing.Color]::FromArgb(255,255,45,149)
$MINT      = [System.Drawing.Color]::FromArgb(255,0,255,156)

$joints = @(
 @(0.291,0.695),@(0.383,0.453),@(0.404,0.586),@(0.482,0.523),@(0.523,0.453),
 @(0.453,0.293),@(0.453,0.161),@(0.523,0.453),@(0.664,0.398),
 @(0.574,0.453),@(0.625,0.293),@(0.664,0.482),@(0.727,0.492),
 @(0.691,0.484),@(0.725,0.328),@(0.754,0.484),@(0.801,0.508),
 @(0.669,0.586),@(0.688,0.523),@(0.714,0.625),@(0.732,0.711)
)
$jointColors = @($MINT,$CYAN,$CYAN,$CYAN,$CYAN,$CYAN,$CYAN,$CYAN,$CYAN,$VIOLET,$VIOLET,$VIOLET,$VIOLET,$MAGENTA,$MAGENTA,$MAGENTA,$MAGENTA,$CYAN,$CYAN,$CYAN,$CYAN)
$handEdges = @(
 @{A=0;B=1;W=0.115},@{A=1;B=2;W=0.100},@{A=2;B=3;W=0.085},@{A=3;B=4;W=0.075},@{A=0;B=5;W=0.115},@{A=5;B=6;W=0.095},@{A=6;B=7;W=0.080},@{A=7;B=8;W=0.070},@{A=0;B=9;W=0.115},@{A=9;B=10;W=0.095},@{A=10;B=11;W=0.080},@{A=11;B=12;W=0.070},@{A=0;B=13;W=0.115},@{A=13;B=14;W=0.090},@{A=14;B=15;W=0.078},@{A=15;B=16;W=0.068},@{A=0;B=17;W=0.110},@{A=17;B=18;W=0.085},@{A=18;B=19;W=0.075},@{A=19;B=20;W=0.065},@{A=5;B=9;W=0.085},@{A=9;B=13;W=0.085},@{A=13;B=17;W=0.080},@{A=5;B=17;W=0.080}
)

function Save-Icon($Name,[int]$Size,[double]$Inset=0){
  $bmp = New-Object System.Drawing.Bitmap($Size,$Size,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $rect = New-Object System.Drawing.Rectangle(0,0,$Size,$Size)
  $bg   = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,$BG_PANEL,$BG_DEEP,[System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
  $g.FillRectangle($bg,$rect); $bg.Dispose()
  $usable=$Size*(1-2*$Inset); $ox=$Size*$Inset; $oy=$Size*$Inset
  foreach($e in $handEdges){
    $x1=$ox+($joints[$e.A][0]*$usable); $y1=$oy+($joints[$e.A][1]*$usable)
    $x2=$ox+($joints[$e.B][0]*$usable); $y2=$oy+($joints[$e.B][1]*$usable)
    $t=$e.B/20.0; if($t-lt0.35){$c=$CYAN}elseif($t-lt0.7){$c=$VIOLET}else{$c=$MAGENTA}
    $p=New-Object System.Drawing.Pen($c,[Math]::Max(2,$e.W*$usable*0.62)); $p.StartCap=[System.Drawing.Drawing2D.LineCap]::Round; $p.EndCap=[System.Drawing.Drawing2D.LineCap]::Round; $g.DrawLine($p,$x1,$y1,$x2,$y2); $p.Dispose()
  }
  for($i=0;$i-lt$joints.Count;$i++){
    $cx=$ox+($joints[$i][0]*$usable); $cy=$oy+($joints[$i][1]*$usable); $r=[Math]::Max(2,$usable*0.03)
    $h=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70,$jointColors[$i].R,$jointColors[$i].G,$jointColors[$i].B)); $g.FillEllipse($h,$cx-$r*1.9,$cy-$r*1.9,$r*3.8,$r*3.8); $h.Dispose()
    $k=New-Object System.Drawing.SolidBrush($jointColors[$i]); $g.FillEllipse($k,$cx-$r,$cy-$r,$r*2,$r*2); $k.Dispose()
  }
  $barY=$oy+0.79*$usable
  @(@(0.188,0.293,$CYAN),@(0.500,0.121,$VIOLET),@(0.641,0.172,$MAGENTA)) | ForEach-Object{
    $bx=$ox+($_[0]*$usable); $bw=$_[1]*$usable; $co=$_[2]
    $br=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230,$co.R,$co.G,$co.B)); $g.FillRectangle($br,$bx,$barY,$bw,[Math]::Max(2,$usable*0.028)); $br.Dispose()
  }
  $m=$Size*0.10;$len=$Size*0.07;$cp=New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(140,0,255,156),[Math]::Max(1,$Size/200)); $cp.StartCap=[System.Drawing.Drawing2D.LineCap]::Round;$cp.EndCap=[System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($cp,$m,$m,$m+$len,$m);$g.DrawLine($cp,$m,$m,$m,$m+$len);$g.DrawLine($cp,$Size-$m,$m,$Size-$m-$len,$m);$g.DrawLine($cp,$Size-$m,$m,$Size-$m,$m+$len);$g.DrawLine($cp,$m,$Size-$m,$m+$len,$Size-$m);$g.DrawLine($cp,$m,$Size-$m,$m,$Size-$m-$len);$g.DrawLine($cp,$Size-$m,$Size-$m,$Size-$m-$len,$Size-$m);$g.DrawLine($cp,$Size-$m,$Size-$m,$Size-$m,$Size-$m-$len);$cp.Dispose()
  $path=Join-Path $outDir $Name; $bmp.Save($path,[System.Drawing.Imaging.ImageFormat]::Png); $kb=[Math]::Round((Get-Item $path).Length/1KB,1); $g.Dispose(); $bmp.Dispose()
  Write-Host ("  OK  {0,-28} {1}x{1}  {2} KB" -f $Name,$Size,$kb)
}
Write-Host "`n  Generando iconos PWA..."; Write-Host "  Destino: $outDir`n"
Save-Icon 'icon-192.png' 192 0; Save-Icon 'icon-512.png' 512 0; Save-Icon 'icon-maskable-512.png' 512 0.20; Save-Icon 'apple-touch-icon.png' 180 0.06; Save-Icon 'favicon-32.png' 32 0
Write-Host "`n  Listo.`n"
