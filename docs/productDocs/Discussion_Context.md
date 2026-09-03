# Design discussion — the chat-native tutoring product **(superseded)**

> **This is an archive, not a spec.** It records the conversation that produced the
> original product: a Specialist publishing a course, a Seeker buying it, and learning
> through chat. That product was replaced by the reverse interview — see
> [`POC_UserJourney.md`](POC_UserJourney.md) and
> [`TheReverseInterview/originalIdea.txt`](TheReverseInterview/originalIdea.txt).
>
> It is kept because several decisions carried over intact and the reasoning is here
> rather than in the new doc: why the review screen defaults to the *opinionated* tab
> rather than the structural one, why there are no star ratings, why a thin extraction
> gets a reframe instead of an apology, and why the demo fixture is a fictional person.
> Everything about courses, lessons, positions and voice cards below is dead.

---

# Claude UJ chat
 
> 
> 
> 
> Project Thesis:
> Learn faster from private tutoring and coaching.  A Key Person of Influence (KPI) is a well-known, highly valued, and trusted leader within a specific industry. Highly sought after for their opinions and experience.  But 1 KPI have only that much time, energy and can be a place at any one time. This idea extends to consultation, mentoring, online education. In order to quickly onboard and learn something new, I will search for courses, reviews, filter, sort and judge for myself who is the most credible. And buy and take his course. Everyone else doesn't matter.  Everyone wants only the best from the best.  It follows the Pareto principle. Web was a new medium/channel then became specifically blogs then became Video. Now we have chat, a new channel and interface to share knowledge and share it interactively. Core idea: The app will initially be a web app. 2 Entities, Specialist and Seeker. The Specialist will upload courses/topics/subjects, which the Seeker can buy access to. The delivery will be an interactive chat.
> Role : Expert Software Product designer, expert in UX/UI, expert in human computer interaction
> Task : Your job is not to critic my idea, but design key User journeys, so as a software engineer, I can quickly prototype this idea over the weekend. Keep it to 3 key user journeys, nothing more. Ideally keep it straightforward. It should be a POC and don't need to involve heavy algorithms, intensive compute, proprietary information or deep research. If necessary an LLM, an agentic loop can be implemented. For the POC, I imagine nothing more than a Frontend -> Api Backend -> Agentic Loop, Databases , etc.
> If necessary ask me any clarifying questions then start designing.
> 
 
