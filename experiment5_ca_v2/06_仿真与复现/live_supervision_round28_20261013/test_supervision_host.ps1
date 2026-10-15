$ErrorActionPreference='Stop'
. "$PSScriptRoot/supervision_host.ps1" -LibraryOnly
$taskFrame=[byte[]]::new(432)
function Set-TaskChannel([int]$Index,[single]$Value){[BitConverter]::GetBytes($Value).CopyTo($taskFrame,4*$Index)}
Set-TaskChannel 0 1
Set-TaskChannel 1 25
Set-TaskChannel 21 12
Set-TaskChannel 63 66812
Set-TaskChannel 87 6
Set-TaskChannel 93 4477
$taskFrame[430]=128;$taskFrame[431]=127
if($null -eq (Get-OnlineDecoded $taskFrame)){throw 'Valid frame rejected'}
Set-TaskChannel 21 0
if($null -ne (Get-OnlineDecoded $taskFrame)){throw 'Incoherent identity accepted'}
Set-TaskChannel 21 12
Set-TaskChannel 0 0
if($null -ne (Get-OnlineDecoded $taskFrame)){throw 'Startup false frame accepted'}
Set-TaskChannel 0 1
Set-TaskChannel 1 25.5
if($null -ne (Get-OnlineDecoded $taskFrame)){throw 'Fractional sequence accepted'}
Set-TaskChannel 1 25
Set-TaskChannel 22 32
if($null -eq (Get-OnlineDecoded $taskFrame)){throw 'Real coherent fault filtered out'}
Set-TaskChannel 20 ([single]::NaN)
if($null -ne (Get-OnlineDecoded $taskFrame)){throw 'Nonfinite frame accepted'}
if((Get-OnlineCrc ([Text.Encoding]::ASCII.GetBytes('123456789')) 9) -ne 10673){throw 'CRC failed'}
$taskPacket=New-OnlinePacket 1 1 1 .75 12345
if($taskPacket.Length -ne 16 -or [BitConverter]::ToSingle($taskPacket,8) -ne .75){throw 'Packet failed'}
$taskTokens=$null;$taskErrors=$null
[System.Management.Automation.Language.Parser]::ParseFile("$PSScriptRoot/supervision_host.ps1",[ref]$taskTokens,[ref]$taskErrors)|Out-Null
if($taskErrors.Count){throw ($taskErrors|Out-String)}
Write-Output 'PASS strong framing, startup/identity/NaN rejection, genuine-fault preservation, packet/CRC, syntax; no hardware opened'
