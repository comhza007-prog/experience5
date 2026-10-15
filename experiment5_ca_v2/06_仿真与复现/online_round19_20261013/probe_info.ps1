$ErrorActionPreference='Stop'
# PROBE INFORMATION ONLY. The sole USB command is DAP_Info(0x00).
# No DAP_Connect/SWJ/SWD/reset/flash or target-register access exists here.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class DapInfoOnly {
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
 public static Dictionary<string,object> Read() {
  Dictionary<string,object> result=new Dictionary<string,object>();
  result["targetAccess"]=false;result["resetCommands"]=0;result["flashCommands"]=0;
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
}
'@
[DapInfoOnly]::Read() | ConvertTo-Json -Depth 5
