# Supplier payouts — how the money actually leaves

Written up in mid-2025, from memory and from a design doc I no longer have access to.
Numbers are the ones I remember being true when I left; treat them as order-of-magnitude.

## The shape of the problem

A traveller books a hotel. We hold the money. At some point — check-in, check-out, or a
date in a contract, depending on the supplier — we owe that hotel money. Multiply by
roughly two million payables a month across a hundred and forty countries, and the
interesting part stops being "send money" and starts being "know, at all times, exactly
what you owe and what you have already paid."

Most payments engineers I interview have done acquiring: taking money from a consumer.
Payouts is the mirror image and the failure modes do not rhyme. In acquiring, the worst
case is you did not get paid. In payouts, the worst case is you paid twice, and the
counterparty has no incentive to tell you.

## The issuance flow, end to end

Five hops, and I can defend every one of them:

1. **Payable created.** A booking event lands, the contract terms say when it becomes
   due, and a row goes into `payables` with an amount, a currency, a due date and a
   supplier. Nothing moves yet.
2. **Batched into a payout.** A sweep groups payables by supplier and currency into one
   `payout`. A supplier owed eleven small amounts gets one card, not eleven.
3. **PSP selected.** The routing layer picks a provider for this corridor — currency,
   country, amount band, and current health. Health is the part people underestimate; see
   the PSP routing note.
4. **Virtual card issued.** We ask the provider to mint a single-use card number with an
   exact limit, an exact currency, and a merchant-category lock. The card *is* the
   payment instrument. We hand the details to the supplier, or to the supplier's own
   booking system, and they pull the amount.
5. **Settlement and reconciliation.** The issuer eventually tells us what was actually
   authorised and captured against that card. That is almost never instantaneous and it is
   frequently not equal to what we issued. The nightly reconciliation exists because of
   this sentence.

## Virtual card issuance, in more detail

This is the part people ask about when the job description says "card issuing", so:

Yes, I have issued cards. Not consumer credit cards — single-use virtual commercial cards
for B2B payout, which is a narrower thing and I would rather say so than let it be
assumed broader. What that involved:

- **Limits are exact, not approximate.** The card is minted with an authorisation limit
  equal to the payable, in the payable's currency, and it declines anything above it. A
  card with a rounded-up limit is an invitation for a supplier to help themselves.
- **Merchant category locks.** The card only works at lodging MCCs. This has caught real
  misuse twice that I know of.
- **Validity windows.** Open at issue, closed on a schedule that matches the contract, so
  an unused card does not sit live for a year.
- **Single use, and single use means single use.** A card that has been authorised once
  is closed to further authorisations even if the amount was lower than the limit. The
  difference comes back through reconciliation, not through leaving the card open.
- **Currency is fixed at issuance.** We do not let the provider do the conversion. If the
  hotel bills in THB, the card is a THB card, because a provider's FX spread is not a
  cost I can explain to finance six weeks later.

Three PSPs, three slightly different issuing APIs, one internal interface. The internal
interface was deliberately the intersection of what all three could do, not the union.
Every time we let one provider's special capability into the interface we paid for it in
the failover path.

## Idempotency, which is the whole game

Issuing a card is issuing money. The one thing the system must never do is issue two
cards for one payable because a network call timed out and something retried.

The idempotency key is derived from `(payout_id, attempt_number)`. Two properties, both
load-bearing:

- **It is deterministic.** Not a UUID generated per request. A UUID means a retry
  generates a *new* key, which is exactly the same as having no key at all. If the same
  logical attempt happens twice, it must produce the same key both times, and derivation
  from data that already exists is the only way to guarantee that.
- **It is generated and persisted before the call goes out.** Written to our database, in
  the same transaction that marks the attempt as started, and only then do we talk to the
  provider. If the process dies between the write and the response, recovery reads the key
  back and asks the provider what happened to it. If we generated the key in memory and
  died, we would have no way to ask.

`attempt_number` rather than a bare `payout_id` because a *deliberate* second attempt —
first provider hard-declined, we are trying another — is a genuinely different payment and
must not be deduplicated against the first.

The thing I would tell a junior engineer: an idempotency key that does not survive process
death is decoration. Most of the ones I have reviewed are decoration.

## What I would do differently

Model `deferred` as a first-class payout state from day one instead of discovering I
needed it eighteen months in. Details in the PSP routing note; it is the single design
regret I bring up unprompted.
