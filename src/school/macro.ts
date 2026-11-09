// =============================================================================
//  Module 4: Macro (ADR-050). Objectives, vision and Smoke, Roshan, pushing and the
//  high ground, when to fight and when to farm, defending and coming back.
//  Facts: Roshan has two dens since 7.38 - one active by day, one by night, the active
//  one marked on the minimap; one Tormentor, opposite Roshan (Hawk Live, 7.38). Respawn
//  timings from data/timings.yaml. Durable rules otherwise; drop tables and exact
//  numbers that change by patch are left out.
// =============================================================================

import type { Module } from "./types.js";

export const MACRO: Module = {
  id: "macro",
  title: "Macro",
  patch: "7.41f",
  checked: "2026-11-09",
  lessons: [
    // ------------------------------------------------------------------ 1 ----
    {
      id: "objectives",
      title: "Objectives and priorities",
      lead: "Kills are a means. Buildings, Roshan and Tormentor are the ends.",
      theory: [
        {
          h: "What lasts",
          p: [
            "A kill gives gold for a moment; a **tower** is gone for the rest of the game. Towers give team gold, push the enemy's safe area back and open their jungle to you. **Barracks** make your lane stronger for good. **Roshan** gives the Aegis (an extra life) and items; **Tormentor** gives an Aghanim's Shard.",
            "After every won fight ask: **what can we take now** - a tower, Roshan, Tormentor - before the enemy is back?",
          ],
        },
        {
          h: "Trading objectives",
          p: [
            "If the enemy takes something you cannot defend, take something of equal value elsewhere instead of walking into a lost fight: their tower for your tower, Roshan for a pair of towers. Losing an objective for nothing is the real mistake.",
          ],
        },
      ],
      quiz: [
        { id: "ob1", q: "You won a fight; three enemies are dead for 40 seconds. What is usually the best next step?", options: ["Take a tower or Roshan before they respawn", "Go back to farming at once", "Chase the last enemy into his fountain", "Wait in the river"], correct: 0, why: "A won fight is a window: convert it into something permanent." },
        { id: "ob2", q: "Why is a tower worth more than a kill in the long run?", options: ["It is gone for the rest of the game and opens the map", "It gives more experience", "Towers respawn slower than heroes", "It is not worth more"], correct: 0, why: "Kills fade; a lost tower pushes the enemy's safe area back for good." },
        { id: "ob3", q: "The enemy pushes your tower with five heroes; you cannot win that fight. What is often best?", options: ["Take an equal objective elsewhere", "Fight 4v5 under the tower", "Do nothing", "All go to the fountain"], correct: 0, why: "Trading objectives keeps the game even instead of losing a fight and the tower." },
      ],
      situations: [
        { id: "obs1", scene: "Minute 24. Your team wins a fight near Roshan's active den; two enemies are dead, the others are low and retreating.", q: "What do you do?", options: ["Take Roshan now", "Chase into their base", "Split up to farm", "Wait for the enemy to come back"], correct: 0, why: "Roshan next to a won fight is the cheapest Aegis you will get." },
        { id: "obs2", scene: "Minute 30. The enemy smokes and takes your bottom Tier 2; your team is on the top side of the map.", q: "What is the best answer?", options: ["Push the enemy's top tower at the same time", "Run across the map into five enemies", "Go back to base and wait", "Farm the jungle"], correct: 0, why: "Trade: their bottom push is answered by your top push, not by a lost fight." },
      ],
      practice: [
        { id: "kp", text: "Take part in at least half of your team's kills.", need: 2, of: 3 },
      ],
    },
    // ------------------------------------------------------------------ 2 ----
    {
      id: "vision",
      title: "Vision, Smoke and map control",
      lead: "The team that sees first decides the fight.",
      theory: [
        {
          h: "Defensive and offensive wards",
          p: [
            "**Defensive** wards protect your farm: entrances to your jungle and lanes, so ganks are seen in time. **Offensive** wards go into the enemy's half: you see their farm, catch heroes alone, and plan Roshan or Tormentor.",
            "Ward **ahead of the next objective**, not where the last fight was. Remove enemy wards around your farm with sentries.",
          ],
        },
        {
          h: "Smoke of Deceit",
          p: [
            "Smoke hides your group until you come close to enemy heroes or towers. Use it to **move unseen** to a gank, to Roshan, or out of a dangerous area. A good smoke ends in a kill or an objective; a smoke into empty jungle wastes it.",
          ],
        },
        {
          h: "Map awareness",
          p: [
            "Look at the minimap every few seconds. Missing enemy heroes are coming somewhere: if three are not visible, assume they are near you and play safer.",
          ],
        },
      ],
      quiz: [
        { id: "vi1", q: "Where should wards go before a Roshan attempt?", options: ["Around the active den and its entrances, before the team goes in", "In your own base", "In the enemy fountain", "Nowhere"], correct: 0, why: "Roshan fights are decided by who sees whom first." },
        { id: "vi2", q: "Three enemy heroes have disappeared from the map. What do you assume?", options: ["They may be coming for you: play safer", "They went home", "They are farming the far jungle for sure", "Nothing"], correct: 0, why: "Missing heroes are the most common cause of ganks." },
        { id: "vi3", q: "What is an offensive ward for?", options: ["Seeing the enemy's farm and movement in their half", "Protecting your fountain", "Healing", "Stacking camps"], correct: 0, why: "Offensive vision finds lone heroes and enemy plans." },
        { id: "vi4", q: "When does Smoke of Deceit stop hiding you?", options: ["When you come close to enemy heroes or towers", "After exactly 5 seconds", "When you cast any spell", "Never"], correct: 0, why: "Smoke breaks when you come near enemy heroes or towers." },
      ],
      situations: [
        { id: "vis1", scene: "Minute 18. Your carry farms the enemy's jungle; you have no vision there.", q: "What protects him best?", options: ["Wards on the entrances around him, and watching the map", "A second carry farming next to him", "Buying him Boots of Travel", "Nothing: jungle is safe"], correct: 0, why: "Vision on the paths in is what turns a gank into a warning." },
      ],
      practice: [
        { id: "observers", text: "As position 4 or 5: place at least 10 observer wards.", target: 10, roles: [4, 5], need: 2, of: 3 },
        { id: "dewards", text: "As position 4 or 5: destroy at least 3 enemy wards.", target: 3, roles: [4, 5], need: 2, of: 3 },
      ],
    },
    // ------------------------------------------------------------------ 3 ----
    {
      id: "roshan",
      title: "Roshan and Tormentor",
      lead: "When to take them, how to take them, how to stop the enemy.",
      theory: [
        {
          h: "Where and when",
          p: [
            "Roshan has **two dens**: one active by day, the other at night - the active den is **marked on the minimap**. After a kill he returns **8-11 minutes** later; count from the kill.",
            "There is **one Tormentor**, on the opposite side of the map from Roshan. It first appears at **20:00** and returns 10 minutes after it is killed.",
          ],
        },
        {
          h: "Taking Roshan",
          p: [
            "Take Roshan when the enemy **cannot contest**: after a won fight, with enemies dead or far away, or with vision showing them elsewhere. Ward and deward around the den first. A failed Roshan fight - caught inside the pit at low health - can lose the game.",
            "The **Aegis** gives its holder one extra life: give it to the hero who wins the next fight - usually the carry.",
          ],
        },
        {
          h: "Stopping the enemy",
          p: [
            "Know the timer. If the enemy disappears around the time Roshan may be up, check the den with a ward or a scout, and be ready to fight them while they are weakened by Roshan.",
          ],
        },
      ],
      quiz: [
        { id: "ro1", q: "How long after a kill can Roshan be back?", options: ["8 to 11 minutes", "Exactly 5 minutes", "1 minute", "He does not return"], correct: 0, why: "Since 7.38 the respawn is random between 8 and 11 minutes." },
        { id: "ro2", q: "How do you know which den Roshan is in?", options: ["The active den is marked on the minimap (one by day, one by night)", "Always the same den", "You have to scout both every time", "Only the team that killed him knows"], correct: 0, why: "Since 7.38 Roshan switches dens with day and night; the minimap shows the active one." },
        { id: "ro3", q: "Who usually gets the Aegis?", options: ["The hero who wins the next fight - usually the carry", "The support with the least gold", "Whoever picks it up first", "Nobody: it is sold"], correct: 0, why: "An extra life is worth most on the hero the team fights around." },
        { id: "ro4", q: "When is a Roshan attempt risky?", options: ["When the enemy is alive, unseen and can reach the pit", "After a won fight", "When three enemies are dead", "With vision around the den"], correct: 0, why: "Being caught in the pit at low health is how teams throw." },
        { id: "ro5", q: "Where is the Tormentor relative to Roshan?", options: ["On the opposite side of the map", "Next to Roshan", "In the middle lane", "In each team's base"], correct: 0, why: "There is one Tormentor, always opposite Roshan's active den." },
      ],
      situations: [
        { id: "ros1", scene: "Roshan was killed at 21:00. It is 29:30; the enemy team has disappeared from the map.", q: "What is most likely and what do you do?", options: ["They may be at Roshan: check the active den and prepare to fight them there", "Nothing: Roshan cannot be up yet", "Go to their base", "Farm safely in your jungle"], correct: 0, why: "29:30 is inside the 8-11 minute window after 21:00 (29:00-32:00)." },
        { id: "ros2", scene: "Your team wants Roshan; two enemy heroes are visible farming the far side, three are unseen.", q: "What should come first?", options: ["Vision around the den and finding the three missing heroes", "Go in immediately", "Split the team: two on Roshan, three farm", "Skip Roshan forever"], correct: 0, why: "Three unseen enemies can trap you in the pit; see them first." },
      ],
      practice: [
        { id: "deaths", text: "Die at most 5 times in a match.", need: 2, of: 3 },
      ],
    },
    // ------------------------------------------------------------------ 4 ----
    {
      id: "highground",
      title: "Pushing and the high ground",
      lead: "How a lead becomes a win - or a throw.",
      theory: [
        {
          h: "Pushing with creeps",
          p: [
            "Buildings take much less damage when no enemy creeps are near them (backdoor protection): push **with your creep wave**. Push lanes **one after another or at the same time** so the enemy cannot defend everything.",
          ],
        },
        {
          h: "The high ground",
          p: [
            "Defenders on the high ground see you, you do not see them, and their towers help them. Go up when you have a **clear advantage**: an Aegis, enemies dead or without buyback, your key items. Siege first - hit what you can from below, make them use spells and the **Glyph** (it protects their buildings for a few seconds), then go in together.",
          ],
        },
        {
          h: "Knowing when to back off",
          p: [
            "If the push fails - heroes low, spells used, enemies buying back - **leave** and keep your lead. Most throws are one more fight on the high ground that was not needed.",
          ],
        },
      ],
      quiz: [
        { id: "hg1", q: "Why push buildings together with your creep wave?", options: ["Buildings take much less damage without enemy creeps nearby", "Creeps give armor to heroes", "It is the only way to see the building", "It is not important"], correct: 0, why: "Backdoor protection: a building without creeps near it resists most damage." },
        { id: "hg2", q: "When should you go up the enemy high ground?", options: ["With a clear advantage: Aegis, dead enemies or no buyback, key items", "As soon as the Tier 2 falls", "Alone with your carry", "Whenever you are bored"], correct: 0, why: "Uphill fights favour the defender; you need an advantage to take them." },
        { id: "hg3", q: "What does the enemy Glyph do?", options: ["Protects their buildings for a few seconds", "Kills your creeps", "Gives vision of your base", "Heals their heroes"], correct: 0, why: "Glyph makes their buildings invulnerable for a short time; bait it before the real push." },
        { id: "hg4", q: "Your high-ground push fails: two heroes are low, the enemy bought back. What do you do?", options: ["Back off and keep the lead", "Keep fighting until everyone is dead", "Buy back yourselves and dive", "Attack the Ancient anyway"], correct: 0, why: "Leaving keeps your advantage; one more fight there is how leads are thrown." },
      ],
      situations: [
        { id: "hgs1", scene: "Minute 33. Your team has the Aegis and all enemy Tier 2s are down. Two enemies have buyback, three do not.", q: "What is a good plan?", options: ["Siege from below with creeps, bait spells and Glyph, then go up together", "Run up immediately one by one", "Wait 10 more minutes", "Split up to farm"], correct: 0, why: "With the Aegis and few buybacks you have the advantage; siege first, then commit together." },
        { id: "hgs2", scene: "Minute 40. You push without creeps; your heroes hit a tower that barely loses health.", q: "Why?", options: ["Backdoor protection: no creeps near the building", "The tower has the Aegis", "Towers heal at night", "Your heroes are too low level"], correct: 0, why: "Bring a creep wave; without it buildings take reduced damage and regenerate." },
      ],
      practice: [
        { id: "deaths", text: "Die at most 4 times in a match.", target: 4, need: 2, of: 3 },
      ],
    },
    // ------------------------------------------------------------------ 5 ----
    {
      id: "fightfarm",
      title: "When to fight, when to farm",
      lead: "Fight on your timing, farm on theirs.",
      theory: [
        {
          h: "Fight when it favours you",
          p: [
            "Fight when you have more heroes there, your key items or ultimates are ready and theirs are not, or the fight is near your towers. Count: who is missing, whose ultimates are on cooldown, who has buyback.",
          ],
        },
        {
          h: "Farm when it does not",
          p: [
            "If the enemy just got their key item or has more heroes nearby, do not take an even fight: farm the safe side of the map, stack, and wait for your timing. Farming at the right time is not passive - it is preparing the next fight.",
            "But do not farm while your team fights next to you: a fight lost 4 versus 5 costs more than the camp you took.",
          ],
        },
      ],
      quiz: [
        { id: "ff1", q: "Which is a good reason to take a fight?", options: ["Your key ultimate is ready and theirs is on cooldown", "You are bored of farming", "It is night", "You just died"], correct: 0, why: "Fight when resources favour you." },
        { id: "ff2", q: "Your team fights right next to you; you are farming a camp. What is usually right?", options: ["Join the fight", "Finish the camp first", "Go to the fountain", "Farm the next camp"], correct: 0, why: "A lost 4v5 costs more than any camp." },
        { id: "ff3", q: "The enemy carry just finished his key item; yours comes in 3 minutes. What do you do?", options: ["Avoid even fights, farm safely, fight when your item is ready", "Fight right now", "Sell your items", "All-in their base"], correct: 0, why: "Fight on your timing; avoid fights on theirs." },
      ],
      situations: [
        { id: "ffs1", scene: "Minute 26. The enemy has 5 heroes visible near your Tier 2; you have 4 there, your carry is farming far away.", q: "What is usually right?", options: ["Do not take the fight 4v5: defend from a distance or trade elsewhere, regroup", "Fight now 4v5", "Everyone farms", "TP in one by one"], correct: 0, why: "A 4v5 under pressure loses heroes and the tower; regroup or trade." },
      ],
      practice: [
        { id: "idle", text: "Keep idle time under 2 minutes.", need: 2, of: 3 },
      ],
    },
    // ------------------------------------------------------------------ 6 ----
    {
      id: "comeback",
      title: "Defending and coming back",
      lead: "Behind is not lost. Buy time, wait for the mistake.",
      theory: [
        {
          h: "Defend without dying",
          p: [
            "When behind, **defend with wave clear** from a distance and keep heroes alive: every death gives the enemy the time they need to push. Use your Glyph when the enemy commits to a building, not too early.",
          ],
        },
        {
          h: "Find the opening",
          p: [
            "A team that is ahead takes risks: they split up, farm alone, dive without vision. **Pick off** the lone hero, take objectives on the other side of the map, and fight only when they make a mistake. Late in the game your carry's items can be worth more than their lead.",
            "Watch their buyback: a team without buyback that loses one fight can lose its base.",
          ],
        },
      ],
      quiz: [
        { id: "cb1", q: "Your team is behind. What matters most when defending?", options: ["Staying alive and clearing waves from a distance", "Fighting every push head-on", "Farming the enemy jungle", "Selling items for gold"], correct: 0, why: "Deaths give the enemy the time and safety to push; wave clear holds them off." },
        { id: "cb2", q: "How does a team that is behind usually come back?", options: ["Punishing the enemy's mistakes: pickoffs, cross-map objectives", "Fighting 5v5 head-on every time", "Waiting in the fountain until 60:00", "Surrendering"], correct: 0, why: "A team ahead takes risks; each one is an opening." },
        { id: "cb3", q: "Why watch the enemy's buyback status?", options: ["Without buyback, one lost fight can cost them their base", "Buyback gives vision", "It shows their items", "It does not matter"], correct: 0, why: "Late fights without buyback are decisive." },
      ],
      situations: [
        { id: "cbs1", scene: "You are 15k gold behind at minute 35. The enemy carry farms alone in your jungle without vision around him.", q: "What is the best chance?", options: ["Smoke and catch him alone", "Fight their four other heroes at their tower", "Farm your safe lane", "Buy wards for your base only"], correct: 0, why: "A lone carry without vision is the mistake a team behind waits for." },
      ],
      practice: [
        { id: "answers", text: "Buy the answer to whoever is killing you (no 'missing answer' finding in Review).", need: 2, of: 3 },
      ],
    },
  ],
};
