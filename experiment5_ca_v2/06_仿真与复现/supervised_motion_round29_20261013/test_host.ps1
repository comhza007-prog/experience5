$ErrorActionPreference='Stop'
. "$PSScriptRoot/supervised_host.ps1" -LibraryOnly
$testFrame=[byte[]]::new(432)
function Set-TestValue([int]$Index,[single]$Value){[BitConverter]::GetBytes($Value).CopyTo($testFrame,4*$Index)}
function Expect-Rejection([scriptblock]$Action){$caught=$false;try{& $Action}catch{$caught=$true};if(-not $caught){throw 'Expected rejection did not occur'}}
Set-TestValue 0 10;Set-TestValue 1 250;Set-TestValue 21 12;Set-TestValue 63 67412
Set-TestValue 87 6;Set-TestValue 92 1;Set-TestValue 93 4483;Set-TestValue 96 12345
Set-TestValue 98 1;Set-TestValue 99 1;Set-TestValue 35 4;Set-TestValue 36 4
Set-TestValue 27 24.3;Set-TestValue 73 1
$testFrame[430]=128;$testFrame[431]=127
$script:session=12345
$v=Get-SupervisedDecoded $testFrame
if($null -eq $v){throw 'Valid frame rejected'}
Test-SupervisedIdle $v -RequireMotorFeedback;Test-SupervisedCaptureFrame $v
Set-TestValue 47 -1;$v=Get-SupervisedDecoded $testFrame;Test-SupervisedIdle $v
Expect-Rejection {Test-SupervisedIdle $v -RequireMotorFeedback};Set-TestValue 47 0
Set-TestValue 98 .9;$v=Get-SupervisedDecoded $testFrame;Expect-Rejection {Test-SupervisedIdle $v};Set-TestValue 98 1
Set-TestValue 96 12344;$v=Get-SupervisedDecoded $testFrame;Expect-Rejection {Test-SupervisedCaptureFrame $v};Set-TestValue 96 12345
Set-TestValue 21 0;if($null -ne (Get-SupervisedDecoded $testFrame)){throw 'Incoherent method accepted'};Set-TestValue 21 12
Set-TestValue 1 250.5;if($null -ne (Get-SupervisedDecoded $testFrame)){throw 'Fractional sequence accepted'};Set-TestValue 1 250
Set-TestValue 0 0;if($null -ne (Get-SupervisedDecoded $testFrame)){throw 'Startup false frame accepted'};Set-TestValue 0 10
Set-TestValue 2 9;Set-TestValue 22 32
$v=Get-SupervisedDecoded $testFrame;if($null -eq $v){throw 'Genuine fault incorrectly hidden'}
Test-SupervisedCaptureFrame $v
Set-TestValue 13 1;$v=Get-SupervisedDecoded $testFrame;Expect-Rejection {Test-SupervisedCaptureFrame $v};Set-TestValue 13 0
Set-TestValue 22 0;Set-TestValue 2 6;Set-TestValue 88 4434;Set-TestValue 89 3
Set-TestValue 90 64;Set-TestValue 91 2;Set-TestValue 92 128;Set-TestValue 93 5360
$v=Get-SupervisedDecoded $testFrame;if($null -eq $v){throw 'Replay schema incorrectly rejected'}
Test-SupervisedCaptureFrame $v
Set-TestValue 89 4;$v=Get-SupervisedDecoded $testFrame;Test-SupervisedCaptureFrame $v
Set-TestValue 88 4424;$v=Get-SupervisedDecoded $testFrame;Expect-Rejection {Test-SupervisedCaptureFrame $v}
Set-TestValue 20 ([single]::NaN);if($null -ne (Get-SupervisedDecoded $testFrame)){throw 'Nonfinite frame accepted'}
if((Get-SupervisedCrc ([Text.Encoding]::ASCII.GetBytes('123456789')) 9) -ne 0x29b1){throw 'CRC known vector failed'}
foreach($op in 2,3,4,5,6){$p=New-SupervisedPacket $op 123 12345;if($p.Length -ne 16 -or $p[3] -ne $op -or [BitConverter]::ToUInt16($p,14) -ne (Get-SupervisedCrc $p 14)){throw 'Packet encoding/CRC failed'}}
$testTokens=$null;$testErrors=$null
[System.Management.Automation.Language.Parser]::ParseFile("$PSScriptRoot/supervised_host.ps1",[ref]$testTokens,[ref]$testErrors)|Out-Null
if($testErrors.Count){throw ($testErrors|Out-String)}
# Refusing Run without site confirmation happens before serial construction.
Expect-Rejection {& "$PSScriptRoot/supervised_host.ps1" -Mode Run}
Write-Output 'PASS host syntax/CRC, identity/startup/nonfinite rejection, genuine fault preserved, session/default/health guards, event schema, zero after fault, explicit site confirmation; no hardware opened'
