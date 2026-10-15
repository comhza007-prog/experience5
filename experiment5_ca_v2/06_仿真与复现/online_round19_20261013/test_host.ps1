$ErrorActionPreference='Stop'
. "$PSScriptRoot/online_host.ps1" -LibraryOnly
if((Get-OnlineCrc ([System.Text.Encoding]::ASCII.GetBytes('123456789')) 9) -ne 10673){throw 'CRC test failed'}
$packet=New-OnlinePacket 1 124 1 .75 12345
if($packet.Length -ne 16 -or [System.BitConverter]::ToSingle($packet,8) -ne .75 -or [System.BitConverter]::ToUInt16($packet,12) -ne 12345){throw 'Command packet roundtrip failed'}
if([System.BitConverter]::ToUInt16($packet,14) -ne (Get-OnlineCrc $packet 14)){throw 'Packet CRC failed'}
$frame=[byte[]]::new(432)
for($i=0;$i -lt 107;$i++){[System.BitConverter]::GetBytes([single]$i).CopyTo($frame,4*$i)}
$frame[430]=128;$frame[431]=127
[System.BitConverter]::GetBytes([single]0).CopyTo($frame,8)
[System.BitConverter]::GetBytes([single]66812).CopyTo($frame,252)
$v=Get-OnlineDecoded $frame
if($null -eq $v -or $v.Count -ne 107 -or $v[63] -ne 66812 -or $v[106] -ne 106){throw 'Telemetry decode failed'}
[System.BitConverter]::GetBytes([single]::NaN).CopyTo($frame,80)
if($null -ne (Get-OnlineDecoded $frame)){throw 'Nonfinite frame was accepted'}
$tokens=$null;$errors=$null
[System.Management.Automation.Language.Parser]::ParseFile("$PSScriptRoot/online_host.ps1",[ref]$tokens,[ref]$errors) | Out-Null
if($errors.Count){throw ($errors | Out-String)}
Write-Output 'PASS PowerShell syntax,CRC-CCITT,packet endianness,107-channel decode,NaN rejection; no hardware opened'
