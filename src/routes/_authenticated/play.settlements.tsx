import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { CasinoShell } from "@/components/CasinoShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Scale,
  ArrowUpRight,
  ArrowDownRight,
  Check,
  AlertTriangle,
  Lock,
  Bell,
} from "lucide-react";
import {
  listMySettlements,
  markSettlementPaid,
  confirmSettlementReceived,
  disputeSettlement,
  listSettleableTables,
  closeTableAndSettle,
} from "@/lib/settlements.functions";
import { remindSettlementDebtor } from "@/lib/push.functions";
import { formatDisplayName } from "@/lib/poker";
import { PlayerLink } from "@/components/PlayerLink";

export const Route = createFileRoute("/_authenticated/play/settlements")({
  head: () => ({ meta: [{ title: "Settlements — Poker Club" }] }),
  component: SettlementsPage,
  errorComponent: ({ error }) => (
    <CasinoShell>
      <div role="alert" className="text-sm text-red-400">
        Failed to load: {error.message}
      </div>
    </CasinoShell>
  ),
  notFoundComponent: () => (
    <CasinoShell>
      <div className="text-sm text-muted-foreground">Not found.</div>
    </CasinoShell>
  ),
});

const STATUS_LABEL: Record<string, string> = {
  unpaid: "Unpaid",
  payment_marked_sent: "Payment Sent",
  payment_confirmed: "Payment Received",
  partially_withdrawn: "Partially Withdrawn",
  fully_withdrawn: "Completed",
  disputed: "Disputed",
  cancelled: "Cancelled",
};

