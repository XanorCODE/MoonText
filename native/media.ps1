# MoonText: читает текущий медиа-сеанс Windows (SMTC) и печатает JSON-строки.
# Команды приходят в stdin: toggle | play | pause | next | prev | seek:<сек>
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [type[]]@([Windows.Storage.Streams.IInputStream]))

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, $type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  $t.Result
}

function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }

$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$mgr = Await ($mgrType::RequestAsync()) $mgrType
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]

Add-Type -Namespace MT -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);'
$lastFs = $null

$script:ignored = @()
$script:lastSources = $null

function IsIgnored($sess) { return ($script:ignored -contains [string]$sess.SourceAppUserModelId) }

# Текущий сеанс Windows, но не из списка игнорируемых: если «главный» сеанс игнорируется (например, браузер), берём играющий из остальных
function PickSession {
  $all = @($mgr.GetSessions())
  $ids = @($all | ForEach-Object { [string]$_.SourceAppUserModelId })
  $sig = ($ids | Sort-Object) -join '|'
  if ($sig -ne $script:lastSources) { $script:lastSources = $sig; Emit @{ type = 'sources'; apps = $ids } }
  $cur = $mgr.GetCurrentSession()
  if ($cur -and -not (IsIgnored $cur)) { return $cur }
  $ok = @($all | Where-Object { -not (IsIgnored $_) })
  if ($ok.Count -eq 0) { return $null }
  $playing = $ok | Where-Object { $_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing' } | Select-Object -First 1
  if ($playing) { return $playing }
  return $ok[0]
}

$lastKey = ''
$coverTries = 0
$coverSent = $false
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$readTask = $reader.ReadLineAsync()

while ($true) {
  try {
    $s = PickSession

    # 2 — полноэкранное приложение / режим презентации, 3 — полноэкранная игра (D3D), 4 — презентация
    $q = 0
    $null = [MT.Shell]::SHQueryUserNotificationState([ref]$q)
    $fs = ($q -eq 2 -or $q -eq 3 -or $q -eq 4)
    if ($fs -ne $lastFs) { $lastFs = $fs; Emit @{ type = 'fs'; on = $fs } }

    if ($readTask.IsCompleted) {
      $cmd = $readTask.Result
      $readTask = $reader.ReadLineAsync()
      if ($cmd -eq $null) { break }
      if ($cmd -match '^ignore:(.+)$') {
        try {
          $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Matches[1]))
          $script:ignored = @(ConvertFrom-Json $json | ForEach-Object { [string]$_ })
        } catch { $script:ignored = @() }
        $s = PickSession
        $lastKey = ''
      } elseif ($s) {
        switch -Regex ($cmd) {
          '^toggle$' { $null = $s.TryTogglePlayPauseAsync() }
          '^play$'   { $null = $s.TryPlayAsync() }
          '^pause$'  { $null = $s.TryPauseAsync() }
          '^next$'   { $null = $s.TrySkipNextAsync() }
          '^prev$'   { $null = $s.TrySkipPreviousAsync() }
          '^seek:(.+)$' {
            $sec = 0.0
            if ([double]::TryParse($Matches[1], [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$sec) -and $sec -ge 0 -and $sec -lt 360000) {
              $null = $s.TryChangePlaybackPositionAsync([long]($sec * 10000000))
            }
          }
        }
      }
    }

    if (-not $s) {
      Emit @{ type = 'none' }
      $lastKey = ''
    } else {
      $p = Await ($s.TryGetMediaPropertiesAsync()) $propsType
      $tl = $s.GetTimelineProperties()
      $pb = $s.GetPlaybackInfo()
      $dur = ($tl.EndTime - $tl.StartTime).TotalSeconds
      Emit @{
        type = 'state'
        app = $s.SourceAppUserModelId
        title = $p.Title
        artist = $p.Artist
        album = $p.AlbumTitle
        status = $pb.PlaybackStatus.ToString()
        pos = $tl.Position.TotalSeconds
        dur = $dur
        updated = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
      }

      $key = "$($s.SourceAppUserModelId)|$($p.Artist)|$($p.Title)"
      if ($key -ne $lastKey) { $lastKey = $key; $coverTries = 0; $coverSent = $false }
      # Spotify и браузеры отдают обложку с задержкой — пробуем несколько раз
      if (-not $coverSent -and $coverTries -lt 15) {
        $coverTries++
        try {
          if ($p.Thumbnail) {
            $stream = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
            # AsStreamForRead — метод расширения; из PowerShell его можно вызвать только через рефлексию
            $net = $asStreamForRead.Invoke($null, @($stream))
            $ms = New-Object System.IO.MemoryStream
            $net.CopyTo($ms)
            if ($ms.Length -gt 0 -and $ms.Length -lt 4000000) {
              Emit @{ type = 'cover'; title = $p.Title; artist = $p.Artist; mime = $stream.ContentType; data = [Convert]::ToBase64String($ms.ToArray()) }
              $coverSent = $true
            }
          }
        } catch { }
      }
    }
  } catch {
    Emit @{ type = 'error'; message = $_.Exception.Message }
  }
  Start-Sleep -Milliseconds 400
}
