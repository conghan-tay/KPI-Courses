# Career notes — why I left, what I want, what I am not

Written for exactly this purpose: so I stop repeating it, and so nobody has to read
between lines.

## Why I left Agoda

The payouts platform got to the state I wanted it in. Breakers, deferred, reconciliation
with four classes and a 94% auto-resolve rate, a queue that had not woken anyone up in
about eight months. The interesting work became operating it, and I am not the person who
enjoys the fourth year of operating something.

There was a reorg in early 2025 and the platform moved under a group with a roadmap I did
not believe in — more surface area, less depth, a lot of integrations. Nobody was unkind
about it and I was not managed out. I gave three months' notice and left in April 2025.

That is the whole answer. There is no story under it.

## What I am actually looking for

- **A payments or ledger system where correctness is the hard part**, not throughput. I
  am not the right person for an ads pipeline.
- **A team where I own something end to end**, including the on-call for it. I do not want
  to be handed a service somebody else designed and be responsible for its uptime.
- **Somewhere I can write, at length, about the systems I build.** Every write-up in this
  knowledge base was a document I wrote at work first. If that is seen as time not spent
  coding, we will not enjoy each other.
- **Staff-level scope without a management track.** I have managed people. I was
  competent at it and I do not want to do it again.

## What I would turn down, and why

- **A pure platform-migration role.** Twelve months moving a thing from one cloud to
  another is a real job and it is not mine; I would be bored by month three and I would be
  visibly bored, which is worse.
- **A role where the payments logic lives in a vendor and my job is configuring it.** I do
  not need to build everything, but if nobody on the team can explain what happens on a
  failed capture, I am support staff with a better title.
- **Anything that requires me to say I am an ML engineer.** See below.
- **A rate below my band.** I am not going to be talked up from it in the fourth
  conversation, so it is here in the first: **8,000 to 9,500 USD per month, remote,
  contract; 4.2 to 5.0 million THB per year for a permanent role in Bangkok.** If that
  does not clear, say so now and we will both keep our afternoon.

## Where my machine learning actually stands

**Undergraduate level, and roughly seven years stale.** I shipped one gradient-boosted
fraud model at Rialto, it went to production in 2018, and I stopped touching the field in
August 2019.

I can read a paper's abstract and follow a conversation. I could not train a model you
should put in front of customers, I have never worked with transformers in anger, and
everything I know about deployment and monitoring for ML predates the tooling everyone now
uses. If your role is "payments engineer who will also own the risk model", I am half of
that and you should hire the other half.

I am not saying this to be modest. I am saying it because the alternative is finding out
in week three, and because a candidate brief that quietly upgrades this into "ML
experience" has lied to you on my behalf.

## Other limits, while I am at it

- **Frontend.** I can make a React page work and it will look like an engineer made it. I
  would not choose to own one.
- **Kubernetes.** I can operate what I am given and read the yaml. I have never designed a
  cluster and I would defer to anyone who has.
- **Regulatory and licensing.** I have worked inside a licensed entity, and next to
  compliance people, but I am not one and I do not have a view on your licensing strategy.

## How I want the conversation to go

Ask me about a decision I got wrong. There are two obvious candidates in this knowledge
base — the error-only circuit breaker and the missing `deferred` state — and I would
rather spend twenty minutes on either of those than on my CV, which you have already read.
