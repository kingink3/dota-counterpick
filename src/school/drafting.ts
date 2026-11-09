// =============================================================================
//  Module 3: Draft and items (ADR-049). The counter mechanisms the engine uses,
//  what items bring, typical builds and timings, reading enemy items, and team
//  composition. Most situations are generated from the knowledge base (taxonomy
//  edges, items.yaml) and the build statistics (STRATZ by position), so they follow
//  each patch's data instead of this text.
// =============================================================================

import type { Module } from "./types.js";

export const DRAFTING: Module = {
  id: "drafting",
  title: "Draft and items",
  patch: "7.41f",
  checked: "2026-11-09",
  lessons: [
    // ------------------------------------------------------------------ 1 ----
    {
      id: "mechanisms",
      title: "Counters are mechanisms",
      lead: "Every counter answers a weakness. Learn the pairs.",
      theory: [
        {
          h: "Weakness and answer",
          p: [
            "A hero is countered when the enemy has the **answer to what he relies on**. The knowledge base behind the Draft tab is built from such pairs. The most important ones:",
            "- **Invisibility** -> **detection** (Sentry Ward, Dust, Gem): seen, the invisible hero can neither start nor escape.",
            "- **Evasion** -> **true strike** (Monkey King Bar, Bloodthorn); passive evasion also falls to **break**.",
            "- **Healing and lifesteal** -> **healing reduction** (Spirit Vessel, Eye of Skadi and others).",
            "- **Illusions and fragile summons** -> **area damage** that clears them and exposes the real hero.",
            "- **Mana-hungry spells** -> **mana burn**.",
            "- **Channeled spells** -> **interrupts**: a stun, hex or cyclone stops the channel.",
            "- **Escapes and blinks** -> **roots** and disables, ideally ones that pierce debuff immunity.",
            "- **Right-click carries** -> **disarm**, **break** of their key passive, or kiting if they are melee.",
            "- **Key passives** (a defining passive ability) -> **break**.",
            "- **Dispellable buffs** (shields, hastes) -> **purge**.",
          ],
        },
        {
          h: "Armor and magic",
          p: [
            "Against **high armor**, bring **magic damage** (it ignores armor) or **armor reduction**. Against **low armor**, physical burst and minus armor are deadly. Against a **fragile** hero, any burst that kills before he acts.",
          ],
        },
        {
          h: "Answers come from heroes and items",
          p: [
            "The same answer can come from a hero's kit or from an item. In the draft you pick the heroes that bring answers; in the game you buy the items for what is still missing.",
          ],
        },
      ],
      quiz: [
        { id: "mc1", q: "The enemy relies on invisibility. What answers it?", options: ["Detection", "Armor", "Mana burn", "Healing reduction"], correct: 0, why: "Detection removes invisibility: the hero can be seen, hit and disabled." },
        { id: "mc2", q: "What answers a channeled ultimate?", options: ["An interrupt: a stun, hex or cyclone", "Healing reduction", "True strike", "More armor"], correct: 0, why: "Interrupting the channel cancels its effect." },
        { id: "mc3", q: "Which two answers remove passive evasion?", options: ["True strike and break", "Mana burn and armor", "Detection and purge", "Healing reduction and silence"], correct: 0, why: "True strike ignores the miss chance; break turns off passive evasion abilities." },
        { id: "mc4", q: "The enemy carry heals himself constantly. What answers it?", options: ["Healing reduction", "Detection", "A save", "Mana burn"], correct: 0, why: "Cutting healing collapses a sustain-based hero's survivability." },
        { id: "mc5", q: "Against a high-armor enemy, which damage works best?", options: ["Magic damage (or armor reduction first)", "Physical damage", "Pure armor stacking on yourself", "Healing"], correct: 0, why: "Magic damage ignores armor; armor reduction makes physical damage land again." },
        { id: "mc6", q: "What does break do?", options: ["Turns off passive abilities", "Breaks items", "Stuns for a long time", "Removes invisibility"], correct: 0, why: "Break disables a hero's passives - including a defining one like evasion or a damage steroid." },
      ],
      situations: [],
      generated: "mechanism",
      practice: [
        { id: "answers", text: "Buy the answer to whoever is killing you (no 'missing answer' finding in Review).", need: 2, of: 3 },
      ],
    },
    // ------------------------------------------------------------------ 2 ----
    {
      id: "itemtools",
      title: "What items bring",
      lead: "An item is a tool: know which one you are buying.",
      theory: [
        {
          h: "Items as answers",
          p: [
            "Most big items do several things, but each has a **main reason to buy it** against an enemy: a silence, true strike, detection, healing reduction, a dispel, a disable. When you open the shop in a game, decide the reason first and the item second.",
          ],
        },
        {
          h: "Same answer, different items",
          p: [
            "Several items can give the same answer: a support's Spirit Vessel and a carry's Eye of Skadi both cut healing. Pick the one that fits **your hero** - its stats and the role you play - and agree with your team who buys what (the Draft tab marks an answer a teammate usually builds).",
          ],
        },
      ],
      quiz: [
        { id: "it1", q: "Which item answers invisible enemies?", options: ["Gem of True Sight (or Sentry Ward / Dust)", "Black King Bar", "Blink Dagger", "Power Treads"], correct: 0, why: "Gem, Sentries and Dust give detection." },
        { id: "it2", q: "Which item gives true strike?", options: ["Monkey King Bar", "Desolator", "Battle Fury", "Glimmer Cape"], correct: 0, why: "Monkey King Bar (and Bloodthorn) make attacks unable to miss." },
        { id: "it3", q: "Which item gives break?", options: ["Silver Edge", "Orchid Malevolence", "Rod of Atos", "Desolator"], correct: 0, why: "Silver Edge's active applies break to the hero it hits from invisibility." },
        { id: "it4", q: "Two teammates both want to buy Spirit Vessel. What is better?", options: ["Agree: one buys it, the other buys a different answer", "Both buy it", "Nobody buys it", "Sell it after 10 minutes"], correct: 0, why: "The second copy adds little; the gold is better spent on what is still missing." },
      ],
      situations: [],
      generated: "itemtool",
      practice: [],
    },
    // ------------------------------------------------------------------ 3 ----
    {
      id: "builds",
      title: "Typical builds",
      lead: "What players actually build - and why to deviate.",
      theory: [
        {
          h: "Core and situational",
          p: [
            "Every hero has **core items** that make its kit work and are built in most games, and **situational items** that answer this game's enemy. The Game tab's item plan shows both, from recent public matches at your position.",
            "Follow the core unless the game clearly asks for something else; deviate for a reason, not for variety. The Review tab calls out a build that worked even when it was not the usual one.",
          ],
        },
        {
          h: "Builds depend on the position",
          p: [
            "The same hero builds differently as a carry and as a support: a position 5 has little gold and buys utility and saves; a core buys damage and survival. Compare yourself with builds **at your position**, not the hero's most famous build.",
          ],
        },
      ],
      quiz: [
        { id: "bu1", q: "What is a core item?", options: ["One that makes the hero's kit work and is built in most games", "The most expensive item", "Any item bought first", "An item only supports buy"], correct: 0, why: "Core items are the hero's backbone; situational items answer the enemy." },
        { id: "bu2", q: "When should you skip your usual next core item?", options: ["When the game clearly needs an answer first (e.g. detection, BKB)", "Never", "Always, for variety", "When you have too much gold"], correct: 0, why: "An unanswered threat can lose the next fight before the core item matters." },
        { id: "bu3", q: "You play a hero as position 5. Whose builds should you compare yourself with?", options: ["Players of that hero at position 5", "The hero's carry builds", "Any professional carry", "Your teammates' builds"], correct: 0, why: "Gold and job differ by position; a support build and a carry build of the same hero have little in common." },
      ],
      situations: [],
      generated: "builds",
      practice: [],
    },
    // ------------------------------------------------------------------ 4 ----
    {
      id: "timings",
      title: "Item timings",
      lead: "When the item usually arrives - and what that number means.",
      theory: [
        {
          h: "What a timing is",
          p: [
            "A **timing** is when players usually finish an item. Getting a core item early makes your hero strong while the enemy is not ready yet; a very late core item often means the plan has failed.",
            "Be careful with the numbers: players who finish an item early **win more**, but partly because they were **already ahead** - richer games buy faster. A timing is a benchmark for your farm, not a promise that rushing the item wins.",
          ],
        },
        {
          h: "Using timings in a game",
          p: [
            "Know roughly when your core item and the enemy carry's core item should come. If yours is on time and theirs is not, that is the moment to fight; if the enemy's key item has just arrived, avoid an even fight until yours does.",
          ],
        },
      ],
      quiz: [
        { id: "ti1", q: "Players who finish an item early win more often. Why is that not proof that rushing it wins?", options: ["They were often already ahead: richer games buy faster", "Because timings are random", "Because items do nothing", "Because the data is from bots"], correct: 0, why: "The early buyers are mostly the ones already winning; the item is part of it, not all of it." },
        { id: "ti2", q: "Your core item comes far later than usual. What does it most likely mean?", options: ["Your farm is behind: look for lost time (deaths, idle minutes)", "The item is broken", "You are winning", "Nothing"], correct: 0, why: "A late timing is a symptom; the cause is usually lost farm." },
        { id: "ti3", q: "The enemy carry's key item has just arrived and yours is two minutes away. What is usually right?", options: ["Avoid an even fight until your item is ready", "Fight right now", "Sell your components", "Push the enemy high ground"], correct: 0, why: "Fight when the timing favours you; a fresh enemy item and a missing one of yours is the worst moment." },
      ],
      situations: [],
      generated: "timing",
      practice: [
        { id: "nw20", text: "As position 1, 2 or 3: reach the ranked average net worth at 20:00.", roles: [1, 2, 3], need: 2, of: 3 },
      ],
    },
    // ------------------------------------------------------------------ 5 ----
    {
      id: "enemyitems",
      title: "Reading enemy items",
      lead: "What the enemy bought tells you how to fight him.",
      theory: [
        {
          h: "Defensive items change your plan",
          p: [
            "- **Black King Bar**: debuff immunity for a few seconds. Wait it out, kite, or use disables that pierce it; do not waste your stuns into it.",
            "- **Linken's Sphere**: blocks one targeted spell. Pop it with a cheap targeted spell or item first, then cast the one that matters.",
            "- **Aeon Disk**: when the holder falls low, it saves him once. Plan to kill him twice, or keep a disable for after it.",
            "- **Manta Style**: a strong self-dispel. Silences and roots on him can be removed - time them after Manta is used.",
            "- **Butterfly**: evasion. True strike (Monkey King Bar, Bloodthorn) or magic damage.",
            "- **Blink Dagger**: the hero can start or escape a fight from a distance - keep vision and do not stand in a clump.",
          ],
        },
        {
          h: "Seeing the items",
          p: [
            "Click an enemy hero to see his items, or let the Game tab read them from the screen. Check the enemy's key items before every big fight.",
          ],
        },
      ],
      quiz: [
        { id: "ei1", q: "The enemy carry activates Black King Bar. What do you do with your stun?", options: ["Keep it until BKB ends (unless it pierces)", "Use it immediately", "Use it on a creep", "Sell your item"], correct: 0, why: "Most disables do nothing through debuff immunity; the same stun after BKB decides the fight." },
        { id: "ei2", q: "How do you get through Linken's Sphere?", options: ["Pop it with a cheap targeted spell or item first", "Cast your strongest spell first", "Use an area spell only", "You cannot"], correct: 0, why: "Linken's blocks one targeted spell, then goes on cooldown." },
        { id: "ei3", q: "The enemy has Aeon Disk. What should your team plan for?", options: ["Kill him twice or keep a disable for after it saves him", "Ignore him", "Only use magic damage", "Buy Aeon Disk too"], correct: 0, why: "Aeon Disk stops one kill; the second burst or the saved disable finishes him." },
        { id: "ei4", q: "Why time your silence after the enemy uses Manta Style?", options: ["Manta dispels it", "Manta makes him invisible", "Manta gives debuff immunity for 10 seconds", "Silence does not work on carries"], correct: 0, why: "Manta's activation removes many debuffs: wait until it is on cooldown." },
      ],
      situations: [
        { id: "eis1", scene: "Team fight. The enemy carry has Black King Bar active for a few more seconds; your hard disable does not pierce it.", q: "What is best?", options: ["Hold the disable, kite him, hit the others; disable him when BKB ends", "Use the disable now", "Retreat from the fight completely", "Use the disable on yourself"], correct: 0, why: "Wasting the disable into immunity is the most common team-fight mistake." },
        { id: "eis2", scene: "The enemy mid has Linken's Sphere. You have a hex and a cheap targeted item.", q: "In what order?", options: ["Cheap targeted item first, then the hex", "Hex first", "Hex twice", "Only area spells"], correct: 0, why: "The first targeted spell breaks Linken's; the second one lands." },
      ],
      practice: [],
    },
    // ------------------------------------------------------------------ 6 ----
    {
      id: "composition",
      title: "Team composition",
      lead: "Five heroes, one plan: what every lineup needs.",
      theory: [
        {
          h: "What a lineup needs",
          p: [
            "The Draft tab checks your team for the needs below and suggests heroes that fill a gap:",
            "- **Reliable disable**: something that holds a target still.",
            "- **Control through BKB**: a disable that pierces debuff immunity, for the enemy carry's BKB.",
            "- **Wave clear / area damage**: to defend towers and clear illusions and summons.",
            "- **A save**: to keep an ally alive when he is caught.",
            "- **Purge**: to remove the enemy's shields and hastes.",
            "- **Damage mix**: if almost all your damage is physical (or magical), one kind of defense answers your whole team.",
          ],
        },
        {
          h: "A plan and a timing",
          p: [
            "Lineups are strong at different times: early-pressure heroes want to fight and push before 20 minutes; late carries want time. Know which your team is - and play to it: an early lineup that farms quietly gives away its window.",
          ],
        },
      ],
      quiz: [
        { id: "co1", q: "Why does a lineup need control that pierces BKB?", options: ["The enemy carry will buy BKB; normal disables stop working on him", "BKB is not in the game", "To clear creep waves", "To heal allies"], correct: 0, why: "Late fights are decided on the enemy carry; most disables do nothing through debuff immunity." },
        { id: "co2", q: "What does wave clear give your team?", options: ["Defense of towers and clearing illusions and summons", "More armor", "True strike", "Mana"], correct: 0, why: "Area damage cleans waves and illusion or summon armies." },
        { id: "co3", q: "Your lineup is strong early and weak late. What should it do?", options: ["Fight and push before ~20 minutes", "Farm until 40 minutes", "Avoid all fights", "Only defend"], correct: 0, why: "An early lineup that waits gives the enemy's late heroes the time they need." },
      ],
      situations: [
        { id: "cs1", scene: "Your four picks: two right-click carries, a right-click offlaner and a support with only physical damage. Last pick.", q: "What does the last pick most need to bring?", options: ["Magic damage (and a disable)", "A third right-click carry", "Another physical-damage support", "Nothing: damage type does not matter"], correct: 0, why: "Almost all-physical damage means armor items answer your whole team; magic damage breaks that." },
        { id: "cs2", scene: "The enemy has an illusion carry and a summoner. Nobody on your team deals area damage.", q: "What is the gap?", options: ["Wave clear / area damage", "Healing reduction", "Detection", "Mana burn"], correct: 0, why: "Area damage clears illusions and fragile summons; without it your team is overrun." },
      ],
      generated: "draft",
      practice: [
        { id: "answers", text: "Buy the answer to whoever is killing you (no 'missing answer' finding in Review).", need: 2, of: 3 },
      ],
    },
  ],
};
