param(
    [ValidateSet('Status','Capture','Run','Stop','FaultStatus')][string]$Mode='Status',
    [string]$Port='COM4',
    [ValidateSet(68212)][int]$ExpectedBuild=68212,
    [ValidateRange(1,450)][int]$Duration=5,
    [string]$OutputPath='',
    [switch]$ConfirmedSiteReady,
    [switch]$LibraryOnly
)
$ErrorActionPreference='Stop'
$ExpectedMethod=11
# Only build68212/schema4500, Q2 encoding1. No tuning, reset, flash or repeat mode.
# Run requires on-site emptyload/fixed structure/clear travel/emergency stop
# and drive power readiness. A serial STOP is not a physical safety brake.
function Get-SupervisedCrc([byte[]]$Bytes,[int]$Count) {
    [int]$crc=65535
    for($i=0;$i -lt $Count;$i++) {
        $crc=$crc -bxor ([int]$Bytes[$i] -shl 8)
        for($j=0;$j -lt 8;$j++) {
            if($crc -band 32768){$crc=(($crc -shl 1) -bxor 4129) -band 65535}
            else {$crc=($crc -shl 1) -band 65535}
        }
    }
    return [uint16]$crc
}
function New-SupervisedPacket([byte]$Op,[uint16]$Seq,[uint16]$Session) {
    $b=[byte[]]::new(16);$b[0]=229;$b[1]=84;$b[2]=1;$b[3]=$Op
    $b[4]=[byte]($Seq -band 255);$b[5]=[byte]($Seq -shr 8)
    $b[12]=[byte]($Session -band 255);$b[13]=[byte]($Session -shr 8)
    $crc=Get-SupervisedCrc $b 14;$b[14]=[byte]($crc -band 255);$b[15]=[byte]($crc -shr 8)
    return ,$b
}
function Get-SupervisedDecoded([byte[]]$Bytes,[int]$Offset=0) {
    if($Offset -lt 0 -or $Bytes.Length-$Offset -lt 432){return $null}
    if($Bytes[$Offset+428] -ne 0 -or $Bytes[$Offset+429] -ne 0 -or $Bytes[$Offset+430] -ne 128 -or $Bytes[$Offset+431] -ne 127){return $null}
    $v=[double[]]::new(107)
    for($i=0;$i -lt 107;$i++) {
        $n=[System.BitConverter]::ToSingle($Bytes,$Offset+4*$i)
        if([single]::IsNaN($n) -or [single]::IsInfinity($n)){return $null}
        $v[$i]=$n
    }
    # Do not filter faults: a coherent fault is logged and causes a stop.
    if($v[2] -notin 0,1,2,3,4,5,6,9 -or $v[1] -lt 1 -or $v[1] -ne [math]::Floor($v[1]) -or $v[0] -le 0){return $null}
    if($v[21] -notin 10,11,12 -or $v[87] -ne 6 -or $v[63] -le 0 -or $v[63] -ne [math]::Floor($v[63])){return $null}
    if($v[63] -eq $ExpectedBuild -and ($v[21] -ne $ExpectedMethod -or ($v[2] -ne 6 -and -not ($v[2] -eq 9 -and $v[88] -eq 4444) -and $v[93] -ne 4500))){return $null}
    return ,$v
}
function Test-SupervisedIdle([double[]]$v,[switch]$RequireMotorFeedback) {
    if($v[63] -ne $ExpectedBuild -or $v[93] -ne 4500 -or $v[92] -ne 1 -or $v[21] -ne $ExpectedMethod -or $v[87] -ne 6){throw 'Wrong firmware/schema/motion permission; no ARM'}
    if($v[2] -ne 0 -or $v[22] -ne 0 -or $v[106] -ne 0 -or $v[13] -ne 0 -or $v[14] -ne 0){throw 'Not healthy zero-command idle; no ARM'}
    if($v[96] -lt 1 -or $v[96] -gt 65535 -or $v[96] -ne [math]::Floor($v[96])){throw 'Invalid session; no ARM'}
    if($v[98] -ne 1 -or $v[99] -ne 1 -or $v[35] -ne 4 -or $v[36] -ne 4 -or $v[46] -ne 0){throw 'Not fresh default ordinary BLNN Q0; no tuning or automatic reset'}
    if($RequireMotorFeedback -and ($v[0] -lt 8 -or $v[47] -lt 0 -or $v[48] -lt 0 -or $v[47] -gt 50 -or $v[48] -gt 50 -or $v[29] -ge 60 -or $v[30] -ge 60 -or [math]::Abs($v[80]) -gt 5 -or [math]::Abs($v[81]) -gt 5 -or $v[73] -ne 1 -or $v[27] -lt 23 -or $v[27] -gt 30)){throw 'Feedback/power/stationarity preflight failed; no ARM'}
}
function Test-SupervisedCaptureFrame([double[]]$v) {
    if($v[63] -ne $ExpectedBuild -or $v[21] -ne $ExpectedMethod -or $v[87] -ne 6){throw 'Firmware identity changed; do not continue'}
    $blobFrame=($v[2] -in 6,9) -and $v[88] -eq 4444
    if(-not $blobFrame -and ($v[93] -ne 4500 -or $v[92] -ne 1)){throw 'Live telemetry schema changed'}
    if($v[2] -eq 6 -and -not $blobFrame -and $v[88] -ne 0){throw 'Unexpected post-stop transition identity'}
    if($v[2] -eq 0 -and ($v[96] -ne $script:session -or $v[98] -ne 1 -or $v[99] -ne 1)){throw 'Board session/default parameters changed'}
    if($v[2] -eq 6 -and $v[22] -ne 0){throw 'Fault cannot be labeled phase6 success'}
    if($v[2] -eq 9 -and $v[22] -eq 0){throw 'Fault phase missing fault bits'}
    if($blobFrame) {
        if($v[89] -notin 2,3,4,5 -or $v[92] -ne 70944){throw 'Unexpected post-stop identification identity'}
        if($v[90] -lt 0 -or $v[90] -ge 739 -or $v[90] -ne [math]::Floor($v[90])){throw 'Replay chunk index out of range'}
        if($v[89] -in 3,4) {
            foreach($replayIndex in 91,93,3,4,5,6,7,8,9,10,11,12,15,16,17,18,23,24,25,26,29,30,31,32,33,34,35,36,37,38,39,40,49,50,51,52,104,105,55,56,61,62,64,65,66,67,68,74,75,76) {
                $value=$v[$replayIndex]
                $word=if($value -lt 262144){($value-65536)/2}else{32768+($value-262144)/8}
                if($word -lt 0 -or $word -gt 65535 -or $word -ne [math]::Floor($word)){throw 'Corrupted split-range packed word'}
                $encoded=if($word -lt 32768){65536+2*$word}else{262144+8*($word-32768)}
                if($encoded -ne $value){throw 'Noncanonical packed word'}
            }
        }
    }
    if([math]::Abs($v[13]) -gt 1200 -or [math]::Abs($v[14]) -gt 1200){throw 'Attempted command exceeds unchanged hard limits'}
    if($v[2] -in 0,6,9 -and ($v[106] -ne 0 -or $v[13] -ne 0 -or $v[14] -ne 0)){throw 'Nonzero command after idle/done/fault'}
}
function Read-SupervisedFrame([int]$TimeoutMs=150) {
    $wait=[System.Diagnostics.Stopwatch]::StartNew()
    while($wait.ElapsedMilliseconds -lt $TimeoutMs) {
        if($script:rx.Count -ge 432) {
            $all=$script:rx.ToArray()
            for($i=0;$i -le $all.Length-432;$i++) {
                if($all[$i+428] -ne 0 -or $all[$i+429] -ne 0 -or $all[$i+430] -ne 128 -or $all[$i+431] -ne 127){continue}
                $v=Get-SupervisedDecoded $all $i
                if($null -eq $v){continue}
                $script:rx.RemoveRange(0,$i+432)
                if($null -ne $script:writer){$script:writer.WriteLine(($v | ForEach-Object {$_.ToString('R',[System.Globalization.CultureInfo]::InvariantCulture)}) -join ',')}
                if($v[63] -ne $ExpectedBuild){throw ('Expected'+$ExpectedBuild+' but received'+$v[63]+'; no normal command allowed')}
                if($null -ne $script:lastFrame) {
                    if($v[1] -le $script:lastFrame[1] -or $v[0] -le $script:lastFrame[0]){throw 'MCU reset/duplicate/mixed history detected'}
                    $script:missingFrames += [int]($v[1]-$script:lastFrame[1]-1)
                }
                $script:lastFrame=$v;$script:frameCount++;$script:lastReceipt=$script:clock.ElapsedMilliseconds
                return ,$v
            }
            if($script:rx.Count -gt 8192){throw 'Telemetry framing lost or processing backlog; no automatic retry'}
        }
        try {
            $count=$script:serial.Read($script:readBuffer,0,$script:readBuffer.Length)
            for($i=0;$i -lt $count;$i++){$script:rx.Add($script:readBuffer[$i])}
        } catch [System.TimeoutException] { }
    }
    return $null
}
function Write-SupervisedCommand([byte]$Op) {
    if($script:sequence -ge 65535){throw 'Sequence exhausted; never wrap'}
    $script:sequence++
    $packet=New-SupervisedPacket $Op ([uint16]$script:sequence) ([uint16]$script:session)
    $script:serial.Write($packet,0,16)
    return $script:sequence
}
function Send-SupervisedCommand([byte]$Op) {
    # An uncertain/partial ARM write must also enter the stop-on-error path.
    if($Op -eq 3){$script:armSent=$true}
    $seq=Write-SupervisedCommand $Op
    $deadline=$script:clock.ElapsedMilliseconds+500
    while($script:clock.ElapsedMilliseconds -lt $deadline) {
        $v=Read-SupervisedFrame 75
        if($null -eq $v){continue}
        if($v[22] -ne 0){throw ('Board fault during operation'+$Op+':'+$v[22])}
        if($v[104] -eq $seq) {
            $script:acks.Add([pscustomobject]@{op=$Op;seq=$seq;status=$v[105];boardTime=$v[0]})
            if($v[105] -ne 1){throw ('Operation'+$Op+' rejected, status='+$v[105]+'; no resend')}
            return ,$v
        }
    }
    throw ('Operation'+$Op+' ACK unknown; no resend')
}
function Write-SupervisedEmergencyStop {
    # Valid STOP is accepted even if the board rebooted/session is unknown.
    $packet=New-SupervisedPacket 4 0 0
    $script:serial.Write($packet,0,16)
}
if($LibraryOnly){return}
if($Mode -eq 'Run' -and (-not $ConfirmedSiteReady -or -not $OutputPath)){throw 'Run requires explicit on-site confirmation and a new output file'}
if($Mode -eq 'Run' -and [System.IO.File]::Exists($OutputPath+'.stop')){throw 'Stop signal already present; no ARM'}
$script:serial=[System.IO.Ports.SerialPort]::new($Port,115200,[System.IO.Ports.Parity]::None,8,[System.IO.Ports.StopBits]::One)
$script:serial.Handshake=[System.IO.Ports.Handshake]::None
$script:serial.DtrEnable=$false;$script:serial.RtsEnable=$false;$script:serial.ReadTimeout=25;$script:serial.WriteTimeout=100
$script:rx=[System.Collections.Generic.List[byte]]::new();$script:readBuffer=[byte[]]::new(4096)
$script:writer=$null;$script:lastFrame=$null;$script:armSent=$false;$script:sequence=0;$script:session=0
$script:frameCount=0;$script:missingFrames=0;$script:lastReceipt=0
$script:clock=[System.Diagnostics.Stopwatch]::StartNew();$script:acks=[System.Collections.Generic.List[object]]::new()
$lastFlush=0;$failure=$null;$success=$false;$faultObserved=0;$completedReplay=$false;$stopSent=$false;$faultExportSeen=$false
try {
    if($OutputPath) {
        $resolved=[System.IO.Path]::GetFullPath($OutputPath)
        if(-not [System.IO.Directory]::Exists([System.IO.Path]::GetDirectoryName($resolved))){throw 'Output parent missing'}
        $stream=[System.IO.File]::Open($resolved,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write,[System.IO.FileShare]::Read)
        $script:writer=[System.IO.StreamWriter]::new($stream,[System.Text.UTF8Encoding]::new($false))
        $script:writer.WriteLine(((0..106 | ForEach-Object {'I'+$_}) -join ','))
    }
    $script:serial.Open()
    # Clear only stale transport at initial idle connection, never during Run.
    $script:serial.DiscardInBuffer()
    for($warm=0;$warm -lt 3;$warm++) {
        $v=Read-SupervisedFrame 1500
        if($null -eq $v){throw 'No coherent startup telemetry'}
    }
    $script:sequence=[int]$v[104]
    if($Mode -eq 'Stop') {
        Write-SupervisedEmergencyStop;$stopSent=$true
    } elseif($Mode -eq 'FaultStatus') {
        Test-SupervisedCaptureFrame $v
        if($v[2] -ne 9 -or $v[22] -eq 0){throw 'Expected latched fault state; no command sent'}
        $faultObserved=[int]$v[22]
    } else {
        Test-SupervisedIdle $v
        $script:session=[int]$v[96]
    }
    if($Mode -eq 'Run') {
        $preflightEnd=$script:clock.ElapsedMilliseconds+1000
        while($script:clock.ElapsedMilliseconds -lt $preflightEnd) {
            $v=Read-SupervisedFrame 150
            if($null -eq $v){throw 'Preflight telemetry interruption'}
            Test-SupervisedIdle $v -RequireMotorFeedback
            if($v[96] -ne $script:session){throw 'Session changed during preflight'}
        }
        $v=Send-SupervisedCommand 5;Test-SupervisedIdle $v -RequireMotorFeedback
        if($v[96] -ne $script:session){throw 'Session changed before PREPARE'}
        $v=Send-SupervisedCommand 2
        if($v[100] -ne 1){throw 'PREPARE not confirmed'}
        $v=Send-SupervisedCommand 3
        $runStart=$script:clock.ElapsedMilliseconds;$nextPing=$runStart
        $lastPingSeq=0;$lastPingAt=0;$lastAckedPing=0;$doneAt=-1;$faultAt=-1;$lastProgress=-1
        while($script:clock.ElapsedMilliseconds-$runStart -lt 400000) {
            if([System.IO.File]::Exists($OutputPath+'.stop')){throw 'Operator stop signal received'}
            $nowMs=$script:clock.ElapsedMilliseconds
            if($doneAt -lt 0 -and $faultAt -lt 0 -and $nowMs -ge $nextPing) {
                if($lastPingSeq -and $lastAckedPing -ne $lastPingSeq){throw 'Heartbeat ACK not received before next heartbeat; stop'}
                $lastPingSeq=Write-SupervisedCommand 6;$lastPingAt=$nowMs;$nextPing=$nowMs+200
            }
            $v=Read-SupervisedFrame 75
            if($null -eq $v) {
                if($script:clock.ElapsedMilliseconds-$script:lastReceipt -gt 500){throw 'Live telemetry missing >500ms; stop'}
                continue
            }
            Test-SupervisedCaptureFrame $v
            if($lastPingSeq -and $v[104] -eq $lastPingSeq) {
                if($v[105] -ne 1){throw ('Heartbeat rejected, status='+$v[105])}
                $lastAckedPing=$lastPingSeq
            }
            if($v[22] -ne 0 -or $v[2] -eq 9) {
                if($faultAt -lt 0){$faultAt=$script:clock.ElapsedMilliseconds;$faultObserved=[int]$v[22];Write-Host ('FAULT '+$faultObserved+'; preserving post-fault data, no restart')}
                $nextPing=[long]::MaxValue
                if($v[88] -eq 4444) {
                    $faultExportSeen=$true
                    if($v[89] -eq 4 -and $v[90] -eq 0) {
                        if($doneAt -lt 0){$doneAt=$script:clock.ElapsedMilliseconds;$completedReplay=$true}
                        if($script:clock.ElapsedMilliseconds-$doneAt -ge 20000 -and $v[0] -ge 185){break}
                    }
                } elseif(-not $faultExportSeen -and $script:clock.ElapsedMilliseconds-$faultAt -ge 7000){break}
            } elseif($v[2] -eq 6) {
                if($v[88] -eq 4444 -and $v[89] -eq 4 -and $v[90] -eq 0) {
                    if($doneAt -lt 0){$doneAt=$script:clock.ElapsedMilliseconds;$completedReplay=$true}
                    if($script:clock.ElapsedMilliseconds-$doneAt -ge 20000 -and $v[0] -ge 185){$success=$true;break}
                }
                # Motion is complete: no more heartbeats, keep full replay.
                $nextPing=[long]::MaxValue
            }
            if($script:clock.ElapsedMilliseconds-$lastFlush -ge 1000 -and $null -ne $script:writer){$script:writer.Flush();$lastFlush=$script:clock.ElapsedMilliseconds}
            $progress=[int][math]::Floor(($script:clock.ElapsedMilliseconds-$runStart)/10000)
            if($progress -ne $lastProgress){Write-Host ('phase='+$v[2]+' fault='+$v[22]+' elapsed='+[math]::Round($v[79],2)+'s voltage='+[math]::Round($v[27],2)+' replay='+$v[89]);$lastProgress=$progress}
        }
        if(-not $success -and $faultObserved -eq 0){throw 'Motion/identification export did not finish within400s; partial record retained'}
    } else {
        $captureEnd=$script:clock.ElapsedMilliseconds+$Duration*1000
        while($script:clock.ElapsedMilliseconds -lt $captureEnd) {
            $v=Read-SupervisedFrame 150
            if($null -eq $v){throw 'Telemetry capture interruption'}
            if($Mode -eq 'FaultStatus') {
                Test-SupervisedCaptureFrame $v
                if($v[2] -ne 9 -or $v[22] -eq 0){throw 'Latched fault state changed during read-only check'}
                $faultObserved=[int]$v[22]
            } elseif($Mode -ne 'Stop'){Test-SupervisedIdle $v}
        }
        $success=$Mode -ne 'Stop'
    }
} catch {
    $failure=$_.Exception.Message
    if($script:armSent -and $script:serial.IsOpen) {
        try {Write-SupervisedEmergencyStop;$stopSent=$true} catch {Write-Warning 'Serial STOP delivery not confirmed; MCU watchdog/on-site stop required'}
        # Do not discard/clear/reset; attempt bounded read-only fault tail.
        $tailEnd=$script:clock.ElapsedMilliseconds+5000
        while($script:clock.ElapsedMilliseconds -lt $tailEnd) {
            try {$v=Read-SupervisedFrame 150;if($null -ne $v -and $v[22] -ne 0){$faultObserved=[int]$v[22]}} catch {break}
        }
    }
} finally {
    if($null -ne $script:writer){$script:writer.Flush();$script:writer.Dispose()}
    if($script:serial.IsOpen){$script:serial.Close()};$script:serial.Dispose()
}
$last=if($null -ne $script:lastFrame){[pscustomobject]@{build=$script:lastFrame[63];phase=$script:lastFrame[2];fault=$script:lastFrame[22];drive=$script:lastFrame[106];commandL=$script:lastFrame[13];commandR=$script:lastFrame[14];voltage=$script:lastFrame[27];CANageL=$script:lastFrame[47];CANageR=$script:lastFrame[48];corePeak_us=$script:lastFrame[42];bodyPeak_us=$script:lastFrame[60];overruns=$script:lastFrame[57]}}else{$null}
$result=[pscustomobject]@{mode=$Mode;port=$Port;expectedBuild=$ExpectedBuild;frames=$script:frameCount;missingFrames=$script:missingFrames;armSent=$script:armSent;stopSent=$stopSent;success=$success;faultObserved=$faultObserved;completedReplay=$completedReplay;snapshotAfterFault=$faultExportSeen;error=$failure;acks=$script:acks.ToArray();last=$last;output=$OutputPath}
$result | ConvertTo-Json -Depth 5
if($failure -or ($Mode -eq 'Run' -and -not $success)){exit 1}
