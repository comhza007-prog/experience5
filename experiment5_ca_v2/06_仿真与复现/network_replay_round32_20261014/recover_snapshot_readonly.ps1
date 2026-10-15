param([switch]$ConfirmedDrivePowerOff,[switch]$LibraryOnly)
$ErrorActionPreference='Stop'
if(-not $LibraryOnly -and -not $ConfirmedDrivePowerOff){throw 'Requires current drive-off confirmation; no RAM recovery.'}
$e5RecoveryBase='C:/Users/ele/Desktop/lunwen/起重机/output/experiment5_ca_v2'
$e5RecoveryHex="$e5RecoveryBase/05_实验代码/自动监视_网络回放_20261014/eassy_E5REPLAY_A_S3R2_HW6/MDK-ARM/exp5REPLAY_A_S3R2_HW6/exp5REPLAY_A_S3R2_HW6.hex"
$e5RecoveryOutput="$e5RecoveryBase/01_原始数据/自动监视_网络回放_20261014/E5REPLAY_A_S3R2_B67612_HW6_STATE360_L1200_R1200_M0g_S2mm_run01_ram.bin"
if(-not $LibraryOnly){
 if((Get-FileHash -LiteralPath $e5RecoveryHex -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'bbebd960d74c7aeb2bc5c5de417bc5656808402f66370a4a76c0d495adc618e4'){throw 'Known firmware hash changed; no RAM read'}
 if((Get-Content -LiteralPath "$PSScriptRoot/flash_attempt02.log" -Raw) -notmatch 'Verify OK'){throw 'No verified flash log; no RAM read'}
 if(Test-Path -LiteralPath $e5RecoveryOutput){throw 'Preserve existing recovery; no repeated read'}
}
# Exact static replay_trace range from this verified67612 MAP only.
# Identity + RAM READS; NEVER CPU halt/reset, target-memory/control-register write,
# Flash erase/programming, CAN/UART command, fault clear or automatic retry.
# Preserve/restore DP power requests and AP CSW configuration; debug protocol
# SWJ reset is not a CPU reset. Two full copies must match before saving a blob.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class DapSnapshotReadOnly {
 static uint lastTar;
 [StructLayout(LayoutKind.Sequential)] struct InterfaceData {public int Size;public Guid Class;public uint Flags;public IntPtr Reserved;}
 [StructLayout(LayoutKind.Sequential,Pack=1)] struct Descriptor {public byte Length,Type,Number,Alternate,Endpoints,Class,SubClass,Protocol,StringIndex;}
 [StructLayout(LayoutKind.Sequential)] struct Pipe {public int Type;public byte Id;public ushort Maximum;public byte Interval;}
 [DllImport("setupapi.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr SetupDiGetClassDevs(ref Guid g,IntPtr e,IntPtr w,uint f);
 [DllImport("setupapi.dll",SetLastError=true)] static extern bool SetupDiEnumDeviceInterfaces(IntPtr set,IntPtr data,ref Guid g,uint index,ref InterfaceData info);
 [DllImport("setupapi.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set,ref InterfaceData info,IntPtr detail,uint size,out uint required,IntPtr data);
 [DllImport("setupapi.dll",SetLastError=true)] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr sa,uint creation,uint flags,IntPtr template);
 [DllImport("winusb.dll",SetLastError=true)] static extern bool WinUsb_Initialize(SafeFileHandle file,out IntPtr handle);
 [DllImport("winusb.dll",SetLastError=true)] static extern bool WinUsb_Free(IntPtr handle);
 [DllImport("winusb.dll",SetLastError=true)] static extern bool WinUsb_QueryInterfaceSettings(IntPtr handle,byte alternate,out Descriptor d);
 [DllImport("winusb.dll",SetLastError=true)] static extern bool WinUsb_QueryPipe(IntPtr handle,byte alternate,byte index,out Pipe p);
 [DllImport("winusb.dll",SetLastError=true)] static extern bool WinUsb_SetPipePolicy(IntPtr handle,byte pipe,uint policy,uint length,ref uint value);
 [DllImport("winusb.dll",SetLastError=true)] static extern bool WinUsb_WritePipe(IntPtr handle,byte pipe,byte[] bytes,uint length,out uint transferred,IntPtr overlapped);
 [DllImport("winusb.dll",SetLastError=true)] static extern bool WinUsb_ReadPipe(IntPtr handle,byte pipe,byte[] bytes,uint length,out uint transferred,IntPtr overlapped);
 static void Need(bool ok,string op){if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error(),op);}
 static string FindPath() {
  Guid g=new Guid("CDB3B5AD-293B-4663-AA36-1AAE46463776");IntPtr set=SetupDiGetClassDevs(ref g,IntPtr.Zero,IntPtr.Zero,18);
  if(set==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error());
  List<string> paths=new List<string>();
  try {
   for(uint i=0;i<32;i++) {
    InterfaceData info=new InterfaceData();info.Size=Marshal.SizeOf(typeof(InterfaceData));
    if(!SetupDiEnumDeviceInterfaces(set,IntPtr.Zero,ref g,i,ref info)){if(Marshal.GetLastWin32Error()==259)break;Need(false,"Enum");}
    uint size;SetupDiGetDeviceInterfaceDetail(set,ref info,IntPtr.Zero,0,out size,IntPtr.Zero);
    if(size<8||size>65536)throw new Exception("Unexpected interface size");
    IntPtr detail=Marshal.AllocHGlobal((int)size);
    try {
     Marshal.WriteInt32(detail,IntPtr.Size==8?8:6);
     Need(SetupDiGetDeviceInterfaceDetail(set,ref info,detail,size,out size,IntPtr.Zero),"Detail");
     string path=Marshal.PtrToStringUni(IntPtr.Add(detail,4));
     if(path!=null&&path.IndexOf("vid_faed&pid_4870&mi_00",StringComparison.OrdinalIgnoreCase)>=0)paths.Add(path);
    } finally {Marshal.FreeHGlobal(detail);}
   }
  } finally {SetupDiDestroyDeviceInfoList(set);}
  if(paths.Count!=1)throw new Exception("Expected exactly one Horco DAP interface,found"+paths.Count);
  return paths[0];
 }
 static byte[] Command(IntPtr usb,byte input,byte output,byte[] req) {
  // Deliberately limited command set. Transfer may ONLY read DP address0.
  if(req[0]!=2&&req[0]!=3&&req[0]!=0x11&&req[0]!=0x12&&req[0]!=5)throw new Exception("Command outside diagnostic whitelist");
  if(req[0]==5) {
   if(req.Length<4||req[1]!=0||req[2]!=1)throw new Exception("Single transfer only");
   byte r=req[3];
   if((r&2)!=0) {
    if(req.Length!=4||(r!=2&&r!=6&&r!=14&&r!=3&&r!=11&&r!=15))throw new Exception("Read outside whitelist");
   } else {
    if(req.Length!=8||(r!=8&&r!=1&&r!=5&&r!=4))throw new Exception("Write outside debug-configuration whitelist; CPU/memory writes forbidden");
    if(r==5)lastTar=BitConverter.ToUInt32(req,4);
    if(r==8&&BitConverter.ToUInt32(req,4)!=0&&BitConverter.ToUInt32(req,4)!=0xF0)throw new Exception("SELECT outside AP0 diagnostic banks");
    if(r==4&&(BitConverter.ToUInt32(req,4)&~0x50000000U)!=0)throw new Exception("Only debug power-request bits may be written");
   }
  }
  byte[] b=new byte[1024];uint n;
  Need(WinUsb_WritePipe(usb,output,req,(uint)req.Length,out n,IntPtr.Zero),"Diagnostic write");
  if(n!=req.Length)throw new Exception("Short diagnostic write");
  Need(WinUsb_ReadPipe(usb,input,b,1024,out n,IntPtr.Zero),"Diagnostic read");
  if(n<2||b[0]!=req[0])throw new Exception("Malformed diagnostic reply");
  byte[] reply=new byte[n];Array.Copy(b,reply,n);return reply;
 }
 static uint Transfer(IntPtr usb,byte input,byte output,byte request,uint value) {
  byte[] p=new byte[(request&2)!=0?4:8];p[0]=5;p[1]=0;p[2]=1;p[3]=request;
  if(p.Length==8)BitConverter.GetBytes(value).CopyTo(p,4);
  byte[] r=Command(usb,input,output,p);
  if(r.Length<3||r[1]!=1||r[2]!=1)throw new Exception("DAP transfer failed:"+BitConverter.ToString(r));
  if((request&2)!=0){if(r.Length<7)throw new Exception("Short read");return BitConverter.ToUInt32(r,3);}
  return 0;
 }
 static uint ReadAP(IntPtr usb,byte input,byte output,byte request) {
  Transfer(usb,input,output,request,0);return Transfer(usb,input,output,14,0);
 }
 static uint ReadIdentity(IntPtr usb,byte input,byte output,uint address,uint romBase) {
  if(!((address>=0x2000bb54U&&address<=0x200155e8U&&(address&3U)==0)||address==romBase+0xfe4||address==romBase+0xfe8||address==0xe0042000||address==0xe000ed00||address==0xe000edf0||address==0xe000ed08||address==0x08000000||address==0x08000004))throw new Exception("Address outside verified identity/replay snapshot range");
  Transfer(usb,input,output,5,address);return ReadAP(usb,input,output,15);
 }
 public static Dictionary<string,object> Read() {
  Dictionary<string,object> result=new Dictionary<string,object>();
  result["targetAccess"]="identity reads,debug configuration,exact completed snapshot RAM reads";result["cpuResetCommands"]=0;result["cpuHaltCommands"]=0;result["memoryWrites"]=0;result["controlRegisterWrites"]=0;result["flashCommands"]=0;
  string path=FindPath();result["path"]=path;
  using(SafeFileHandle file=CreateFile(path,0xC0000000,3,IntPtr.Zero,3,0x40000000,IntPtr.Zero)) {
   if(file.IsInvalid)throw new Win32Exception(Marshal.GetLastWin32Error(),"Open probe");
   IntPtr usb;Need(WinUsb_Initialize(file,out usb),"WinUsb Initialize");
   try {
    Descriptor desc;Need(WinUsb_QueryInterfaceSettings(usb,0,out desc),"Interface settings");
    byte input=0,output=0;List<string> pipes=new List<string>();
    for(byte i=0;i<desc.Endpoints;i++) {
     Pipe p;Need(WinUsb_QueryPipe(usb,0,i,out p),"QueryPipe");pipes.Add(p.Id.ToString("X2")+":"+p.Type+":"+p.Maximum);
     if(p.Type==2){if((p.Id&128)==0&&output==0)output=p.Id;else if((p.Id&128)!=0&&input==0)input=p.Id;}
    }
    result["pipes"]=pipes.ToArray();if(input==0||output==0)throw new Exception("Bulk endpoints missing");
    uint timeout=1000;Need(WinUsb_SetPipePolicy(usb,input,3,4,ref timeout),"Read timeout");Need(WinUsb_SetPipePolicy(usb,output,3,4,ref timeout),"Write timeout");
    byte[] connect=Command(usb,input,output,new byte[]{2,1});result["connectReply"]=BitConverter.ToString(connect);
    if(connect[1]!=1)throw new Exception("SWD connect mode failed");
    try {
     byte[] clock=Command(usb,input,output,new byte[]{0x11,0xA0,0x86,0x01,0});
     result["clockHz"]=100000;result["clockReply"]=BitConverter.ToString(clock);
     if(clock[1]!=0)throw new Exception("Probe rejected clock");
     byte[][] sequences={new byte[]{0x12,56,255,255,255,255,255,255,255},new byte[]{0x12,16,0x9e,0xe7},new byte[]{0x12,56,255,255,255,255,255,255,255},new byte[]{0x12,8,0}};
     foreach(byte[] sequence in sequences){byte[] r=Command(usb,input,output,sequence);if(r[1]!=0)throw new Exception("Probe rejected SWJ sequence");}
     byte[] transfer=Command(usb,input,output,new byte[]{5,0,1,2});
     result["DPIDRReply"]=BitConverter.ToString(transfer);result["SWDAck"]=transfer.Length>=3?(object)transfer[2]:null;
     if(transfer.Length>=7&&transfer[1]==1&&(transfer[2]&7)==1)result["DPIDR"]="0x"+BitConverter.ToUInt32(transfer,3).ToString("X8");
     else result["DPIDR"]=null;
     if(result["DPIDR"]==null)throw new Exception("No DPIDR;do not continue");
     uint status=Transfer(usb,input,output,6,0);result["DPControlStatus"]="0x"+status.ToString("X8");
     uint originalPowerRequests=status&0x50000000U;
     try {
     if((status&0xA0000000)!=0xA0000000) {
      Transfer(usb,input,output,4,0x50000000U);result["temporaryDebugPowerRequests"]=true;
      for(int attempt=0;attempt<8;attempt++){status=Transfer(usb,input,output,6,0);if((status&0xA0000000)==0xA0000000)break;System.Threading.Thread.Sleep(1);}
      result["DPControlStatusAfterRequests"]="0x"+status.ToString("X8");
      if((status&0xA0000000)!=0xA0000000)throw new Exception("Debug power ACK missing after boundedrequest;no memory read");
     }
     Transfer(usb,input,output,8,0xF0);
     uint apID=ReadAP(usb,input,output,15),romBase=ReadAP(usb,input,output,11)&~3U;
     result["AP_IDR"]="0x"+apID.ToString("X8");result["ROMBase"]="0x"+romBase.ToString("X8");
     if(romBase<0xE0000000||romBase>0xE00FF000||(romBase&0xfff)!=0)throw new Exception("Unexpected ROM base;no memory reads");
     Transfer(usb,input,output,8,0);
     uint csw=ReadAP(usb,input,output,3);result["originalAP_CSW"]="0x"+csw.ToString("X8");
     try {
      Transfer(usb,input,output,1,(csw&~0x37U)|2U);
      uint p1=ReadIdentity(usb,input,output,romBase+0xfe4,romBase),p2=ReadIdentity(usb,input,output,romBase+0xfe8,romBase);
      uint vendor=((p2&7)<<4)|((p1>>4)&15);
      result["PIDR1"]="0x"+p1.ToString("X8");result["PIDR2"]="0x"+p2.ToString("X8");
      result["JEP106_ID"]="0x"+vendor.ToString("X2");result["packSTCheckWouldPassAtObservedValues"]=vendor==0x20;
      result["DBGMCU_IDCODE"]="0x"+ReadIdentity(usb,input,output,0xe0042000,romBase).ToString("X8");
      result["CPU_ID"]="0x"+ReadIdentity(usb,input,output,0xe000ed00,romBase).ToString("X8");
      uint dhcsr=ReadIdentity(usb,input,output,0xe000edf0,romBase);
      result["DHCSR"]="0x"+dhcsr.ToString("X8");
      result["coreHalted"]=(dhcsr&0x20000U)!=0;
      result["coreLockup"]=(dhcsr&0x80000U)!=0;
      result["VTOR"]="0x"+ReadIdentity(usb,input,output,0xe000ed08,romBase).ToString("X8");
      result["flashInitialSP"]="0x"+ReadIdentity(usb,input,output,0x08000000,romBase).ToString("X8");
      result["flashResetVector"]="0x"+ReadIdentity(usb,input,output,0x08000004,romBase).ToString("X8");
      if((string)result["flashInitialSP"]!="0x20019628"||(string)result["flashResetVector"]!="0x080002E9"||vendor!=0x20U)throw new Exception("Unexpected target/vector; no RAM read");
      if((bool)result["coreHalted"]||(bool)result["coreLockup"])throw new Exception("Unexpected core state; no halt/resume/reset attempt");
      byte[][] copies=new byte[2][];
      for(int pass=0;pass<2;pass++){
       copies[pass]=new byte[39576];
       if(ReadIdentity(usb,input,output,0x200155ccU,romBase)!=1U)throw new Exception("Replay buffer not ready; no recovery");
       for(uint offset=0;offset<39576;offset+=4){
        uint value=ReadIdentity(usb,input,output,0x2000bb54U+offset,romBase);
        BitConverter.GetBytes(value).CopyTo(copies[pass],(int)offset);
        if(offset%4096==0)Console.WriteLine("READ_ONLY_SNAPSHOT pass="+(pass+1)+" bytes="+offset);
       }
       if(BitConverter.ToUInt32(copies[pass],0)!=1||BitConverter.ToUInt32(copies[pass],4)!=67612||BitConverter.ToUInt32(copies[pass],8)!=12||BitConverter.ToUInt32(copies[pass],12)!=5348||BitConverter.ToUInt32(copies[pass],16)!=48||BitConverter.ToUInt32(copies[pass],20)!=80||BitConverter.ToUInt32(copies[pass],24)!=360||BitConverter.ToUInt32(copies[pass],39544)!=1)throw new Exception("Unexpected completed snapshot header/ABI");
      }
      for(int i=0;i<39576;i++)if(copies[0][i]!=copies[1][i])throw new Exception("RAM copies differ; do not interpret");
      byte[] blob=new byte[39536];Array.Copy(copies[0],blob,39536);
      result["_snapshot"]=blob;result["doubleReadExact"]=true;result["snapshotRange"]="0x2000BB54..0x200155EB";result["snapshotBytes"]=39536;
     } finally {Transfer(usb,input,output,1,csw);result["AP_CSW_restored"]=true;}
     } finally {Transfer(usb,input,output,4,originalPowerRequests);result["DP_power_requests_restored"]=true;}
    } catch(Exception ex) {result["diagnosticError"]=ex.Message;
    } finally {result["disconnectReply"]=BitConverter.ToString(Command(usb,input,output,new byte[]{3}));}
    byte[] ids={1,2,3,4,0xF0,0xFE,0xFF};string[] names={"vendor","product","serial","version","capabilities","packetCount","packetSize"};
    for(int j=0;j<ids.Length;j++) {
     // Fixed whitelist: DAP_Info ONLY, never target communication.
     byte[] request={0,ids[j]},response=new byte[1024];uint n;
     Need(WinUsb_WritePipe(usb,output,request,2,out n,IntPtr.Zero),"DAP_Info write");if(n!=2)throw new Exception("Short write");
     Need(WinUsb_ReadPipe(usb,input,response,1024,out n,IntPtr.Zero),"DAP_Info read");
     if(n<2||response[0]!=0||response[1]>n-2)throw new Exception("Malformed DAP_Info response");
     if(j<4)result[names[j]]=response[1]==0?null:System.Text.Encoding.UTF8.GetString(response,2,response[1]).TrimEnd('\0');
     else {byte[] data=new byte[response[1]];Array.Copy(response,2,data,0,data.Length);result[names[j]]=BitConverter.ToString(data);}
    }
   } finally {WinUsb_Free(usb);}
  }
  return result;
 }

 public static string TestGuards(){
  byte[][] forbidden={new byte[]{5,0,1,13,4,0,250,5},new byte[]{5,0,1,13,1,0,0,0},new byte[]{10,0,1,0},new byte[]{5,0,1,8,255,255,255,255}};
  foreach(byte[] request in forbidden){
   bool caught=false;try{Command(IntPtr.Zero,0,0,request);}catch(Win32Exception){throw new Exception("Forbidden command reached hardware API");}catch(Exception){caught=true;}
   if(!caught)throw new Exception("Forbidden command accepted");
  }
  uint[] addresses={0,0x2000bb50U,0x200155ecU,0x2000bb55U,0xe000ed0cU,0xe000edf4U,0x08000008U};
  foreach(uint address in addresses){
   bool caught=false;try{ReadIdentity(IntPtr.Zero,0,0,address,0xe00ff000U);}catch(Win32Exception){throw new Exception("Out-of-range address reached hardware API");}catch(Exception){caught=true;}
   if(!caught)throw new Exception("Out-of-range address accepted");
  }
  return "PASS AP data writes/CPU reset/abort/invalid SELECT/out-of-range RAM or Flash all rejected before IO; no hardware opened";
 }

}
'@
if($LibraryOnly){[DapSnapshotReadOnly]::TestGuards();return}
$e5RecoveryResult=[DapSnapshotReadOnly]::Read()
if($e5RecoveryResult.ContainsKey('diagnosticError') -or -not $e5RecoveryResult.ContainsKey('_snapshot')){
 $e5RecoveryResult.Remove('_snapshot')|Out-Null
 $e5RecoveryResult|ConvertTo-Json -Depth 5
 throw 'Read-only recovery failed; no reset, no automatic retry'
}
[byte[]]$e5RecoveredBlob=$e5RecoveryResult['_snapshot'];$e5RecoveryResult.Remove('_snapshot')|Out-Null
$e5RecoveryStream=[System.IO.File]::Open($e5RecoveryOutput,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write,[System.IO.FileShare]::Read)
try{$e5RecoveryStream.Write($e5RecoveredBlob,0,$e5RecoveredBlob.Length)}finally{$e5RecoveryStream.Dispose()}
$e5RecoveryResult['output']=$e5RecoveryOutput
$e5RecoveryResult['sha256']=(Get-FileHash -LiteralPath $e5RecoveryOutput -Algorithm SHA256).Hash.ToLowerInvariant()
$e5RecoveryResult['origin']='Completed early learning snapshot recovered after failed512 run; physical trajectory remains FAILED'
$e5RecoveryResult|ConvertTo-Json -Depth 5
