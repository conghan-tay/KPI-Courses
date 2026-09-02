# Postgres — the payout queue, and opinions I will defend

Everything below is from running one Postgres cluster hard for five and a half years, not
from reading about it.

## The payout queue and its workers

The queue is a Postgres table. Not Kafka, not SQS, not RabbitMQ. A table called
`payout_queue`, with a status column and an index.

I get argued with about this roughly once per interview, so: the payouts we are queueing
already live in the same database as the queue. Putting the queue in a broker means the
enqueue and the state change are in two systems and you need an outbox and a relay and a
dedup story to make them one atomic thing. Putting the queue in the same database means
`INSERT INTO payout_queue` and `UPDATE payouts SET status` are one transaction and there
is no story to tell. At two million payables a month this is not close.

**The workers run at `READ COMMITTED`**, and claim work with:

```sql
SELECT id FROM payout_queue
WHERE status = 'ready' AND run_after <= now()
ORDER BY run_after
FOR UPDATE SKIP LOCKED
LIMIT 20;
```

`SKIP LOCKED` is the whole trick. Without it, twenty workers all queue up behind the same
first row and you have a very expensive single-threaded system. With it, each worker takes
a disjoint batch and they never contend.

Around that, two more things:

- The idempotency key from the payouts note, persisted before any provider call.
- A Postgres advisory lock keyed on the payable id for the duration of the issuance, so
  even a worker that somehow got a duplicate claim cannot issue against the same payable
  concurrently.

## Why not SERIALIZABLE

This is the most arguable decision in the system and I am not going to pretend it is
obvious. It is a judgement call and a reasonable engineer lands the other way.

`SERIALIZABLE` was evaluated and rejected. Two reasons:

**One: serialization failures became a retry storm.** At our concurrency, the predicate
locking on the queue table produced enough `could not serialize access` errors that the
workers spent a meaningful fraction of their time retrying transactions that would have
been fine. And a retry storm in a payouts system is not a performance problem, it is a
correctness *risk*, because every retry is another chance for a partial failure between
"we called the provider" and "we recorded that we called the provider".

**Two: the correctness it was buying was already explicit elsewhere.** The specific anomaly
`SERIALIZABLE` protects against here is two workers acting on the same payable. That is
already prevented twice, in ways I can point at in the code: the deterministic idempotency
key means a double issuance is rejected by the provider, and the advisory lock means the
second worker does not get that far. `SERIALIZABLE` would have been a third, implicit,
expensive guarantee layered over two explicit cheap ones.

I prefer the invariant I can name and test to the isolation level I have to trust. If you
disagree, the honest counter is that my two mechanisms are application code and can be
removed by someone who does not know why they are there, whereas the isolation level
cannot. That is a real argument. I still think I chose right, but I would want the person
making it in the room.

## Opinions, stated plainly

- **A queue in your database is the correct default**, and you should move to a broker
  when you can name the specific thing the database stopped doing, not before. Most teams
  I have watched adopt a broker did it at a volume Postgres was not noticing.
- **`READ COMMITTED` plus explicit locking beats a higher isolation level** for anything
  that talks to an external system inside the transaction boundary. High isolation and
  network calls are a bad pairing and the isolation level is the part that has to give.
- **`SELECT FOR UPDATE` without `SKIP LOCKED` is almost always a bug** in a worker pool.
  If you meant to serialise, say so with an advisory lock; if you meant to parallelise,
  skip.
- **Long transactions are the actual enemy**, not lock contention. Nearly every "Postgres
  is slow" incident I have debugged was one transaction held open across a network call,
  and the fix was moving the call out of the transaction, not tuning anything.
- **Read your query plans.** I will ask you to read one in an interview and I do not
  consider it a trick question.
- **`jsonb` is a fine place to put a document and a terrible place to put a foreign key.**
  If you find yourself indexing into a `jsonb` array to join, that array wanted to be a
  table two months ago.
