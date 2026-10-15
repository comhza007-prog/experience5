$ErrorActionPreference='Stop'
. "$PSScriptRoot/q20_host.ps1" -LibraryOnly
$testFrame=[byte[]]::new(432)
function V([int]$i,[single]$x){[BitConverter]::GetBytes($x).CopyTo($testFrame,4*$i)}
function Reject([scriptblock]$f){$caught=$false;try{& $f}catch{$caught=$true};if(-not $caught){throw 'Expected rejection'}}
V 0 10;V 1 250;V 21 11;V 63 68312;V 87 6;V 92 1;V 93 4501;V 96 12345
V 98 1;V 99 1;V 35 4;V 36 4;V 27 24.3;V 73 1
$testFrame[430]=128;$testFrame[431]=127;$script:session=12345
$v=Get-SupervisedDecoded $testFrame;if($null -eq $v){throw 'Valid idle rejected'}
Test-SupervisedIdle $v -RequireMotorFeedback;Test-SupervisedCaptureFrame $v
V 47 -1;$v=Get-SupervisedDecoded $testFrame;Reject {Test-SupervisedIdle $v -RequireMotorFeedback};V 47 0
V 22 512;V 2 9;$v=Get-SupervisedDecoded $testFrame;if($null -eq $v){throw 'Fault hidden'};Test-SupervisedCaptureFrame $v
V 13 1;$v=Get-SupervisedDecoded $testFrame;Reject {Test-SupervisedCaptureFrame $v};V 13 0
V 22 0;V 2 6;V 88 4445;V 89 3;V 90 721;V 92 69312
foreach($i in 91,93,3,4,5,6,7,8,9,10,11,12,15,16,17,18,23,24,25,26,29,30,31,32,33,34,35,36,37,38,39,40,49,50,51,52,104,105,55,56,61,62,64,65,66,67,68,74,75,76){V $i 65536}
$v=Get-SupervisedDecoded $testFrame;Test-SupervisedCaptureFrame $v
V 3 65537;$v=Get-SupervisedDecoded $testFrame;Reject {Test-SupervisedCaptureFrame $v};V 3 65536
V 89 4;V 90 0;$v=Get-SupervisedDecoded $testFrame;Test-SupervisedCaptureFrame $v
V 90 722;$v=Get-SupervisedDecoded $testFrame;Reject {Test-SupervisedCaptureFrame $v}
if((Get-SupervisedCrc ([Text.Encoding]::ASCII.GetBytes('123456789')) 9) -ne 0x29b1){throw 'CRC known vector failed'}
$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile("$PSScriptRoot/q20_host.ps1",[ref]$tokens,[ref]$errors)|Out-Null
if($errors.Count){throw ($errors|Out-String)}
Reject {& "$PSScriptRoot/q20_host.ps1" -Mode Run}
Write-Output 'PASS Q20 host idle/health/fault preservation, encoded payload,722chunk bounds, completion state, CRC and refusal without onsite permission; no hardware opened'
