import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, LockKeyhole, MessageSquareText, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useRoute } from "wouter";

export default function SharedConversation() {
  const [, params] = useRoute("/share/:token");
  const [password, setPassword] = useState("");
  const [submittedPassword, setSubmittedPassword] = useState("");
  const token = params?.token ?? "";
  const share = trpc.advanced.sharedConversation.useQuery(
    { token, password: submittedPassword || undefined },
    { enabled: Boolean(token), retry: false },
  );

  if (share.isLoading) return <div className="cyber-shell grid min-h-screen place-items-center text-slate-300"><div className="animate-pulse">กำลังเปิดบทสนทนาที่แชร์…</div></div>;

  const data = share.data;
  const needsPassword = data?.requiresPassword;
  const hasError = Boolean(share.error);
  const showPasswordForm = Boolean(needsPassword || (hasError && submittedPassword));
  const errorMessage = share.error?.message?.includes("too_small") || share.error?.message?.includes("token")
    ? "ลิงก์ไม่ถูกต้องหรือสั้นเกินไป โปรดใช้ลิงก์ที่คัดลอกจากหน้าแชร์โดยตรง"
    : share.error?.message || "ลิงก์หมดอายุหรือถูกเพิกถอนแล้ว";

  return (
    <main className="cyber-shell min-h-screen px-4 py-8 text-slate-200 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-2 text-xs text-slate-500 transition hover:text-cyan-100"><ArrowLeft className="size-4" />กลับสู่ SILELO</Link>
        <header className="mt-10 flex items-start justify-between gap-4 border-b border-white/10 pb-6">
          <div><p className="eyebrow">READ-ONLY SHARE</p><h1 className="mt-2 font-display text-2xl font-semibold text-white">บทสนทนาที่แชร์</h1><p className="mt-2 text-sm text-slate-500">อ่านได้อย่างเดียว · หมดอายุ {data?.expiresAt ? new Date(data.expiresAt).toLocaleString("th-TH") : "ตามที่เจ้าของกำหนด"}</p></div>
          <ShieldCheck className="size-7 text-emerald-300" />
        </header>
        {hasError && <section className="mt-8 rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] p-5"><p className="font-medium text-rose-100">เปิดลิงก์ไม่ได้</p><p className="mt-2 text-sm leading-6 text-rose-200/70">{errorMessage}</p></section>}
        {showPasswordForm && <section className="mx-auto mt-12 max-w-md rounded-2xl border border-white/10 bg-white/[0.035] p-6"><LockKeyhole className="size-6 text-cyan-200" /><h2 className="mt-4 text-lg font-semibold text-white">ลิงก์นี้มีรหัสผ่าน</h2><p className="mt-2 text-sm leading-6 text-slate-500">กรอกรหัสผ่านที่เจ้าของลิงก์กำหนดเพื่ออ่านบทสนทนา</p><form className="mt-5 flex gap-2" onSubmit={event => { event.preventDefault(); setSubmittedPassword(password); }}><Input autoFocus type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="รหัสผ่าน" className="border-white/10 bg-white/[0.035]" /><Button type="submit" disabled={!password} className="bg-cyan-300 text-slate-950 hover:bg-cyan-200">{submittedPassword ? "ลองอีกครั้ง" : "เปิดอ่าน"}</Button></form></section>}
        {!needsPassword && !hasError && <section className="mt-8 space-y-4">{data?.messages?.map((message, index) => <article key={`${message.createdAt}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"><div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500"><MessageSquareText className="size-3.5" />{message.role === "assistant" ? "SILELO" : "ผู้ใช้"}{message.model ? ` · ${message.model}` : ""}</div><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-200">{message.content}</p><time className="mt-4 block text-[10px] text-slate-600">{new Date(message.createdAt).toLocaleString("th-TH")}</time></article>)}{!data?.messages?.length && <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-slate-500">ยังไม่มีข้อความในบทสนทนานี้</div>}</section>}
      </div>
    </main>
  );
}
