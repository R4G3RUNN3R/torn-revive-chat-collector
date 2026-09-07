const SCAN_INTERVAL_MS = 60 * 1000;

function validDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function createSubscriptionScanHandler({invoiceRepository,evidenceService,clock=()=>new Date()}) {
  if (!invoiceRepository ||
      typeof invoiceRepository.expireDue!=='function' ||
      typeof invoiceRepository.listPending!=='function' ||
      typeof invoiceRepository.markPaidWithEvidence!=='function') {
    throw new Error('invoiceRepository is required');
  }
  if (!evidenceService || typeof evidenceService.getIncomingEvidence!=='function') {
    throw new Error('evidenceService is required');
  }
  if (typeof clock!=='function') throw new Error('clock must be a function');

  return async function subscriptionScanHandler() {
    const now=clock();
    if (!validDate(now)) throw new Error('clock returned an invalid date');

    await invoiceRepository.expireDue(now);
    const invoices=await invoiceRepository.listPending(now);
    const runAt=new Date(now.getTime()+SCAN_INTERVAL_MS);
    if (!Array.isArray(invoices) || invoices.length===0) return {status:'reschedule',runAt};

    const validInvoices=invoices.filter(row => validDate(row.createdAt) && validDate(row.expiresAt));
    if (validInvoices.length===0) return {status:'reschedule',runAt};
    const from=new Date(Math.min(...validInvoices.map(row=>row.createdAt.getTime())));
    const latestExpiry=Math.max(...validInvoices.map(row=>row.expiresAt.getTime()));
    const to=new Date(Math.min(now.getTime(),latestExpiry));

    const currencies=[...new Set(validInvoices.map(row=>row.currency).filter(value=>value==='cash'||value==='xanax'))];
    const evidence=[];
    for (const currency of currencies) {
      const rows=await evidenceService.getIncomingEvidence({currency,from,to});
      for (const row of Array.isArray(rows)?rows:[]) evidence.push(row);
    }
    evidence.sort((a,b)=>{
      const atA=validDate(a.at)?a.at.getTime():Number.MAX_SAFE_INTEGER;
      const atB=validDate(b.at)?b.at.getTime():Number.MAX_SAFE_INTEGER;
      if (atA!==atB) return atA-atB;
      return String(a.tornLogId||'').localeCompare(String(b.tornLogId||''));
    });

    const locallyUsed=new Set();
    const orderedInvoices=[...validInvoices].sort((a,b)=>a.createdAt-b.createdAt || String(a.id).localeCompare(String(b.id)));
    for (const invoice of orderedInvoices) {
      const matches=evidence.filter(row =>
        !locallyUsed.has(row.tornLogId)
        && row.senderTornId===invoice.purchaserTornId
        && row.currency===invoice.currency
        && Number(row.amount)===Number(invoice.expectedAmount)
        && validDate(row.at)
        && row.at.getTime()>=invoice.createdAt.getTime()
        && row.at.getTime()<=invoice.expiresAt.getTime()
      );
      for (const match of matches) {
        const result=await invoiceRepository.markPaidWithEvidence({
          invoiceId:invoice.id,
          tornLogId:match.tornLogId,
          senderTornId:match.senderTornId,
          currency:match.currency,
          amount:match.amount,
          evidenceAt:match.at,
          paidAt:now
        });
        if (result && (result.paid===true || result.reason==='ALREADY_PAID')) {
          locallyUsed.add(match.tornLogId);
          break;
        }
        if (result && result.reason==='EVIDENCE_ALREADY_USED') {
          locallyUsed.add(match.tornLogId);
          continue;
        }
      }
    }

    return {status:'reschedule',runAt};
  };
}

module.exports={
  SCAN_INTERVAL_MS,
  createSubscriptionScanHandler
};
