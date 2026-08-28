import { useAuth } from "@/_core/hooks/useAuth";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList, CommandGroup } from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { processingStageLabels, type ProcessingStage } from "../../../shared/progress";
import {
  Archive,
  ArrowDownToLine,
  Bot,
  Camera,
  Film,
  Globe2,
  Braces,
  CheckCircle2,
  ChevronRight,
  FileCode2,
  FilePlus2,
  FolderGit2,
  GitBranch,
  Loader2,
  LockKeyhole,
  Menu,
  PlugZap,
  Smartphone,
  Sparkles,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  Upload,
  X,
  Zap,
  Command as CommandIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type FileEntry = { path: string; bytes: number; binary: boolean };

function prettyBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sourceLabel(sourceType: string) {
  return sourceType === "zip" ? "ZIP workspace" : `${sourceType} repository`;
}

function EmptyShell() {
  return (
    <div className="cyber-shell grid min-h-screen place-items-center p-5">
      <div className="cyber-grid pointer-events-none fixed inset-0" />
      <main className="relative z-10 mx-auto max-w-xl text-center">
        <div className="mb-7 inline-flex size-16 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 shadow-[0_0_50px_rgba(34,211,238,0.2)]">
          <Bot className="size-8 text-cyan-200" />
        </div>
        <p className="eyebrow">SILELO / REPOSITORY WORKSPACE</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">แก้โค้ดอย่างมั่นใจ<br />ก่อนส่งออกทุกครั้ง</h1>
        <p className="mx-auto mt-5 max-w-lg text-base leading-7 text-slate-300">
          นำเข้า public repository หรือ ZIP สั่งงานผ่านแชท ตรวจ diff และดาวน์โหลดโปรเจกต์ฉบับแก้ไขได้ในพื้นที่เดียว
        </p>
        <Button onClick={() => startLogin()} size="lg" className="mt-8 h-12 rounded-xl bg-cyan-300 px-6 font-semibold text-slate-950 hover:bg-cyan-200">
          <LockKeyhole className="mr-2 size-4" />
          เข้าสู่พื้นที่ทำงาน
        </Button>
        <div className="mx-auto mt-8 flex max-w-md flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-emerald-300" /> ไม่ขอ Git token</span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-emerald-300" /> ไม่ commit หรือ push</span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-emerald-300" /> ตรวจ diff ก่อนส่งออก</span>
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const utils = trpc.useUtils();
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [selectedChangeId, setSelectedChangeId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"url" | "zip">("url");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [fileFilter, setFileFilter] = useState("");
  const [mobilePanel, setMobilePanel] = useState<"projects" | "inspector" | null>(null);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [lastInstruction, setLastInstruction] = useState("");
  const [toolOpen, setToolOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [intentReview, setIntentReview] = useState<{ instruction: string; options: string[] } | null>(null);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>("idle");
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [offlineQueue, setOfflineQueue] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("silelo-offline-command-queue") || "[]") as string[]; } catch { return []; }
  });
  const stageTimers = useRef<number[]>([]);
  const processingRunId = useRef(0);

  const projectsQuery = trpc.repoBot.listProjects.useQuery(undefined, { enabled: isAuthenticated });
  const channelWorkspace = trpc.advanced.workspace.useQuery(undefined, { enabled: isAuthenticated });
  const workspaceQuery = trpc.repoBot.projectWorkspace.useQuery(
    { projectId: activeProjectId ?? 0 },
    { enabled: isAuthenticated && activeProjectId !== null },
  );
  const importUrl = trpc.repoBot.importFromUrl.useMutation({
    onSuccess: (data) => {
      setActiveProjectId(data.project.id);
      setImportOpen(false);
      setRepositoryUrl("");
      toast.success("นำเข้า repository สำเร็จแล้ว");
      void utils.repoBot.listProjects.invalidate();
      void utils.repoBot.projectWorkspace.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const importZip = trpc.repoBot.importZip.useMutation({
    onSuccess: (data) => {
      setActiveProjectId(data.project.id);
      setImportOpen(false);
      setZipFile(null);
      toast.success("นำเข้า ZIP สำเร็จแล้ว");
      void utils.repoBot.listProjects.invalidate();
      void utils.repoBot.projectWorkspace.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const proposeChange = trpc.repoBot.proposeChange.useMutation({
    onSuccess: data => {
      setSelectedChangeId(data.changeId);
      toast.success("สร้างข้อเสนอและ diff แล้ว");
      void utils.repoBot.projectWorkspace.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const generateImages = trpc.advanced.generateImages.useMutation();
  const bookmarkMessage = trpc.advanced.toggleBookmark.useMutation({ onSuccess: data => toast.success(data.bookmarked ? "บันทึก bookmark แล้ว" : "นำออกจาก bookmark แล้ว"), onError: error => toast.error(error.message) });
  const summarizeConversation = trpc.advanced.summarizeConversation.useMutation({
    onSuccess: () => { toast.success("สรุปบทสนทนาและบันทึก bookmark แล้ว"); void utils.repoBot.projectWorkspace.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const exportChange = trpc.repoBot.exportChange.useMutation({
    onSuccess: data => {
      toast.success("สร้างไฟล์ ZIP แล้ว ลิงก์อยู่ในแชท");
      void utils.repoBot.projectWorkspace.invalidate();
      void utils.repoBot.listProjects.invalidate();
      window.open(data.url, "_blank", "noopener,noreferrer");
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (!activeProjectId && projectsQuery.data?.length) setActiveProjectId(projectsQuery.data[0].id);
  }, [activeProjectId, projectsQuery.data]);

  useEffect(() => {
    localStorage.setItem("silelo-offline-command-queue", JSON.stringify(offlineQueue));
  }, [offlineQueue]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen(open => !open); } };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    const savedDraft = localStorage.getItem("silelo-repo-bot-draft");
    if (savedDraft) setChatDraft(savedDraft);
  }, []);

  useEffect(() => {
    if (chatDraft) localStorage.setItem("silelo-repo-bot-draft", chatDraft);
    else localStorage.removeItem("silelo-repo-bot-draft");
  }, [chatDraft]);

  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); stageTimers.current.forEach(window.clearTimeout); };
  }, []);

  const files = (workspaceQuery.data?.files ?? []) as FileEntry[];
  const changes = workspaceQuery.data?.changes ?? [];
  const selectedChange = changes.find(change => change.id === selectedChangeId) ?? changes[0];
  const project = workspaceQuery.data?.project;
  const artifacts = workspaceQuery.data?.artifacts ?? [];
  const chatMessages = useMemo<Message[]>(() => (workspaceQuery.data?.messages ?? []).map(message => ({
    id: message.id,
    role: message.role,
    content: message.content,
    model: message.model,
    intent: message.intent,
    createdAt: message.createdAt,
  })), [workspaceQuery.data?.messages]);
  const visibleFiles = useMemo(() => files.filter(file => file.path.toLowerCase().includes(fileFilter.toLowerCase())), [files, fileFilter]);
  const importing = importUrl.isPending || importZip.isPending;
  const stageLabels = processingStageLabels;
  const latestChannel = channelWorkspace.data?.channels?.[0];
  const channelState = channelWorkspace.isLoading ? "กำลังตรวจสอบ channel…" : latestChannel ? `${latestChannel.name}: ${latestChannel.connectionState}${latestChannel.lastLatencyMs ? ` · ${latestChannel.lastLatencyMs} ms` : ""}` : "ยังไม่มี channel";
  const summarizeActiveConversation = () => {
    if (!project) return toast.error("นำเข้าโครงการก่อนสรุปบทสนทนา");
    summarizeConversation.mutate({ projectId: project.id });
  };
  const downloadResponse = (message: Message, format: "export-md" | "export-json" | "export-txt" | "export-html") => {
    const baseName = `silelo-response-${message.id ?? Date.now()}`;
    const body = format === "export-json" ? JSON.stringify({ ...message, exportedAt: new Date().toISOString() }, null, 2) : format === "export-html" ? `<!doctype html><meta charset="utf-8"><title>SILELO response</title><article><pre>${message.content.replace(/[&<>]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char] ?? char))}</pre></article>` : format === "export-md" ? `# SILELO response\n\n${message.content}\n\n— ${message.model ?? "SILELO Core"}` : message.content;
    const extension = format === "export-json" ? "json" : format === "export-html" ? "html" : format === "export-md" ? "md" : "txt";
    const blob = new Blob([body], { type: extension === "html" ? "text/html" : extension === "json" ? "application/json" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${baseName}.${extension}`; anchor.click(); URL.revokeObjectURL(url);
    toast.success(`ส่งออก ${extension.toUpperCase()} แล้ว`);
  };
  const handleMessageAction = (action: "speak" | "export-md" | "export-json" | "export-txt" | "export-html" | "bookmark", message: Message) => {
    if (action === "speak") { if (!("speechSynthesis" in window)) return toast.error("เบราว์เซอร์นี้ไม่รองรับการอ่านออกเสียง"); window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(message.content)); return toast.success("เริ่มอ่านออกเสียงแล้ว"); }
    if (action === "bookmark") return message.id ? bookmarkMessage.mutate({ messageId: message.id }) : toast.error("ข้อความนี้ยังไม่มีรหัสสำหรับบันทึก");
    downloadResponse(message, action);
  };
  const sendInstruction = (content: string, confirmedIntent?: string) => {
    if (!project) return toast.error("นำเข้าโครงการก่อนส่งคำสั่ง");
    const instruction = content.trim();
    if (!instruction) return;
    setLastInstruction(instruction);
    if (!confirmedIntent && /\b(ทำ|สร้าง|แก้|ปรับ|ตรวจ|สรุป|เพิ่ม|ลบ|อัปโหลด)\b/i.test(instruction) && !/(โค้ด|ไฟล์|โปรเจกต์|บทสนทนา|รูปภาพ|วิดีโอ|เว็บ|แอป|repository|repo)/i.test(instruction)) {
      setIntentReview({ instruction, options: ["แก้ไขโค้ดในโปรเจกต์", "สรุปหรือวิเคราะห์ข้อมูล", "สร้างสื่อหรือไฟล์ใหม่"] });
      return;
    }
    if (!isOnline) { setOfflineQueue(queue => [...queue, instruction]); setProcessingStage("queued"); setChatDraft(""); toast.info("ออฟไลน์: เก็บคำสั่งไว้ในคิวแล้ว"); return; }
    stageTimers.current.forEach(window.clearTimeout);
    const runId = ++processingRunId.current;
    stageTimers.current = [
      window.setTimeout(() => setProcessingStage("analyzing"), 320),
      window.setTimeout(() => setProcessingStage("editing"), 720),
    ];
    setProcessingStage("thinking");
    proposeChange.mutate({ projectId: project.id, instruction, intent: confirmedIntent }, {
      onSuccess: () => { if (processingRunId.current !== runId) return; setProcessingStage("complete"); stageTimers.current.push(window.setTimeout(() => setProcessingStage("idle"), 2600)); },
      onError: () => { if (processingRunId.current !== runId) return; setProcessingStage("error"); },
    });
  };
  useEffect(() => {
    if (!isOnline && offlineQueue.length) return;
    if (isOnline && offlineQueue.length && project && !proposeChange.isPending) {
      const next = offlineQueue[0];
      setOfflineQueue(queue => queue.slice(1));
      sendInstruction(next);
    }
  }, [isOnline, offlineQueue, project?.id, proposeChange.isPending]);
  const toolItems = [
    { label: "สรุปบทสนทนา", detail: "บันทึกสรุปลง bookmark", icon: Sparkles, action: summarizeActiveConversation },
    { label: "ส่งรูปภาพ", detail: "แนบไฟล์เข้า workspace", icon: Camera, action: () => { setToolOpen(false); setImportMode("zip"); setImportOpen(true); } },
    { label: "สร้างคลิป", detail: "เตรียมงานวิดีโอ", icon: Film, action: () => { setToolOpen(false); setChatDraft("สร้างคลิปจากคำอธิบายนี้ พร้อมระบุความยาว อัตราส่วน และสไตล์: "); toast.success("เตรียมคำสั่งสร้างคลิปในช่องแชทแล้ว"); } },
    { label: "สร้างเว็บ", detail: "เริ่มโปรเจกต์เว็บ", icon: Globe2, action: () => { setToolOpen(false); setChatDraft("สร้างเว็บไซต์ responsive จากข้อกำหนดนี้ พร้อมโครงสร้างไฟล์และวิธีทดสอบ: "); toast.success("เตรียมคำสั่งสร้างเว็บในช่องแชทแล้ว"); } },
    { label: "แอปมือถือ", detail: "เริ่มโครงงาน Expo", icon: Smartphone, action: () => { setToolOpen(false); setChatDraft("สร้างแอปมือถือ Expo จากข้อกำหนดนี้ พร้อมหน้าจอและขั้นตอนทดสอบ: "); toast.success("เตรียมคำสั่งสร้างแอปมือถือในช่องแชทแล้ว"); } },
    { label: "ปลั๊กอินเชื่อมต่อ", detail: "จัดการ authorization", icon: PlugZap, action: () => { setToolOpen(false); window.location.assign("/control"); } },
    { label: "สร้างรูปภาพ 10 รูป", detail: "สร้างผลลัพธ์จริงหลายภาพ", icon: Sparkles, action: () => {
      if (!chatDraft.trim()) return toast.error("พิมพ์ prompt ในช่องแชทก่อนสั่งสร้างรูปภาพ");
      setProcessingStage("thinking");
      generateImages.mutate({ prompt: chatDraft.trim(), count: 10 }, {
        onSuccess: (data) => {
          setChatDraft("");
          setGeneratedImages(data.results.map(result => result.url));
          setProcessingStage("complete");
          toast.success(`สร้างภาพสำเร็จ ${data.results.length} ภาพ`);
          void utils.repoBot.projectWorkspace.invalidate();
          setTimeout(() => setProcessingStage("idle"), 2000);
        },
        onError: (err) => { setProcessingStage("error"); toast.error(err.message); }
      });
    } },
  ];

  if (loading) {
    return <div className="cyber-shell grid min-h-screen place-items-center"><Loader2 className="size-7 animate-spin text-cyan-200" /></div>;
  }
  if (!isAuthenticated || !user) return <EmptyShell />;

  const submitRepository = () => {
    if (!repositoryUrl.trim()) return toast.error("วางลิงก์ public repository ก่อนเริ่มนำเข้า");
    importUrl.mutate({ url: repositoryUrl.trim() });
  };

  const submitZip = async () => {
    if (!zipFile) return toast.error("เลือกไฟล์ ZIP ก่อนเริ่มนำเข้า");
    if (zipFile.size > 50 * 1024 * 1024) return toast.error("ไฟล์ ZIP ต้องมีขนาดไม่เกิน 50 MB");
    const reader = new FileReader();
    reader.onerror = () => toast.error("ไม่สามารถอ่านไฟล์ ZIP ได้");
    reader.onload = () => importZip.mutate({ filename: zipFile.name, dataUrl: String(reader.result) });
    reader.readAsDataURL(zipFile);
  };

  const projectPanel = (
    <aside className="workspace-rail flex min-h-0 flex-col">
      <div className="border-b border-white/8 px-4 pb-4 pt-5">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-lg border border-cyan-300/30 bg-cyan-300/10">
            <Zap className="size-4 text-cyan-200" />
          </div>
          <span className="font-display text-sm font-semibold tracking-[0.16em] text-white">SILELO</span>
        </div>
        <Button onClick={() => setImportOpen(true)} className="mt-5 h-10 w-full rounded-lg bg-cyan-300 text-xs font-bold text-slate-950 hover:bg-cyan-200">
          <Plus className="mr-1.5 size-4" /> นำเข้าโครงการ
        </Button>
      </div>
      <div className="flex items-center justify-between px-4 pb-2 pt-5">
        <span className="eyebrow text-[10px]">PROJECTS</span>
        <Badge variant="outline" className="border-white/10 px-1.5 text-[10px] text-slate-400">{projectsQuery.data?.length ?? 0}</Badge>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2 pb-4">
        <div className="space-y-1">
          {projectsQuery.isLoading && <ProjectListSkeleton />}
          {projectsQuery.isError && (
            <div className="mx-2 mt-2 rounded-xl border border-rose-300/15 bg-rose-300/[0.045] p-3 text-center">
              <p className="text-xs font-medium text-rose-100">โหลดรายการโครงการไม่สำเร็จ</p>
              <p className="mt-1 text-[10px] leading-4 text-rose-100/55">ตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง</p>
              <button onClick={() => projectsQuery.refetch()} className="mt-2 text-[10px] font-semibold text-rose-200 underline underline-offset-4">ลองใหม่</button>
            </div>
          )}
          {!projectsQuery.isLoading && !projectsQuery.data?.length && (
            <div className="mx-2 mt-2 rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-center text-xs leading-5 text-slate-500">
              ยังไม่มีโครงการ<br />เริ่มจากลิงก์หรือไฟล์ ZIP
            </div>
          )}
          {projectsQuery.data?.map(item => (
            <button
              key={item.id}
              onClick={() => { setActiveProjectId(item.id); setSelectedChangeId(null); setMobilePanel(null); }}
              className={cn(
                "group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all duration-200",
                activeProjectId === item.id ? "bg-cyan-300/10 text-cyan-100 shadow-[inset_1px_0_0_rgba(103,232,249,0.75)]" : "text-slate-400 hover:bg-white/[0.045] hover:text-slate-200",
              )}
            >
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg border", activeProjectId === item.id ? "border-cyan-200/30 bg-cyan-200/10" : "border-white/8 bg-white/[0.03]")}>
                <FolderGit2 className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">{item.name}</span>
                <span className="mt-0.5 block text-[10px] text-slate-500">{sourceLabel(item.sourceType)}</span>
              </span>
              <ChevronRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-70" />
            </button>
          ))}
        </div>
      </ScrollArea>
      <div className="border-t border-white/8 px-4 py-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-full bg-violet-400/15 text-[10px] font-bold text-violet-200">{user.name?.slice(0, 1).toUpperCase() || "U"}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-slate-400">{user.name || "Workspace owner"}</span>
          <button onClick={logout} className="text-[10px] text-slate-500 hover:text-slate-200">ออก</button>
        </div>
      </div>
    </aside>
  );

  const inspectorPanel = (
    <aside className="workspace-inspector flex min-h-0 flex-col border-l border-white/8">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-[18px]">
        <span className="font-display text-xs font-semibold tracking-[0.12em] text-white">INSPECTOR</span>
        {project && <Badge className="border-0 bg-emerald-300/10 text-[10px] text-emerald-200 hover:bg-emerald-300/10"><span className="mr-1 inline-block size-1.5 rounded-full bg-emerald-300" />พร้อมทำงาน</Badge>}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {workspaceQuery.isError && activeProjectId && (
          <div className="m-4 rounded-xl border border-rose-300/15 bg-rose-300/[0.045] p-4 text-center">
            <p className="text-xs font-semibold text-rose-100">ไม่สามารถโหลดข้อมูลโครงการ</p>
            <p className="mt-1 text-[11px] leading-5 text-rose-100/55">โปรดลองอีกครั้ง หรือตรวจสอบว่าโครงการยังพร้อมใช้งาน</p>
            <Button onClick={() => workspaceQuery.refetch()} variant="outline" className="mt-3 h-8 border-rose-200/15 bg-transparent text-xs text-rose-100 hover:bg-rose-300/10 hover:text-white">ลองโหลดใหม่</Button>
          </div>
        )}
        {!project && (
          <div className="grid min-h-[300px] place-items-center p-8 text-center">
            <div>
              <Archive className="mx-auto size-8 text-slate-700" />
              <p className="mt-4 text-sm font-medium text-slate-400">เลือกหรือนำเข้าโครงการ</p>
              <p className="mt-2 text-xs leading-5 text-slate-600">รายการไฟล์และ diff ที่ตรวจสอบได้จะแสดงที่นี่</p>
            </div>
          </div>
        )}
        {project && (
          <div className="space-y-6 p-4">
            <section>
              <p className="eyebrow text-[10px]">ACTIVE PROJECT</p>
              <h2 className="mt-2 truncate text-sm font-semibold text-white">{project.name}</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Metric label="ไฟล์" value={String(files.length)} />
                <Metric label="ต้นทาง" value={sourceLabel(project.sourceType).replace(" repository", "")} />
              </div>
              <div className="mt-3 rounded-lg border border-cyan-300/10 bg-cyan-300/[0.045] px-3 py-2.5 text-[11px] leading-5 text-cyan-100/70">
                <ShieldCheck className="mr-1.5 inline size-3.5 text-emerald-300" /> ไม่มีการใช้ token, commit หรือ push
              </div>
            </section>
            <section>
              <div className="flex items-center justify-between">
                <p className="eyebrow text-[10px]">FILES</p>
                <span className="text-[10px] text-slate-600">{visibleFiles.length}/{files.length}</span>
              </div>
              <div className="relative mt-3">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" />
                <Input value={fileFilter} onChange={e => setFileFilter(e.target.value)} placeholder="ค้นหาไฟล์" className="h-8 border-white/8 bg-white/[0.03] pl-8 text-xs placeholder:text-slate-600 focus-visible:ring-cyan-300/40" />
              </div>
              <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-white/7 bg-black/15 p-1">
                {visibleFiles.slice(0, 100).map(file => (
                  <div key={file.path} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] hover:bg-white/[0.03]">
                    <FileCode2 className={cn("size-3.5 shrink-0", file.binary ? "text-slate-600" : "text-violet-300")} />
                    <span className="min-w-0 flex-1 truncate text-slate-400" title={file.path}>{file.path}</span>
                    <span className="shrink-0 text-[9px] text-slate-600">{prettyBytes(file.bytes)}</span>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <div className="flex items-center justify-between">
                <p className="eyebrow text-[10px]">CHANGE REVIEW</p>
                {selectedChange && <Badge variant="outline" className="border-amber-200/20 bg-amber-200/5 text-[9px] text-amber-100">รอตรวจ</Badge>}
              </div>
              {!selectedChange && <p className="mt-3 rounded-lg border border-dashed border-white/10 p-3 text-xs leading-5 text-slate-600">ส่งคำสั่งในแชทเพื่อสร้างแนวทางและตัวอย่าง diff</p>}
              {selectedChange && (
                <div className="mt-3 space-y-3">
                  <div className="rounded-lg border border-white/8 bg-white/[0.025] p-3">
                    <p className="text-xs font-medium text-slate-200">{selectedChange.summary.split("\n")[0]}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">{selectedChange.instruction}</p>
                  </div>
                  <div className="diff-window max-h-64 overflow-auto rounded-lg border border-white/8 bg-[#060914] p-3">
                    <pre className="font-mono text-[10px] leading-5 text-slate-400">{selectedChange.diffText}</pre>
                  </div>
                  <Button
                    onClick={() => setExportConfirmOpen(true)}
                    disabled={exportChange.isPending || selectedChange.status === "rejected"}
                    className="h-9 w-full rounded-lg bg-violet-300 text-xs font-bold text-slate-950 hover:bg-violet-200"
                  >
                    {exportChange.isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <PackageCheck className="mr-1.5 size-3.5" />}
                    ส่งออก ZIP ที่ตรวจแล้ว
                  </Button>
                </div>
              )}
            </section>
            {artifacts.filter(artifact => artifact.kind === "export").length > 0 && (
              <section>
                <p className="eyebrow text-[10px]">RECENT EXPORTS</p>
                <div className="mt-3 space-y-1">
                  {artifacts.filter(artifact => artifact.kind === "export").slice(0, 3).map(artifact => (
                    <a key={artifact.id} href={artifact.storageUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-cyan-100">
                      <ArrowDownToLine className="size-3.5 text-cyan-300" /><span className="min-w-0 flex-1 truncate">{artifact.filename}</span><span className="text-[9px] text-slate-600">{prettyBytes(artifact.bytes)}</span>
                    </a>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </ScrollArea>
    </aside>
  );

  return (
    <div className="cyber-shell min-h-screen">
      <div className="cyber-grid pointer-events-none fixed inset-0" />
      <div className="relative z-10 grid min-h-screen grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)_340px]">
        <div className="hidden lg:block">{projectPanel}</div>
        <main className="flex min-h-screen min-w-0 flex-col">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/8 bg-[#07101c]/72 px-4 backdrop-blur-xl sm:px-6">
            <Button variant="ghost" size="icon" onClick={() => setMobilePanel("projects")} className="text-slate-400 hover:bg-white/5 hover:text-white lg:hidden"><Menu className="size-5" /></Button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><GitBranch className="size-4 text-cyan-300" /><h1 className="truncate text-sm font-semibold text-white">{project?.name || "Workspace ใหม่"}</h1></div>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">{project ? `${files.length} ไฟล์ · ${sourceLabel(project.sourceType)} · ตรวจ diff ก่อนส่งออก` : "นำเข้า public repository หรือ ZIP เพื่อเริ่มงาน"}</p>
            </div>
            <Badge variant="outline" className="hidden border-emerald-300/15 bg-emerald-300/5 text-[10px] font-normal text-emerald-200 sm:flex"><CheckCircle2 className="mr-1 size-3" />ปลอดภัย</Badge>
            <Button variant="outline" onClick={() => setPaletteOpen(true)} className="hidden h-8 border-white/10 bg-white/[0.035] px-3 text-[11px] text-slate-200 hover:bg-white/10 hover:text-white sm:flex"><CommandIcon className="mr-1.5 size-3.5" />ค้นหา <kbd className="ml-1 rounded border border-white/10 px-1 text-[9px] text-slate-500">⌘K</kbd></Button><Button variant="outline" onClick={() => window.location.assign("/control")} className="hidden h-8 border-white/10 bg-white/[0.035] px-3 text-[11px] text-slate-200 hover:bg-white/10 hover:text-white sm:flex"><Braces className="mr-1.5 size-3.5" />Control</Button>
            <Button variant="outline" onClick={() => setImportOpen(true)} className="h-8 border-white/10 bg-white/[0.035] px-3 text-[11px] text-slate-200 hover:bg-white/10 hover:text-white"><FilePlus2 className="mr-1.5 size-3.5" />นำเข้า</Button>
            <Button variant="ghost" size="icon" onClick={() => setMobilePanel("inspector")} className="text-slate-400 hover:bg-white/5 hover:text-white lg:hidden"><Braces className="size-4" /></Button>
          </header>
          <div className="min-h-0 flex-1 p-3 sm:p-5">
            <div className="chat-surface flex h-full min-h-[calc(100vh-88px)] flex-col overflow-hidden rounded-2xl border border-white/9 bg-[#081321]/72 shadow-[0_20px_80px_rgba(0,0,0,0.32)] backdrop-blur-xl">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/8 px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-lg bg-violet-300/12"><Bot className="size-4 text-violet-200" /></span><span className="text-xs font-semibold text-slate-200">Code Edit Assistant</span></div>
                <span className="hidden items-center gap-1.5 text-[10px] text-slate-500 sm:flex"><span className="size-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.7)]" />โหมดเสนอการแก้ไข</span><Button variant="outline" onClick={summarizeActiveConversation} disabled={summarizeConversation.isPending || !project} className="hidden h-8 border-white/10 bg-white/[0.035] px-3 text-[11px] text-slate-200 hover:bg-violet-300/10 hover:text-violet-100 sm:flex">{summarizeConversation.isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Sparkles className="mr-1.5 size-3.5" />}สรุป</Button><Button variant="outline" onClick={() => setToolOpen(true)} className="h-8 border-white/10 bg-white/[0.035] px-3 text-[11px] text-slate-200 hover:bg-cyan-300/10 hover:text-cyan-100"><Sparkles className="mr-1.5 size-3.5" />เครื่องมือ</Button>
              </div>
              {!isOnline && <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-amber-300/15 bg-amber-300/[0.06] px-4 py-2 text-[11px] text-amber-100"><span>ออฟไลน์ · คำสั่งใหม่จะถูกเก็บไว้ในคิว</span><span className="shrink-0 rounded-full bg-amber-200/10 px-2 py-0.5">คิว {offlineQueue.length} · {channelState}</span></div>}
              {isOnline && offlineQueue.length > 0 && <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-cyan-300/15 bg-cyan-300/[0.05] px-4 py-2 text-[11px] text-cyan-100"><span>ออนไลน์แล้ว · กำลังส่งคิวต่อ</span><span className="shrink-0 rounded-full bg-cyan-200/10 px-2 py-0.5">เหลือ {offlineQueue.length} · {channelState}</span></div>}
              {processingStage !== "idle" && <div className="border-b border-violet-300/15 bg-violet-300/[0.045] px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-[11px] font-medium text-violet-100"><span className="size-2 animate-pulse rounded-full bg-violet-300" />{stageLabels[processingStage]}</div><div className="flex items-center gap-1">{processingStage === "error" && <Button variant="ghost" onClick={() => { setProcessingStage("idle"); if (lastInstruction) sendInstruction(lastInstruction); }} className="h-6 px-2 text-[10px] text-rose-100 hover:bg-rose-300/10">ลองใหม่</Button>}{processingStage !== "complete" && processingStage !== "error" && <Button variant="ghost" onClick={() => { processingRunId.current += 1; stageTimers.current.forEach(window.clearTimeout); stageTimers.current = []; proposeChange.reset(); setProcessingStage("idle"); }} className="h-6 px-2 text-[10px] text-slate-400 hover:bg-white/10 hover:text-white">ยกเลิก</Button>}</div></div><div className="mt-2 flex gap-1">{["thinking", "analyzing", "editing", "complete"].map(stage => <span key={stage} className={cn("h-1 flex-1 rounded-full bg-white/8", ["thinking", "analyzing", "editing", "complete"].indexOf(processingStage) >= ["thinking", "analyzing", "editing", "complete"].indexOf(stage) ? "bg-violet-300/70" : "")} />)}</div></div>}
              {workspaceQuery.isError && activeProjectId && (
                <div className="mx-5 mt-5 rounded-xl border border-rose-300/15 bg-rose-300/[0.045] p-4 text-center sm:mx-8">
                  <p className="text-sm font-semibold text-rose-100">เปิดพื้นที่ทำงานไม่สำเร็จ</p>
                  <p className="mt-1 text-xs leading-5 text-rose-100/60">การเชื่อมต่ออาจถูกขัดจังหวะ หรือไฟล์ต้นฉบับยังไม่พร้อมใช้งาน</p>
                  <Button onClick={() => workspaceQuery.refetch()} variant="outline" className="mt-3 h-8 border-rose-200/15 bg-transparent text-xs text-rose-100 hover:bg-rose-300/10 hover:text-white">ลองใหม่</Button>
                </div>
              )}
              {!project ? (
                <div className="grid flex-1 place-items-center p-6 text-center">
                  <div className="max-w-lg">
                    <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06]"><FolderGit2 className="size-6 text-cyan-200" /></div>
                    <p className="eyebrow mt-6">READY WHEN YOU ARE</p>
                    <h2 className="mt-3 text-2xl font-semibold text-white">นำเข้าโครงการ แล้วคุยกับโค้ดของคุณ</h2>
                    <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-400">ใช้ลิงก์ public repository หรือไฟล์ ZIP ระบบจะทำงานบนสำเนาที่แยกจากต้นทาง และให้คุณตรวจ diff ก่อนดาวน์โหลด</p>
                    <Button onClick={() => setImportOpen(true)} className="mt-6 h-10 rounded-lg bg-cyan-300 px-5 text-xs font-bold text-slate-950 hover:bg-cyan-200"><Upload className="mr-1.5 size-4" />นำเข้าโครงการแรก</Button>
                  </div>
                </div>
              ) : (
                <>
                  {generatedImages.length > 0 && (
                    <section className="border-b border-white/8 px-4 py-4 sm:px-5">
                      <div className="mb-3 flex items-center justify-between gap-3"><div><p className="eyebrow text-[10px]">GENERATED IMAGES</p><p className="mt-1 text-xs text-slate-400">ผลลัพธ์จริง {generatedImages.length} ภาพ · คลิกเพื่อเปิดขนาดเต็ม</p></div><Button variant="ghost" onClick={() => setGeneratedImages([])} className="h-7 px-2 text-[10px] text-slate-500 hover:text-white">ล้างผลลัพธ์</Button></div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {generatedImages.map((url, index) => <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-lg border border-white/10 bg-black/20"><img src={url} alt={`ภาพที่สร้าง ${index + 1}`} loading="lazy" className="aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" /></a>)}
                      </div>
                    </section>
                  )}
                  <AIChatBox
                  messages={chatMessages}
                  onSendMessage={sendInstruction}
                  isLoading={proposeChange.isPending || workspaceQuery.isFetching || processingStage !== "idle"}
                  height="100%"
                  value={chatDraft}
                  onValueChange={setChatDraft}
                  onMessageAction={handleMessageAction}
                  className="min-h-0 flex-1 rounded-none border-0 bg-transparent shadow-none"
                  placeholder="อธิบายสิ่งที่ต้องการแก้ เช่น “เพิ่ม validation ในฟอร์มและเขียน test”"
                  emptyStateMessage="เริ่มต้นด้วยคำสั่งแก้ไขโค้ดของคุณ"
                  suggestedPrompts={["อธิบายโครงสร้างของโครงการนี้", "ปรับปรุง accessibility ของหน้าแรก", "เพิ่ม validation และข้อผิดพลาดที่อ่านง่าย"]}
                  />
                </>
              )}
            </div>
          </div>
        </main>
        <div className="hidden lg:block">{inspectorPanel}</div>
      </div>

      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <CommandInput placeholder="ค้นหาคำสั่ง เช่น สรุป นำเข้า เครื่องมือ…" />
        <CommandList><CommandEmpty>ไม่พบคำสั่ง</CommandEmpty><CommandGroup heading="คำสั่งหลัก">
          <CommandItem onSelect={() => { setPaletteOpen(false); setImportOpen(true); }}><Upload className="mr-2 size-4" />นำเข้าโครงการ</CommandItem>
          <CommandItem onSelect={() => { setPaletteOpen(false); setToolOpen(true); }}><Sparkles className="mr-2 size-4" />เปิดเครื่องมือ</CommandItem>
          <CommandItem disabled={!project || summarizeConversation.isPending} onSelect={() => { setPaletteOpen(false); summarizeActiveConversation(); }}><Sparkles className="mr-2 size-4" />สรุปบทสนทนาและบันทึก bookmark</CommandItem>
          <CommandItem onSelect={() => { setPaletteOpen(false); window.location.assign("/control"); }}><Braces className="mr-2 size-4" />เปิดศูนย์ควบคุม</CommandItem>
          <CommandItem onSelect={() => { setPaletteOpen(false); setChatDraft("อธิบายโครงสร้างของโครงการนี้"); }}><GitBranch className="mr-2 size-4" />ใส่คำสั่งอธิบายโครงสร้างโครงการ</CommandItem>
        </CommandGroup></CommandList>
      </CommandDialog>

      <AlertDialog open={Boolean(intentReview)} onOpenChange={open => !open && setIntentReview(null)}>
        <AlertDialogContent className="border-white/10 bg-[#0a1422] text-slate-100">
          <AlertDialogHeader><AlertDialogTitle className="font-display tracking-wide">ขอให้ยืนยันเจตนาก่อนส่ง</AlertDialogTitle><AlertDialogDescription className="leading-6 text-slate-400">คำสั่งนี้ตีความได้หลายแบบ เลือกเป้าหมายเพื่อให้ระบบทำงานตรงความต้องการ</AlertDialogDescription></AlertDialogHeader>
          <div className="space-y-2">{intentReview?.options.map(option => <Button key={option} variant="outline" className="w-full justify-start border-white/10 bg-white/[0.03] text-left text-slate-200 hover:bg-cyan-300/10 hover:text-cyan-100" onClick={() => { const instruction = intentReview.instruction; setIntentReview(null); sendInstruction(instruction, option); }}>{option}</Button>)}</div>
          <AlertDialogFooter><AlertDialogCancel className="border-white/10 bg-transparent text-slate-400 hover:bg-white/5">ยกเลิก</AlertDialogCancel></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={importOpen} onOpenChange={open => !importing && setImportOpen(open)}>
        <DialogContent className="border-white/10 bg-[#0a1422] text-slate-100 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display tracking-wide">นำเข้าโครงการ</DialogTitle>
            <DialogDescription className="leading-6 text-slate-400">เลือก public repository หรือไฟล์ ZIP ระบบจะเก็บสำเนาเพื่อให้แก้ไขและส่งออกเท่านั้น</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 rounded-lg border border-white/8 bg-black/15 p-1">
            <button onClick={() => setImportMode("url")} className={cn("rounded-md py-2 text-xs font-medium transition-colors", importMode === "url" ? "bg-cyan-300/12 text-cyan-100" : "text-slate-500 hover:text-slate-200")}>Public repository</button>
            <button onClick={() => setImportMode("zip")} className={cn("rounded-md py-2 text-xs font-medium transition-colors", importMode === "zip" ? "bg-cyan-300/12 text-cyan-100" : "text-slate-500 hover:text-slate-200")}>ZIP file</button>
          </div>
          {importMode === "url" ? (
            <div className="space-y-3"><label className="text-xs font-medium text-slate-300">Repository URL</label><Input value={repositoryUrl} onChange={event => setRepositoryUrl(event.target.value)} onKeyDown={event => { if (event.key === "Enter") submitRepository(); }} placeholder="https://github.com/owner/repository" className="h-11 border-white/10 bg-white/[0.035] text-sm placeholder:text-slate-600 focus-visible:ring-cyan-300/40" /><p className="text-[11px] leading-5 text-slate-500">รองรับ public repository จาก GitHub และ GitLab โดยไม่ต้องใช้ Git token</p></div>
          ) : (
            <div className="space-y-3"><label className="text-xs font-medium text-slate-300">ไฟล์โครงการ (.zip)</label><label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/[0.025] px-4 text-center transition-colors hover:border-cyan-300/40 hover:bg-cyan-300/[0.035]"><Upload className="size-5 text-cyan-300" /><span className="mt-2 text-xs text-slate-300">{zipFile?.name || "เลือกหรือวางไฟล์ ZIP"}</span><span className="mt-1 text-[10px] text-slate-600">ไม่เกิน 50 MB · รองรับทุกชนิดไฟล์ในแพ็กเกจ</span><input type="file" accept=".zip,application/zip" className="sr-only" onChange={event => setZipFile(event.target.files?.[0] ?? null)} /></label></div>
          )}
          <div className="flex gap-2 rounded-lg border border-emerald-300/10 bg-emerald-300/[0.04] p-3 text-[11px] leading-5 text-emerald-100/75"><LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />ไม่มีช่องขอหรือเก็บ Git token และระบบจะไม่ commit หรือ push กลับไปยัง repository</div>
          <DialogFooter><Button variant="ghost" disabled={importing} onClick={() => setImportOpen(false)} className="text-slate-400 hover:bg-white/5 hover:text-slate-100">ยกเลิก</Button><Button onClick={importMode === "url" ? submitRepository : submitZip} disabled={importing} className="bg-cyan-300 text-slate-950 hover:bg-cyan-200">{importing && <Loader2 className="mr-1.5 size-4 animate-spin" />}{importMode === "url" ? "นำเข้า repository" : "อัปโหลด ZIP"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={toolOpen} onOpenChange={setToolOpen}><DialogContent className="border-white/10 bg-[#0a1422] text-slate-100 sm:max-w-xl"><DialogHeader><DialogTitle className="font-display tracking-wide">เลือกเครื่องมือ</DialogTitle><DialogDescription className="leading-6 text-slate-400">ทุกปุ่มจะแสดงขั้นตอนจริง หรือแจ้งสิ่งที่ต้องเชื่อมต่ออย่างชัดเจน</DialogDescription></DialogHeader><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{toolItems.map(item => { const Icon = item.icon; return <button key={item.label} onClick={() => { setToolOpen(false); item.action(); }} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.025] p-3 text-left transition-colors hover:border-cyan-300/30 hover:bg-cyan-300/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan-300/10 text-cyan-200"><Icon className="size-4" /></span><span className="min-w-0"><span className="block text-xs font-semibold text-slate-100">{item.label}</span><span className="mt-0.5 block text-[10px] text-slate-500">{item.detail}</span></span></button>; })}</div></DialogContent></Dialog>

      <AlertDialog open={exportConfirmOpen} onOpenChange={setExportConfirmOpen}>
        <AlertDialogContent className="border-white/10 bg-[#0a1422] text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display tracking-wide">ยืนยันการส่งออก ZIP</AlertDialogTitle>
            <AlertDialogDescription className="leading-6 text-slate-400">
              คุณได้ตรวจสอบข้อเสนอและ diff แล้วใช่หรือไม่ ระบบจะสร้าง ZIP ของสำเนาโครงการพร้อมการแก้ไขที่เลือก โดยจะไม่ commit หรือ push ไปยัง repository ต้นทาง
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-transparent text-slate-300 hover:bg-white/5 hover:text-white">กลับไปตรวจ diff</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (project && selectedChange) exportChange.mutate({ projectId: project.id, changeId: selectedChange.id });
              }}
              className="bg-violet-300 text-slate-950 hover:bg-violet-200"
            >
              สร้าง ZIP เพื่อดาวน์โหลด
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {mobilePanel && <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm lg:hidden"><div className="absolute inset-y-0 left-0 w-[min(92vw,360px)] border-r border-white/10 bg-[#091320] shadow-2xl">{mobilePanel === "projects" ? projectPanel : inspectorPanel}<Button variant="ghost" size="icon" onClick={() => setMobilePanel(null)} className="absolute right-3 top-3 text-slate-400"><X className="size-4" /></Button></div><button className="absolute inset-0 -z-10" aria-label="ปิดแผง" onClick={() => setMobilePanel(null)} /></div>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-white/7 bg-white/[0.025] px-2.5 py-2"><span className="block text-[9px] uppercase tracking-wider text-slate-600">{label}</span><span className="mt-1 block truncate text-xs font-medium text-slate-200">{value}</span></div>;
}

function ProjectListSkeleton() {
  return <div className="space-y-2 px-2 pt-2"><div className="h-12 animate-pulse rounded-xl bg-white/[0.04]" /><div className="h-12 animate-pulse rounded-xl bg-white/[0.025]" /></div>;
}
