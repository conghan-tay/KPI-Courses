# Nightly reconciliation

Three records of the same money, none of which agree: our ledger, the issuer's
authorisation feed, and the bank statement. Reconciliation is the job that makes them
agree, or says loudly where they do not.

## Why it has to exist

A virtual card is issued for 4,200 THB. The hotel authorises 4,187. Two days later they
capture 4,187. Three days after that the issuer settles, and the amount on the statement
is 4,191 because someone's FX timestamp differs from someone else's by a few hours.

Nothing has gone wrong in that story. That is a *normal night*. If your system treats
"issued amount equals settled amount" as an invariant, you will page a human two million
times a month and they will stop reading the pages by week two.

## The pipeline

A Spark job, nightly, about forty minutes for a normal night. Three inputs:

- our `payouts` and `card_issuances` tables, snapshotted
- the issuer's authorisation and capture feed, a file drop
- the bank settlement statement, a different file, different format, different timezone
  convention, obviously

It joins on card token plus a date window rather than on an exact timestamp, because the
three sources do not share a clock and pretending they do produces a nightly disaster that
looks like a bug in your join.

Output is one row per payout with a status, and where the status is not `MATCHED`, a
**mismatch class**.

## The four mismatch classes

Four, and the fact that there are exactly four is deliberate. I have seen the version of
this system where the mismatch reason is a free-text string, and what you get is nine
hundred distinct reasons, none of which can be counted, alerted on, or automated against.

- **`AMOUNT_DRIFT`** — settled amount differs from issued amount, within tolerance. FX
  timing, partial capture, a hotel that charged slightly less. Tolerance is per-corridor
  and comes from the same finance spreadsheet as everything else. Auto-resolves: the
  ledger is adjusted and the difference is booked to an FX variance account.
- **`TIMING_SKEW`** — everything matches but the settlement landed outside the window we
  looked in. Auto-resolves by widening the window on the next run; it is the single most
  common class and it is almost always noise.
- **`DUPLICATE_ISSUANCE`** — two cards, one payable. **This pages a human immediately, at
  any hour.** It is the only class that does. Real money has left the building twice, the
  clock on recovering it starts now, and no automation should be trusted to decide that
  one of two real payments is the wrong one.
- **`ORPHAN_AUTH`** — an authorisation against a card token we have no record of issuing.
  Usually a data-load ordering problem; occasionally something that matters a great deal.
  Goes into the manual queue with a high priority. **It does not page** — it has never once
  been an emergency at 3am, and a class that pages and is never urgent is a class that
  trains people to ignore pages.

Nobody should be woken up by a rounding difference. Deciding which of four classes
deserves a phone call is the actual design work; the join is the easy part.

## Volumes and what lands on a human

On a normal night, out of roughly two million payables a month:

- about **94%** of raised mismatches auto-resolve, no human involved
- the remaining **~6%** land in an ops queue, each carrying its class and a *suggested
  action*, not just a complaint

The suggested action mattered more than I expected. A queue item that says
`AMOUNT_DRIFT: settled 4,191 vs issued 4,200, within THB tolerance, suggest: accept and
book variance` gets cleared in four seconds. The same item that says `mismatch` gets
escalated, because the operator has no way to know if it is the interesting one.

The 6% is not a failure to automate further. It is where the genuinely ambiguous cases go,
and I would rather it were 6% and correct than 1% and quietly wrong.

## What I would change

The Spark job is a batch job because the file drops are batch. If the issuer had offered a
stream I would have taken it, and I think the nightly cadence hides problems for up to
twenty-four hours that a streaming reconciliation would surface in minutes. That is a
constraint I accepted rather than a design I would defend.
