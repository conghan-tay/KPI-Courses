# NodusArt — what this actually is

NodusArt is a small company doing provenance records for physical artworks. I have an
advisory seat. Recruiters see "web3" on my profile and I would rather answer this before
it gets assumed into something it is not.

## The honest scope

**I am an unpaid advisor. No commits, no equity, no on-call.** I have written zero lines of
code in their repository. I am not a founding engineer, I am not a contractor, I did not
build their smart contracts, and I would push back on a CV that implied any of those.

What it is: a founder I know from Bangkok calls me every few weeks and I tell him what I
think about an architecture decision. Sometimes I read a design document. That is the
entire relationship, and it is worth something — but it is worth what it is, not what it
would sound like with the word "engineer" attached.

If you are screening for a blockchain engineer, I am not one, and neither of us should
spend twenty minutes finding that out.

## The one piece of advice worth repeating

They wanted to put the full provenance record on-chain. Every attribution, every transfer,
every condition report, immutable, forever.

I argued for putting **a content hash of the record plus a timestamp** on-chain, and
keeping the record itself in ordinary storage.

Two reasons, and the second is the one that changed the decision:

**Cost.** Roughly two orders of magnitude cheaper. A provenance record with images and
condition reports is not small, and on-chain storage is priced as if every byte is
precious because it is.

**And the one that actually matters: provenance records are wrong sometimes.** An
attribution gets revised. A date turns out to be off by a decade. A condition report was
filed against the wrong piece. If the record is immutable, your options when it is wrong
are to leave a lie on the chain forever or to write a correction that a reader has to know
to look for. Hashing gives you **editable-with-history**: the record can be corrected, and
every version of it is still provably the version that existed at a given time. That is
what people actually want when they say "immutable". They want *tamper-evident*, and those
are not the same word.

The general form, which is mine and which I will defend: **immutability is a property you
should apply to the evidence, not to the claim.** Claims get revised. If your architecture
cannot express "this was true then and is not true now", it will eventually be confidently
wrong in public.

## What I would not claim

I could not build a production chain integration for you without ramping up, I have never
audited a contract, and I have no opinion worth paying for about which chain to use. My
value there is that I have seen a lot of systems make one specific class of mistake, not
that I know this domain.
