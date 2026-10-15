param(
    [ValidateSet('Status','Check','Set','Prepare','Capture','Stop')][string]$Mode='Status',
    [string]$Port='COM4',
    [ValidateSet('nn_scale','learning_scale')][string]$Parameter='nn_scale',
    [single]$Value=1,
    [ValidateRange(1,130)][int]$Duration=5,
    [string]$OutputPath='',
    [switch]$LibraryOnly
)
$ErrorActionPreference='Stop'
# No RUN/RESET/flash mode exists in this communication-qualification client.
# All hardware writes require build66812,phase0,motionEnabled0,valid session.
# STOP is deliberately fault-latched; it is not a normal trial-complete command.
function Get-OnlineCrc([byte[]]$Bytes,[int]$Count) {
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
function New-OnlinePacket([byte]$Op,[uint16]$Seq,[byte]$Param,[single]$Number,[uint16]$Session) {
    $b=[byte[]]::new(16);$b[0]=229;$b[1]=84;$b[2]=1;$b[3]=$Op
    $b[4]=[byte]($Seq -band 255);$b[5]=[byte]($Seq -shr 8);$b[6]=$Param
    [System.BitConverter]::GetBytes($Number).CopyTo($b,8)
    $b[12]=[byte]($Session -band 255);$b[13]=[byte]($Session -shr 8)
    $crc=Get-OnlineCrc $b 14;$b[14]=[byte]($crc -band 255);$b[15]=[byte]($crc -shr 8)
    return ,$b
}
function Get-OnlineDecoded([byte[]]$Bytes,[int]$Offset=0) {
    if($Bytes.Length-$Offset -lt 432){return $null}
    if($Bytes[$Offset+428] -ne 0 -or $Bytes[$Offset+429] -ne 0 -or $Bytes[$Offset+430] -ne 128 -or $Bytes[$Offset+431] -ne 127){return $null}
    $v=[double[]]::new(107)
    for($i=0;$i -lt 107;$i++) {
        $n=[System.BitConverter]::ToSingle($Bytes,$Offset+4*$i)
        if([single]::IsNaN($n) -or [single]::IsInfinity($n)){return $null}
        $v[$i]=$n
    }
    if($v[2] -notin 0,1,2,3,4,5,6,9 -or $v[63] -le 0 -or $v[1] -ne [math]::Floor($v[1])){return $null}
    # Strong framing: reject startup/unaligned transport bytes, not a real
    # fault in an otherwise coherent frame. Never filter on fault=0 here.
    if($v[21] -notin 10,11,12 -or $v[87] -ne 6 -or $v[0] -le 0 -or $v[1] -lt 1){return $null}
    if($v[63] -eq 66812 -and ($v[21] -ne 12 -or $v[93] -ne 4477)){return $null}
    return ,$v
}
function Read-OnlineFrame([int]$TimeoutMs=2000) {
    $watch=[System.Diagnostics.Stopwatch]::StartNew()
    while($watch.ElapsedMilliseconds -lt $TimeoutMs) {
        if($script:rx.Count -ge 432) {
            $all=$script:rx.ToArray()
            for($i=0;$i -le $all.Length-432;$i++) {
                if($all[$i+428] -ne 0 -or $all[$i+429] -ne 0 -or $all[$i+430] -ne 128 -or $all[$i+431] -ne 127){continue}
                $v=Get-OnlineDecoded $all $i
                if($null -eq $v){continue}
                $script:rx.RemoveRange(0,$i+432)
                if($v[63] -ne 66812){throw ('Wrong firmware: I63='+$v[63]+',expected66812; NO command sent')}
                if($v[2] -eq 0 -and ($v[93] -ne 4477 -or $v[92] -ne 0)){throw 'Unexpected schema/motion-enabled firmware; refusing commands'}
                if($null -ne $script:writer) {
                    $script:writer.WriteLine(($v | ForEach-Object { $_.ToString('R',[System.Globalization.CultureInfo]::InvariantCulture) }) -join ',')
                }
                return ,$v
            }
            if($script:rx.Count -gt 16384){throw 'Telemetry framing lost; stopped read-only capture'}
        }
        try {
            $count=$script:serial.Read($script:readBuffer,0,$script:readBuffer.Length)
            for($i=0;$i -lt $count;$i++){$script:rx.Add($script:readBuffer[$i])}
        } catch [System.TimeoutException] { }
    }
    throw 'No valid telemetry within timeout; connection not established'
}
function Send-OnlineCommand([byte]$Op,[byte]$Param=0,[single]$Number=0,[int]$Expected=1) {
    # Drain existing buffered bytes/telemetry WITHOUT resetting the MCU.
    $script:rx.Clear();$script:serial.DiscardInBuffer()
    $v=Read-OnlineFrame
    if($Op -ne 4 -and ($v[2] -ne 0 -or $v[22] -ne 0 -or $v[106] -ne 0 -or $v[92] -ne 0)){throw 'Command allowed only in healthy no-drive idle qualification'}
    if($Op -ne 4 -and ($v[96] -lt 1 -or $v[96] -gt 65535)){throw 'No valid board session; no command sent'}
    if($script:sequence -lt $v[104]){$script:sequence=[int]$v[104]}
    if($script:sequence -ge 65535){throw 'Sequence exhausted; do not wrap or retry automatically'}
    $script:sequence++
    $token=if($Op -eq 4){[uint16]0}else{[uint16]$v[96]}
    $packet=New-OnlinePacket $Op ([uint16]$script:sequence) $Param $Number $token
    $script:serial.Write($packet,0,16)
    $watch=[System.Diagnostics.Stopwatch]::StartNew()
    while($watch.ElapsedMilliseconds -lt 2000) {
        $v=Read-OnlineFrame 1000
        if($v[104] -eq $script:sequence) {
            if($v[105] -ne $Expected){throw ('Board rejected operation'+$Op+':status='+$v[105]+' expected='+$Expected+'; no retry')}
            $script:acks.Add([pscustomobject]@{op=$Op;seq=$script:sequence;status=$v[105];revision=$v[97];nn_scale=$v[98];learning_scale=$v[99];fault=$v[22]})
            return ,$v
        }
    }
    throw 'ACK timeout; result unknown, no automatic resend or motion'
}
if($LibraryOnly){return}
$script:serial=[System.IO.Ports.SerialPort]::new($Port,115200,[System.IO.Ports.Parity]::None,8,[System.IO.Ports.StopBits]::One)
$script:serial.Handshake=[System.IO.Ports.Handshake]::None
$script:serial.DtrEnable=$false;$script:serial.RtsEnable=$false;$script:serial.ReadTimeout=50;$script:serial.WriteTimeout=500
$script:rx=[System.Collections.Generic.List[byte]]::new()
$script:readBuffer=[byte[]]::new(4096);$script:sequence=0;$script:writer=$null
$script:acks=[System.Collections.Generic.List[object]]::new()
try {
    if($OutputPath) {
        $resolved=[System.IO.Path]::GetFullPath($OutputPath)
        if(-not [System.IO.Directory]::Exists([System.IO.Path]::GetDirectoryName($resolved))){throw 'Output parent directory does not exist'}
        $stream=[System.IO.File]::Open($resolved,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write,[System.IO.FileShare]::Read)
        $script:writer=[System.IO.StreamWriter]::new($stream,[System.Text.UTF8Encoding]::new($false))
        $script:writer.WriteLine(((0..106 | ForEach-Object {'I'+$_}) -join ','))
    }
    $script:serial.Open();$v=Read-OnlineFrame
    if($Mode -eq 'Set') {
        $id=if($Parameter -eq 'nn_scale'){1}else{2}
        if([single]::IsNaN($Value) -or [single]::IsInfinity($Value) -or $Value -lt .5 -or ($id -eq 1 -and $Value -gt 1.25) -or ($id -eq 2 -and $Value -gt 1)){throw 'Parameter outside allowed range; no command sent'}
        $v=Send-OnlineCommand 1 $id $Value
    } elseif($Mode -eq 'Prepare') {$v=Send-OnlineCommand 2}
    elseif($Mode -eq 'Stop') {$v=Send-OnlineCommand 4}
    elseif($Mode -eq 'Check') {
        if($v[2] -ne 0 -or $v[22] -ne 0 -or $v[92] -ne 0 -or $v[106] -ne 0){throw 'Check requires new no-drive firmware,healthy idle'}
        $originalNN=[single]$v[98];$originalLearning=[single]$v[99]
        if($originalNN -ne 1 -or $originalLearning -ne 1){throw 'Qualification begins at defaults1/1; refusing an unknown parameter state'}
        $v=Send-OnlineCommand 5
        $v=Send-OnlineCommand 1 1 .75
        if([math]::Abs($v[98]-.75) -gt 1e-6){throw 'NN echo mismatch'}
        $revision=$v[97];$v=Send-OnlineCommand 1 1 2 3
        if($v[97] -ne $revision -or [math]::Abs($v[98]-.75) -gt 1e-6){throw 'Rejected SET modified parameters'}
        $v=Send-OnlineCommand 1 2 .75
        $v=Send-OnlineCommand 1 1 1
        $v=Send-OnlineCommand 1 2 1
        if($v[98] -ne 1 -or $v[99] -ne 1){throw 'Defaults were not restored'}
        # ONLY build66812 with motionEnabled0 reaches this intentional ARM rejection.
        $v=Send-OnlineCommand 3 0 0 8
    }
    $watch=[System.Diagnostics.Stopwatch]::StartNew();$frames=0
    while($watch.ElapsedMilliseconds -lt $Duration*1000) {
        $v=Read-OnlineFrame;$frames++
        if($Mode -ne 'Stop' -and ($v[22] -ne 0 -or $v[106] -ne 0 -or $v[13] -ne 0 -or $v[14] -ne 0)){throw 'No-drive qualification health/zero-command check failed; stop safely'}
    }
    [pscustomobject]@{port=$Port;mode=$Mode;build=$v[63];phase=$v[2];fault=$v[22];drive=$v[106];commandL=$v[13];commandR=$v[14];voltage=$v[27];frames=$frames;acks=$script:acks.ToArray();output=$OutputPath} | ConvertTo-Json -Depth 6
} finally {
    if($null -ne $script:writer){$script:writer.Flush();$script:writer.Dispose()}
    if($script:serial.IsOpen){$script:serial.Close()};$script:serial.Dispose()
}
