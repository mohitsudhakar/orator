# ORATOR CURRICULUM SPEC v1

You are authoring modules for **ORATOR**, an elite public-speaking and
executive-communication program. The standard is a top-tier Harvard/Stanford
MBA-level leadership course: rigorous, evidence-informed, scenario-driven,
and ruthlessly practical. No filler, no generic advice, no "be confident" platitudes.

## Audience
A founder/executive who must speak in high-stakes rooms: board meetings,
investor pitches, all-hands, customer calls, conferences, media, and
difficult internal conversations. They are intelligent, time-poor, and
allergic to fluff. They want frameworks they can use the same day.

## Output contract
Each module is ONE JSON file at the exact path given to you.
Files must be strict JSON (no comments, no trailing commas). UTF-8. English only.

### Schema (every key required unless noted)

```
{
  "id": "m07",                       // module id
  "number": 7,                       // integer
  "title": "Delivery Under Pressure",
  "subtitle": "Q&A, hostility, and the unscripted hour",
  "level": "Advanced",              // one of: Foundation, Intermediate, Advanced, Mastery
  "durationMinutes": 90,            // integer, realistic study time
  "outcome": "One sentence: what the learner CAN DO after this module.",
  "abstract": "2-4 sentences framing the module and its importance.",
  "objectives": [                   // 4-6 learning objectives, each starts with a verb
    "Diagnose the three failure modes of live Q&A...",
    "..."
  ],
  "keyTerms": [                     // 8-14 domain terms
    { "term": "Bridge Phrase", "definition": "One-sentence precise definition." },
    ...
  ],
  "concepts": [                     // 5-8 concepts
    {
      "id": "c1",
      "title": "The 4-Second Answer Ladder",
      "summary": "2-4 sentences: the core idea, stated so a smart beginner gets it.",
      "detail": "Markdown. 250-450 words. Concrete, technical, no filler. Use a tight example. Where useful, include a small table or a short bullet list. Name specific researchers, frameworks, or studies where they genuinely apply (Chris Voss's hostage negotiation work, Nancy Duarte's What Is / What Could Be, Chip and Dan Heath's SUCCESs, Mehrabian, Albert Mehrabian's 7-38-55 (use carefully and note its limits), Bjork's desirable difficulties, Miller's 7+/-2, cognitive load theory, the McKinsey pyramid principle, etc.). Do NOT invent fake citations. If unsure a claim is contested, say so.",
      "principles": [                // 3-5 actionable rules
        "Bridge with a restatement BEFORE answering - it buys thinking time and lowers temperature.",
        "..."
      ],
      "pitfalls": [                  // 2-4 common real failures and their fix
        { "failure": "Answering the question you want instead of the question asked.", "fix": "..." },
        ...
      ],
      "imagePrompt": "A clean instructional diagram illustrating <the concept>, flat vector infographic style, muted professional palette, generous white space, labeled callouts, no text labels, no watermarks, high detail, 16:9"  // generate an image for this concept
    }
  ],
  "frameworks": [                   // 3-5 named, memorable, reusable frameworks
    {
      "name": "SCQA",
      "summary": "One-sentence description of what it is for.",
      "steps": [                     // 4-7 ordered steps, each concrete
        "Situation - establish shared context...",
        "..."
      ],
      "whenToUse": "When to reach for it, and when not to.",
      "example": "A concrete worked example in a business context."
    }
  ],
  "scenarios": [                    // 4-6 branching real-world scenarios
    {
      "id": "s1",
      "title": "The hostile investor question",
      "setting": "Series B investor meeting, 8 people, your credibility is on the line.",
      "challenge": "The lead investor interrupts with 'Your churn numbers look engineered. Walk me through it.'",
      "objectives": ["Maintain composure", "Answer precisely without defensiveness"],
      "options": [                    // 3-4 options
        {
          "text": "Defend immediately and at length with all the supporting data.",
          "outcome": "How the room reacts and what it costs you.",
          "rating": "poor",           // one of: poor, fair, good, excellent
          "feedback": "Specific coaching on why this fails and what to do instead."
        }
      ],
      "coachingNote": "The general principle this scenario teaches."
    }
  ],
  "exercises": [                    // 5-7 exercises, at least 2 flagged realWorld and 2 flagged recorded
    {
      "id": "e1",
      "title": "The 90-second cold open",
      "type": "recorded",            // one of: drill, recorded, realWorld, analytical, reflection
      "durationMinutes": 20,
      "instructions": "Precise, executable steps. Exactly what to do, where, and how it is judged.",
      "deliverable": "A 90-second opening recorded on video.",
      "successCriteria": [           // 3-5 observable criteria
        "Opening lands a concrete stake in the first sentence, not context-setting.",
        "..."
      ],
      "liveCoachPrompt": "The exact prompt the AI live coach uses to open this exercise session. Write it as the coach speaks: warm, specific, and immediately actionable. 2-4 sentences."
    }
  ],
  "assessment": {
    "id": "a7",
    "title": "The unscripted hour",
    "brief": "A realistic, high-stakes brief for a capstone performance task.",
    "rubric": [                     // 5-7 dimensions
      {
        "dimension": "Composure under challenge",
        "weight": 20,               // integer; weights sum to 100
        "excellent": "Description of top-band performance.",
        "adequate": "Description of pass-band performance.",
        "poor": "Description of fail-band performance."
      }
    ],
    "passMark": 70
  },
  "readingList": [                  // 4-6
    { "title": "Book Title", "author": "Author Name", "why": "What the learner takes from it and which module it pairs with." }
  ],
  "masteryChecklist": [             // 5-8 observable "I can now..." statements
    "I can take a hostile question and buy myself 10 seconds of thinking time without it reading as evasion.",
    "..."
  ]
}
```

## Non-negotiable quality rules

1. **Real, not generic.** "Maintain eye contact" is worthless. "Hold eye contact for one full thought (~4 seconds) then move to a new person; a full 60-second eye contact with one person reads as a threat" is useful.
2. **Every claim earns its place.** If a concept cannot be acted on Monday morning, cut it.
3. **Scenarios must be business-real.** Series B boards, a fired executive, a 4,000-person all-hands, an analyst day, a wedding toast for your mother. Specific stakes, specific failure modes.
4. **Rubrics must discriminate.** A rubric where "excellent" and "poor" sound the same is worthless. Write them so two different talks get different scores.
5. **No fake precision.** Do not invent statistics, study names, or researcher attributions. Use well-established work only, and flag contested claims as contested.
6. **Length.** Each concept's `detail` is 250-450 words. Modules are substantial. Do not pad.
7. **English only.** No other languages anywhere in the output.
8. **Rubric weights must sum to exactly 100.**

## Module list and ownership

- m01 Foundations: Presence, Credibility, Audience (Foundation)
- m02 Structure: Architecting the Argument (Foundation)
- m03 Openings and Closings: The First 90 Seconds, The Last 30 (Intermediate)
- m04 Language: Precision, Vividness, and Word Economy (Intermediate)
- m05 Voice: Pitch, Pace, Pause, Breath (Intermediate)
- m06 Body: Gesture, Movement, Eye Contact, Stagecraft (Intermediate)
- m07 Delivery Under Pressure: Q&A and Hostility (Advanced)
- m08 Persuasion: Framing, Ethos, Influence, Narrative (Advanced)
- m09 Data, Charts, and Evidence (Advanced)
- m10 Executive Presence and Room Dynamics (Mastery)
- m11 Virtual and Hybrid Presence (Intermediate)
- m12 The Long Game: Thought Leadership and the Speaking Career (Mastery)
