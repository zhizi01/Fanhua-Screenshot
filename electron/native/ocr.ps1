param(
  [ValidateSet('capabilities', 'recognize')][string]$Mode = 'capabilities',
  [string]$ImagePath,
  [string]$Language
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Foundation, ContentType=WindowsRuntime]
  $languages = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object {
    @{ tag = $_.LanguageTag; name = $_.DisplayName }
  })
  if ($Mode -eq 'capabilities') {
    @{ available = ($languages.Count -gt 0); languages = $languages; maxDimension = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension } | ConvertTo-Json -Depth 8 -Compress
    exit 0
  }
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
  $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  function Await($Operation, [type]$ResultType) {
    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    if (!$task.Wait(30000)) { throw 'OCR_TIMEOUT' }
    return $task.Result
  }
  if ($Language) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($Language))
  } else {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  }
  if (!$engine) { throw 'OCR_LANGUAGE_UNAVAILABLE' }
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  try {
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $width = [int]$decoder.PixelWidth
    $height = [int]$decoder.PixelHeight
    $max = [int][Windows.Media.Ocr.OcrEngine]::MaxImageDimension
    $overlap = 96
    $step = $max - $overlap
    $lines = New-Object 'System.Collections.Generic.List[object]'
    # Decode every tile at original resolution. Overlap prevents text at a crop
    # boundary from disappearing; the JS layer removes duplicate overlapping lines.
    for ($y = 0; $y -lt $height; $y += $step) {
      for ($x = 0; $x -lt $width; $x += $step) {
        $tileWidth = [Math]::Min($max, $width - $x)
        $tileHeight = [Math]::Min($max, $height - $y)
        $transform = [Windows.Graphics.Imaging.BitmapTransform]::new()
        $bounds = [Windows.Graphics.Imaging.BitmapBounds]::new()
        $bounds.X = $x; $bounds.Y = $y; $bounds.Width = $tileWidth; $bounds.Height = $tileHeight
        $transform.Bounds = $bounds
        $bitmap = Await ($decoder.GetSoftwareBitmapAsync(
          [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
          [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
          $transform,
          [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation,
          [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage
        )) ([Windows.Graphics.Imaging.SoftwareBitmap])
        try {
          $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
          foreach ($line in $result.Lines) {
            $words = @($line.Words)
            if ($words.Count -eq 0) { continue }
            $left = [double]::PositiveInfinity; $top = [double]::PositiveInfinity
            $right = 0.0; $bottom = 0.0
            foreach ($word in $words) {
              $rect = $word.BoundingRect
              $left = [Math]::Min($left, $rect.X); $top = [Math]::Min($top, $rect.Y)
              $right = [Math]::Max($right, $rect.X + $rect.Width); $bottom = [Math]::Max($bottom, $rect.Y + $rect.Height)
            }
            $lines.Add(@{ text = $line.Text; bounds = @{ x = $left + $x; y = $top + $y; width = $right - $left; height = $bottom - $top } })
          }
        } finally { $bitmap.Dispose() }
        if ($x + $tileWidth -ge $width) { break }
      }
      if ($y + $tileHeight -ge $height) { break }
    }
    @{ lines = @($lines.ToArray()); language = $engine.RecognizerLanguage.LanguageTag; width = $width; height = $height } | ConvertTo-Json -Depth 10 -Compress
  } finally { $stream.Dispose() }
} catch {
  @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 1
}