> 
> 
> 
> I'll design against your constraints and state my assumptions inline rather than block you with questions — the ones I'd ask (payments real or stubbed? auth? RAG or not?) all have an obvious weekend-scoped answer, and I've picked it.
> 
> One design decision worth flagging up front, because it shapes all three journeys: the thing a Seeker is buying is not the *information* (that's free and abundant) — it's the Specialist's **opinionated position** on contested questions. So the ingestion step extracts a "Positions & Hot Takes" list, and the tutor is instructed to defend those stances rather than give balanced Wikipedia answers. That's also what makes the free sample chat function as a review: two minutes of arguing with someone's actual worldview tells you more about credibility than 200 star ratings.Three journeys: **publish → evaluate → learn**, with screens, data model, API routes, tool definitions, prompt sketches, and a Sat/Sun build order.
> 
> Four choices in there that are opinions rather than neutral defaults, so you can overrule them:
> 
> - **No RAG.** Whole course in the system prompt. Embeddings would eat half your weekend and buy nothing at 60k tokens.
> - **No star ratings.** The free sample chat *is* the review — averaged stars re-outsource the credibility judgment your thesis says the Seeker wants to make themselves, and it saves you a subsystem.
> - **The sample chat wall lands mid-conversation**, not at a banner. Cutting off when it gets good is the whole conversion argument.
> - **Build Journey 3 first, with a hand-made course.** If the chat isn't compelling before you've built any ingestion, ingestion polish won't rescue it.
> 
> The riskiest assumption I made: that Specialists will happily edit a screen full of their own extracted hot takes. If that feels wrong for the experts you have in mind, tell me and I'll redesign Journey 1 around something less exposed.
> 
 
> I have questions. `tagline` is that a description of the course?
> 
 
> 
> 
> 
> Yes, but a very short one — one line, ~10 words, written by the Specialist. It's the subtitle under the title on the catalog card and course hero.
> 
> ```
> title:   "Pricing for B2B SaaS"
> tagline: "Stop guessing. Charge more than feels comfortable."
> ```
> 
> I deliberately didn't give you a longer `description` field, for two reasons:
> 
> 1. **The course page has no room for one.** The space where a description would go is taken by the positions cards and the sample chat — that's the pitch. A paragraph of marketing prose competes with them and loses.
> 2. **It's a field Specialists procrastinate on.** Title, tagline, price is a form you can fill in 30 seconds; add a description box and drafts sit unpublished.
> 
> If you find the catalog cards feel thin, the cheap fix isn't a description field — it's rendering the first `positions[0].claim` under the tagline. Free, and it's the more interesting sentence anyway.
> 
> Add `description text` if you want it, but make it optional and put it below the fold on `/c/:slug`.
> 
 
> Let's walk through an example of a Specialist. Let's go with Alex hormozi, [https://www.acquisition.com/team/bio-alex](https://www.acquisition.com/team/bio-alex) .  What would a hypothetical sample course and result lessons, voice_card and positions look like?
> 
 
> 
> 
> 
> Good test case — his material is unusually position-dense, which makes it flattering. I'll flag at the end why that matters.
> 
> One thing worth noting from his site: Acquisition.com's footer explicitly reserves rights over the content and ideas on the site, and he already sells his own Offers, Leads, Money Models and Scaling courses directly. So the only legitimate version of this is Alex himself uploading his own manuscripts — which is exactly your model, but it means your ingestion output is a *derivative of a real person's identity*. More on that at the bottom.
> 
> **Hypothetical input:** he drops in the $100M Offers manuscript + ~20 podcast transcripts. ~180k words. Ingestion runs.
> 
> ---
> 
> ### `courses`
> 
> ```
> title:      "Offers: Make It Stupid To Say No"
> tagline:    "The product isn't the problem. Your offer is."
> price:      $299
> ```
> 
> ### `lessons[]`
> 
> | # | title | objective |
> | --- | --- | --- |
> | 1 | Pick a Starving Crowd | Can name a market with pain, buying power, and easy targeting — and reject one that fails any of the three |
> | 2 | Stop Competing on Price | Can articulate why their current pricing is a commodity trap |
> | 3 | The Value Equation | Can score any offer on dream outcome, perceived likelihood, time delay, and effort |
> | 4 | Build the Grand Slam Offer | Can stack solutions to every objection into one offer |
> | 5 | Guarantees That Aren't Suicide | Can pick a guarantee structure that shifts risk without inviting abuse |
> | 6 | Scarcity, Urgency, Bonuses, Naming | Can apply the four enhancers without sounding like a late-night infomercial |
> | 7 | Price It Higher Than Feels Safe | Can defend their number out loud, to a real prospect |
> 
> Objectives are capabilities, not topics — note lesson 7 ends in "out loud, to a real prospect," which gives `quiz()` something to actually test.
> 
> ### `voice_card`
> 
> ```json
> {
>   "register": "direct, declarative, short sentences; blue-collar framing of
>                white-collar concepts; numbers over adjectives",
>   "pet_peeves": ["blaming the market", "discounting to win",
>                  "waiting to feel ready", "consuming content instead of shipping"],
>   "signature_moves": ["reframes a whining question into a math question",
>                       "answers with the constraint, not the tactic",
>                       "asks what you actually charge before anything else"],
>   "refuses_to": ["give a tactic before the offer is fixed"]
> }
> ```
> 
> ### `positions[]` — paraphrases of stances he argues publicly
> 
> ```json
> [
>   { "claim": "If you have to sell hard, your offer is broken.",
>     "because": "Persuasion is a tax you pay for a weak offer. Fix the offer and the selling gets easy.",
>     "pushback": "But my closing rate is fine → then you're leaving price on the table, not proving the offer works." },
> 
>   { "claim": "Lowering price is the most expensive decision you'll make.",
>     "because": "It shrinks margin, attracts the worst customers, and removes the budget you'd need to get better ones.",
>     "pushback": "My competitors are cheaper → you picked a market where you're indistinguishable. That's a market problem." },
> 
>   { "claim": "The market matters more than your skill.",
>     "because": "A great operator in a dying market loses to a mediocre one in a starving crowd.",
>     "pushback": "But I love this niche → love it on weekends." },
> 
>   { "claim": "Charge more than is comfortable.",
>     "because": "Higher price raises perceived value and buyer commitment, which raises results, which justifies the price.",
>     "pushback": "My customers can't afford it → different customers can. That's the point." },
> 
>   { "claim": "Volume beats cleverness.",
>     "because": "Most people fail at a sample size too small to have learned anything.",
>     "pushback": "I don't want to spam → do it well, just do far more of it than feels reasonable." }
> ]
> ```
> 
> ---
> 
> ### What the Seeker actually pays for
> 
> Look at the `pushback` column. That's the asset, and it's the thing a PDF, a YouTube video, and a generic LLM all can't deliver: **it only fires when you personally object.** A reader of the book gets claim + because. A Seeker in the chat says *"my competitors are cheaper"* and gets the counter aimed at them, then gets asked what they charge.
> 
> Mechanically, on the course page you'd render the five `claim` lines and blur `because` — five sentences a prospect either finds obvious or finds provocative. That's a faster credibility read than any review section.
> 
> ---
> 
> ### Two honest caveats about this example
> 
> **1. He's the easy case, and that will mislead your testing.** His entire corpus is contrarian assertions with a named framework attached — ingestion extracts five sharp positions almost trivially. A pharmacology professor, a Figma teacher, or a solid-but-conventional consultant will produce material where the honest answer is *"we found 1 position; the rest is craft."* Design that empty state before you demo, or your first non-Hormozi Specialist will hit a screen that says their opinions aren't interesting. My suggested fallback: when positions come back thin, switch the review screen's default tab to Syllabus and reframe the pitch as *"where students get stuck"* rather than *"what you believe."*
> 
> **2. Don't seed your demo with a real person.** The output above is a paraphrase of public positions, which is fine as a design exercise — but a *shipped* tutor that talks in Alex Hormozi's voice, without Alex Hormozi, is an impersonation problem and a rights problem, and it's the one thing that could make your demo unshowable. For the weekend build, seed with a fictional specialist, or with yourself on something you actually have opinions about. The mechanic demos identically.
> 
 
> I do not understand `THE SAMPLE CHAT (the conversion mechanism)` from Journey 2. Did you leave out the prompt for that or do I just reuse `Tutor system prompt`
> 
 
> 
> 
> 
> I left it out — and it should *not* reuse the tutor prompt. Different job, different context, and the difference is load-bearing.
> 
> **Why they can't be the same prompt:**
> 
> |  | Tutor (`/api/chat`) | Sample (`/api/sample/:slug`) |
> | --- | --- | --- |
> | Gets `source_text` + lesson bodies | Yes | **No** — positions + voice card only |
> | Tools | 4 | None |
> | Goal | Teach until mastery | Prove one person is worth $299, then stop |
> | Turn limit | none | 5, enforced server-side |
> 
> The critical line is row one. If the sample chat can read the lesson bodies, a determined prospect extracts the course in five turns and never buys. Withholding the material isn't a limitation to apologize for — it's what makes the sample chat cheap to run and safe to expose.
> 
> ### Sample chat prompt
> 
> ```
> You are {name}. A stranger is deciding whether you're worth paying for.
> You have {5 - turns_used} exchanges left.
> 
> VOICE: {voice_card}
> POSITIONS you hold: {positions}          // claim, because, pushback
> 
> You do NOT have the course material. You cannot teach the frameworks,
> give step-by-step instructions, or name your internal models. You have
> your opinions and your judgement, nothing else.
> 
> Your job in five turns:
> 1. Make one of your positions land hard. Assert it, don't hedge.
> 2. Ask what THEY are doing — specifically. Numbers, not adjectives.
>    ("What do you charge?" "How many did you send last week?")
> 3. React to their actual answer. Diagnose the constraint you can see.
>    This is the moment they decide you're real. Do not be generic.
> 4. If they disagree, defend using `pushback`. Do not soften to be liked.
> 
> Never: list steps, produce a framework, write anything they could paste
> into a doc, or say "the course covers that." If they ask for the how,
> give them the WHY it matters and the cost of getting it wrong — then
> move back to their situation.
> 
> Do not mention price, buying, or the course. Someone else handles that.
> ```
> 
> That last line matters. Nothing kills a demo faster than a persona that pitches. The wall does the selling; the persona just has to be worth listening to.
> 
> ### The wall is UI, not prompt
> 
> Don't ask the model to cut itself off — it'll do it inconsistently and often mid-sentence apologetically. Server-side:
> 
> ```
> turns = count(user messages)
> if turns >= 5:  return { walled: true, last_reply: <stream turn 5 fully> }
> ```
> 
> Then the client renders, below the final reply, styled as a system card rather than a chat bubble:
> 
> > **You're 5 messages in and he's already found your constraint.**
> There are 7 lessons and he'll keep asking until you can defend your number out loud.
> `[ Get access — $299 ]`
> > 
> 
> Turn 5 completes normally and in character. The wall lands *after* a satisfying answer, not instead of one — that's the mid-thought effect I meant. Feeling cut off mid-sentence reads as broken; feeling like the conversation was just getting somewhere reads as expensive.
> 
> ### One free upgrade
> 
> Step 2 of that prompt makes the prospect state their situation out loud. Pass the sample transcript to `/checkout` and prefill the goal field:
> 
> > **What are you trying to do in the next 30 days?**`[ You said you charge $2k and close about 1 in 10. ]`
> > 
> 
> Costs you one extra param, and it makes the paid session open already knowing them — the handoff from "trial" to "enrolled" stops feeling like a reset.
>