function statusTone(s: string) {
  switch (s) {
    case "unpaid":
      return "bg-red-500/15 text-red-300";
    case "payment_marked_sent":
      return "bg-amber-500/15 text-amber-300";
    case "payment_confirmed":
    case "fully_withdrawn":
      return "bg-emerald-500/15 text-emerald-300";
    case "partially_withdrawn":
      return "bg-sky-500/15 text-sky-300";
    case "disputed":
      return "bg-red-500/25 text-red-200";
    case "cancelled":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function fmt(n: number) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtDate(iso?: string | null) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function SettlementsPage() {
  const qc = useQueryClient();
  const load = useServerFn(listMySettlements);
  const loadTables = useServerFn(listSettleableTables);
  const markPaid = useServerFn(markSettlementPaid);
  const confirmRecv = useServerFn(confirmSettlementReceived);
  const dispute = useServerFn(disputeSettlement);
  const closeTable = useServerFn(closeTableAndSettle);
  const remindDebtor = useServerFn(remindSettlementDebtor);

  const q = useQuery({
    queryKey: ["my-settlements"],
    queryFn: () => load() as any,
  });
  const admin = useQuery({
    queryKey: ["settleable-tables"],
    queryFn: () => loadTables() as any,
  });

  const [payDialog, setPayDialog] = useState<null | { id: string; amount: number; toName: string }>(
    null,
  );
  const [payMethod, setPayMethod] = useState("");
  const [payNote, setPayNote] = useState("");
  const [disputeDialog, setDisputeDialog] = useState<null | {
    id: string;
    fromName: string;
    amount: number;
  }>(null);
  const [disputeReason, setDisputeReason] = useState("");

  const markPaidMut = useMutation({
    mutationFn: (v: { settlement_id: string; payment_method?: string; payment_note?: string }) =>
      markPaid({ data: v }) as Promise<{ ok: true }>,
    onSuccess: () => {
      toast.success("Marked as paid. Waiting for the other player to confirm.");
      qc.invalidateQueries({ queryKey: ["my-settlements"] });
      setPayDialog(null);
      setPayMethod("");
      setPayNote("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const confirmMut = useMutation({
    mutationFn: (id: string) =>
      confirmRecv({ data: { settlement_id: id } }) as Promise<{ ok: true }>,
    onSuccess: () => {
      toast.success("Payment confirmed.");
      qc.invalidateQueries({ queryKey: ["my-settlements"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const disputeMut = useMutation({
    mutationFn: (v: { settlement_id: string; reason: string }) =>
      dispute({ data: v }) as Promise<{ ok: true }>,
    onSuccess: () => {
      toast.success("Marked as disputed.");
      qc.invalidateQueries({ queryKey: ["my-settlements"] });
      setDisputeDialog(null);
      setDisputeReason("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const closeMut = useMutation({
    mutationFn: (v: { source_kind: "poker" | "blackjack"; table_id: string }) =>
      closeTable({ data: v }) as Promise<{ ok: true; created: number }>,
    onSuccess: (r) => {
      toast.success(
        r.created === 0
          ? "Session balanced — no debts."
          : `Created ${r.created} settlement${r.created === 1 ? "" : "s"}.`,
      );
      qc.invalidateQueries({ queryKey: ["settleable-tables"] });
      qc.invalidateQueries({ queryKey: ["my-settlements"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const remindMut = useMutation({
    mutationFn: (id: string) => remindDebtor({ data: { settlementId: id } }) as Promise<any>,
    onSuccess: (r: any) => {
      if (r?.noSubs)
        toast.info("Reminder sent — they haven't enabled push yet, but it's in their inbox.");
      else toast.success("Reminder sent.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to send reminder"),
  });

  if (q.isLoading || !q.data) {
    return (
      <CasinoShell>
        <div className="text-sm text-muted-foreground">Loading…</div>
      </CasinoShell>
    );
  }

  const me: string = q.data.user_id;
  const all: any[] = q.data.settlements ?? [];
  const HIDE = new Set(["fully_withdrawn", "cancelled", "payment_confirmed"]);
  const open = all.filter((s) => !HIDE.has(s.status));
  const youOwe = open.filter((s) => s.debtor_id === me);
  const youAreOwed = open.filter((s) => s.creditor_id === me);
  const unpaidOwed = youOwe.filter((s) => s.status === "unpaid");

  return (
    <CasinoShell>
      <div className="animate-in fade-in duration-500 mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 font-display text-3xl font-bold">
            <Scale className="h-7 w-7 text-gold" /> Settlements
          </h1>
          <p className="text-sm text-muted-foreground">
            External money owed between players. Payments happen off-platform — this page just
            tracks status.
          </p>
        </div>

        {/* Admin: tables ready to settle */}
        {admin.data?.is_admin && (admin.data?.tables?.length ?? 0) > 0 && (
          <section className="mb-8">
            <h2 className="mb-2 font-display text-lg font-semibold">Tables ready to settle</h2>
            <div className="card-felt shadow-card overflow-hidden rounded-2xl">
              {admin.data.tables.map((t: any) => (
                <div
                  key={`${t.kind}-${t.id}`}
                  className="flex items-center justify-between gap-3 border-b border-border/30 px-4 py-2 last:border-0 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{t.name}</div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {t.kind} · {t.status}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-gold/40 text-gold hover:bg-gold/10"
                    onClick={() => closeMut.mutate({ source_kind: t.kind, table_id: t.id })}
                    disabled={closeMut.isPending}
                  >
                    <Lock className="mr-1 h-3 w-3" /> Close & auto-settle
                  </Button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Closing a table locks results and generates the minimum set of debts. All players must
              have cashed out first.
            </p>
          </section>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {/* You owe */}
          <section>
            <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold text-red-300">
              <ArrowUpRight className="h-4 w-4" /> You owe
              {unpaidOwed.length > 0 && (
                <span
                  className="ml-1 flex h-2 w-2 rounded-full bg-red-500 animate-pulse"
                  aria-label={`${unpaidOwed.length} unpaid debt${unpaidOwed.length === 1 ? "" : "s"}`}
                />
              )}
            </h2>
            <div className="space-y-2">
              {youOwe.length === 0 && (
                <div className="card-felt rounded-2xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                  You don't owe anyone. Nice.
                </div>
              )}
              {youOwe.map((s) => {
                const to = s.creditor;
                const toName = formatDisplayName(to?.name, to?.nickname) || "player";
                const toId = to?.id ?? s.creditor_id ?? null;
                return (
                  <div key={s.id} className="card-felt shadow-card rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">
                          {s.session_name}
                        </div>
                        <div className="mt-1 text-sm">
                          Pay <PlayerLink userId={toId} name={toName} className="font-semibold" />{" "}
                          <span className="font-mono text-gold">{fmt(s.amount)}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                          <span className={`rounded-full px-2 py-0.5 ${statusTone(s.status)}`}>
                            {STATUS_LABEL[s.status]}
                          </span>
                          {s.marked_paid_at && (
                            <span className="text-muted-foreground">
                              sent {fmtDate(s.marked_paid_at)}
                            </span>
                          )}
                        </div>
                      </div>
                      {(s.status === "unpaid" || s.status === "disputed") && (
                        <Button
                          size="sm"
                          className="border-gold/40 bg-gold/10 text-gold hover:bg-gold/20"
                          variant="outline"
                          onClick={() =>
                            setPayDialog({ id: s.id, amount: Number(s.amount), toName })
                          }
                        >
                          Mark as paid
                        </Button>
                      )}
                    </div>
                    {s.payment_note && (
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        Note: {s.payment_note}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* You are owed */}
          <section>
            <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold text-emerald-300">
              <ArrowDownRight className="h-4 w-4" /> You are owed
            </h2>
            <div className="space-y-2">
              {youAreOwed.length === 0 && (
                <div className="card-felt rounded-2xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                  Nobody owes you right now.
                </div>
              )}
              {youAreOwed.map((s) => {
                const from = s.debtor;
                const fromName = formatDisplayName(from?.name, from?.nickname) || "player";
                const fromId = from?.id ?? s.debtor_id ?? null;
                return (
                  <div
                    key={s.id}
                    id={`s-${s.id}`}
                    className="card-felt shadow-card rounded-2xl p-4 scroll-mt-24 target:ring-2 target:ring-gold/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">
                          {s.session_name}
                        </div>
                        <div className="mt-1 text-sm">
                          <PlayerLink userId={fromId} name={fromName} className="font-semibold" />{" "}
                          owes you <span className="font-mono text-gold">{fmt(s.amount)}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                          <span className={`rounded-full px-2 py-0.5 ${statusTone(s.status)}`}>
                            {STATUS_LABEL[s.status]}
                          </span>
                          {s.marked_paid_at && (
                            <span className="text-muted-foreground">
                              sent {fmtDate(s.marked_paid_at)}
                            </span>
                          )}
                          {s.confirmed_received_at && (
                            <span className="text-muted-foreground">
                              received {fmtDate(s.confirmed_received_at)}
                            </span>
                          )}
                        </div>
                        {s.dispute_reason && (
                          <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
                            Disputed: {s.dispute_reason}
                          </div>
                        )}
                      </div>
                      {s.status === "payment_marked_sent" && (
                        <div className="flex flex-col gap-1">
                          <Button
                            size="sm"
                            className="border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                            variant="outline"
                            onClick={() => confirmMut.mutate(s.id)}
                            disabled={confirmMut.isPending}
                          >
                            <Check className="mr-1 h-3 w-3" /> Confirm received
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-300 hover:text-red-200"
                            onClick={() =>
                              setDisputeDialog({ id: s.id, fromName, amount: Number(s.amount) })
                            }
                          >
                            <AlertTriangle className="mr-1 h-3 w-3" /> Dispute
                          </Button>
                        </div>
                      )}
                      {s.status === "unpaid" && (
                        <div className="flex flex-col gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-gold/40 bg-gold/10 text-gold hover:bg-gold/20"
                            onClick={() => remindMut.mutate(s.id)}
                            disabled={remindMut.isPending}
                          >
                            <Bell className="mr-1 h-3 w-3" /> Send reminder
                          </Button>
                        </div>
                      )}
                    </div>
                    {s.payment_method && (
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        Method: {s.payment_method}
                      </div>
                    )}
                    {s.payment_note && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Note: {s.payment_note}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Confirming a payment marks it as received and unlocks that amount for virtual withdrawal
          from the Cashier.
        </p>
      </div>

      {/* Mark-as-paid dialog */}
      <Dialog open={!!payDialog} onOpenChange={(o) => !o && setPayDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark payment as sent</DialogTitle>
            <DialogDescription>
              Confirm you paid{" "}
              <span className="font-semibold text-gold">
                {payDialog ? fmt(payDialog.amount) : ""}
              </span>{" "}
              to <span className="font-semibold">{payDialog?.toName}</span> outside the platform.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Method (optional)</label>
              <Input
                placeholder="Cash, Revolut, IRIS…"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Note or reference (optional)</label>
              <Textarea rows={2} value={payNote} onChange={(e) => setPayNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={markPaidMut.isPending || !payDialog}
              onClick={() =>
                payDialog &&
                markPaidMut.mutate({
                  settlement_id: payDialog.id,
                  payment_method: payMethod.trim() || undefined,
                  payment_note: payNote.trim() || undefined,
                })
              }
            >
              Confirm sent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dispute dialog */}
      <Dialog open={!!disputeDialog} onOpenChange={(o) => !o && setDisputeDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dispute payment</DialogTitle>
            <DialogDescription>
              {disputeDialog && (
                <>
                  Reject the claim that{" "}
                  <span className="font-semibold">{disputeDialog.fromName}</span> sent{" "}
                  <span className="font-semibold text-gold">{fmt(disputeDialog.amount)}</span>.
                  Explain why so they can retry.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            placeholder="e.g. Nothing arrived in my Revolut account."
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={disputeMut.isPending || disputeReason.trim().length < 3 || !disputeDialog}
              onClick={() =>
                disputeDialog &&
                disputeMut.mutate({ settlement_id: disputeDialog.id, reason: disputeReason.trim() })
              }
            >
              Submit dispute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CasinoShell>
  );
}
