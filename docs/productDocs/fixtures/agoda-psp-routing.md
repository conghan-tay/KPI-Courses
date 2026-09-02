# PSP routing and failover

Three payment service providers, call them A, B and C. Every payout has to pick one. This
note is about how it picks, and about what happens when the answer is "none of them".

## Routing

A corridor is (currency, supplier country, amount band). Each corridor has an ordered
preference list, which came out of a spreadsheet finance maintained and which I never
tried to make clever. Cost per transaction, success rate in that corridor, and settlement
speed, weighted by someone whose job that actually was.

The routing layer's own contribution is one thing: it removes providers that are currently
unhealthy from the list before choosing. That is the circuit breaker.

## Circuit breakers

One breaker per PSP per corridor — not one per PSP. Provider B being broken for THB
payouts tells you very little about provider B for EUR, and collapsing those into one
signal means one bad corridor takes out a healthy one.

**Open condition: five consecutive failures, or a greater-than-20% error rate over a
sixty-second window.** Whichever comes first. Five consecutive is the fast path for a
provider that has fallen over completely; the rate-over-window is the slow path for one
that is failing intermittently, where you would otherwise wait forever for five in a row.

**Half-open retry.** After thirty seconds open, the breaker admits exactly one request. It
is a real payout, not a synthetic ping — a synthetic health check tells you the provider's
status page is up, which is not the question. If that one request succeeds, the breaker
closes. If it fails, the breaker reopens and the next window doubles, capped at five
minutes.

One request, not a percentage of traffic. At this volume a "let 5% through" policy sends
several thousand real payouts at a provider we have just decided is broken.

## What broke before the breakers existed

Two incidents, and the second is the more interesting one.

**The first** was provider A returning 503s for about forty minutes. Every payout in its
corridors failed, retried on a fixed schedule, failed again, and the retry traffic kept
the queue saturated so that healthy corridors backed up behind it. Nothing was lost. It
was just slow, and embarrassing, and obviously preventable. That incident bought me the
budget to build the breakers.

**The second — the PSP-B incident — is the one I actually learned from.** The breaker was
in place. It did not open. It did not open because provider B did not start returning
errors: it started being slow. p99 issuance latency went from 210 milliseconds to about
nine seconds and stayed there for most of an afternoon. Every request eventually
succeeded, so the error rate stayed near zero, so the breaker stayed shut, so we kept
routing to it, so the queue backed up behind nine-second calls.

I had built a breaker that measured errors, in a system where the realistic failure mode
was latency. That is not a bug. It is a design that answered the wrong question, and I
signed off on it.

The fix: latency is a breaker input. If p99 over the window exceeds four times the
trailing seven-day baseline for that corridor, the breaker opens on the same terms as an
error rate. A relative threshold rather than an absolute one, because 900ms is fine for
one corridor and catastrophic for another, and I was not going to maintain per-corridor
absolute numbers by hand.

The general version of this, which I will argue with you about: **a health signal that
only measures the failures you have already seen will miss the next one.** Availability
and latency are not two metrics, they are the same metric at different thresholds. A
request that takes nine seconds in a system with a five-second timeout *is* an error; a
request that takes nine seconds in a system with no timeout is worse than an error,
because it consumes a worker and reports success.

## Deferred: what happens when all three are open

If every breaker in a corridor is open, there is nowhere to route. The payout does not
fail. It parks in a `deferred` state and a retry sweep picks it up when a breaker closes.

Failing it would be wrong. A supplier payout is not a checkout — nobody is standing at a
till. The money is genuinely owed and the only true statement is "we could not pay this
yet", so that is what the state says.

Here is my regret, and it is the design decision I would most like back. `deferred` was
not in the original state machine. For the first eighteen months, a payout with nowhere to
route sat in `pending` with an incremented `retry_count` and a `last_error` string, and
"is this stuck or is it just waiting" was a question you answered by reading error text
with your eyes. Support could not answer it. Dashboards could not count it. It surfaced as
a data problem — a mysterious growing bucket of pending rows — when it was an operational
problem the whole time.

**An operational state should not have to be inferred from a data state.** If an operator
will one day ask "how many of these are stuck", that is a column, on day one, not a
`WHERE last_error LIKE` you write during an incident. Adding it later meant a backfill, a
migration on a hot table, and three weeks of two code paths.
