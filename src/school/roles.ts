// =============================================================================
//  Module 2: Roles (ADR-048). Laning, then each position: what it is for, what
//  to do in the first ten minutes and after, the common mistakes - and a practice
//  goal measured by the Review tab for that position.
//  Facts: game rules that hold across patches (creep aggro, denies under 50% HP,
//  units / wards in a camp's spawn area block the respawn, Smoke of Deceit).
//  Patch-sensitive numbers are left out on purpose.
// =============================================================================

import type { Module } from "./types.js";

export const ROLES: Module = {
  id: "roles",
  title: "Roles",
  patch: "7.41f",
  checked: "2026-11-09",
  lessons: [
    // ------------------------------------------------------------------ 1 ----
    {
      id: "laning",
      title: "Laning basics",
      lead: "Where the creep wave meets decides who farms.",
      theory: [
        {
          h: "The creep equilibrium",
          p: [
            "Two creep waves meet and fight; where they meet is the **equilibrium**. A lane that meets **near your tower** is safe for you and dangerous for the enemy: they must walk far from their tower to farm, and your tower helps you.",
            "If you kill the enemy wave fast, your wave walks on and **pushes** into their tower; if you only last-hit, the waves stay balanced. Pushing is not free: it moves the lane toward the enemy side.",
          ],
        },
        {
          h: "Creep aggro",
          p: [
            "Enemy creeps attack you for a couple of seconds when you **attack an enemy hero** near them. You can use it: attack-command an enemy hero, then walk back toward your tower - the creeps follow, and the lane moves toward you.",
            "The same rule punishes careless harass: hitting the enemy hero under his creeps costs you health.",
          ],
        },
        {
          h: "Last hits, denies, harass",
          p: [
            "An allied creep can be **denied** once it is below half health. Last-hit the enemy creeps, deny yours, and harass the enemy hero **when he walks in for a last hit** - he cannot both hit the creep and dodge you.",
            "Keep a **Town Portal scroll** at all times: it is how you save a tower, an ally, or your own life.",
          ],
        },
      ],
      quiz: [
        { id: "l1", q: "Where do you want the creep equilibrium in your safe lane?", options: ["Near your own tower", "Near the enemy tower", "Exactly in the river", "It does not matter"], correct: 0, why: "Near your tower the enemy must walk far to farm and your tower protects you." },
        { id: "l2", q: "What happens when you attack an enemy hero near his creeps?", options: ["His creeps attack you for a couple of seconds", "Nothing", "Your creeps stop attacking", "You get bonus gold"], correct: 0, why: "Creep aggro: they switch to you briefly. Walk back to drag the lane toward you." },
        { id: "l3", q: "When can you deny an allied creep?", options: ["When it is below half health", "Any time", "Only at full health", "Never"], correct: 0, why: "Allied creeps become deniable under 50% health." },
        { id: "l4", q: "When is the best moment to harass the enemy laner?", options: ["When he walks in for a last hit", "When he stands under his tower", "When his creeps are full health", "At night only"], correct: 0, why: "He commits to the creep and cannot dodge or answer at the same time." },
        { id: "l5", q: "Killing the enemy wave very fast in your safe lane usually...", options: ["Pushes the lane toward the enemy tower, away from your safety", "Keeps it near your tower", "Gives you a free rune", "Stops creeps from spawning"], correct: 0, why: "Your surviving wave walks on: the meeting point moves toward the enemy." },
        { id: "l6", q: "Why carry a Town Portal scroll at all times?", options: ["To defend a tower, save an ally or escape", "It gives armor", "It is required to buy items", "It regenerates mana"], correct: 0, why: "A TP is the cheapest answer to most emergencies on the map." },
      ],
      situations: [
        { id: "ls1", scene: "Safe lane, minute 3. The waves meet just in front of the enemy tower; the enemy offlaner stands next to it, healthy.", q: "What brings the lane back toward you?", options: ["Aggro the creeps onto you (attack-command the hero) and walk back", "Kill the enemy wave as fast as possible", "Stand under the enemy tower and farm", "Leave the lane for 5 minutes"], correct: 0, why: "Creep aggro drags the enemy wave toward your side; killing it fast pushes even further." },
        { id: "ls2", scene: "Mid lane, 2:30. The enemy mid walks into range of your creeps to last-hit a low ranged creep.", q: "What gives the most?", options: ["Hit him now while he commits to the creep", "Hit his full-health creeps", "Back off to the river", "Use your ultimate on the creep"], correct: 0, why: "Harass lands when he cannot answer; damage now is gold and experience later." },
      ],
      practice: [
        { id: "cs10", text: "As position 1, 2 or 3: reach the ranked average of last hits at 10:00.", roles: [1, 2, 3], need: 2, of: 3 },
      ],
    },
    // ------------------------------------------------------------------ 2 ----
    {
      id: "pos5",
      title: "Position 5: hard support",
      lead: "Your carry's lane, the team's vision, and every item nobody else buys.",
      theory: [
        {
          h: "What the role is for",
          p: [
            "The hard support gives up farm so the carry can have it. Your gold buys what the team needs to see and survive: **observer and sentry wards**, **Smoke of Deceit**, **dust**, and later utility items.",
          ],
        },
        {
          h: "The lane",
          p: [
            "Stay in the safe lane with your carry. Harass the enemy offlaner when he goes for last hits, keep the equilibrium near your tower, and **pull** the nearby small or medium camp into your wave when the lane pushes too far.",
            "Do not take your carry's last hits. Stand where you can **block** enemy pressure and **save** him: your spells are for him first.",
          ],
        },
        {
          h: "Vision and dewarding",
          p: [
            "Place observers where the enemy will walk: around Roshan and Tormentor before they matter, at the entrances to your carry's jungle, and toward the next objective. Buy wards so the shop's stock never sits full.",
            "Use **sentries** to remove enemy observers: wards near your carry's farm and your towers are the ones that get him killed.",
          ],
        },
        {
          h: "After the lane",
          p: [
            "Stack camps for your cores, keep vision ahead of the team, and **stay alive in fights**: a support who dies first takes his saves and disables out of the fight.",
          ],
        },
      ],
      quiz: [
        { id: "p5a", q: "Whose last hits should a hard support take in the safe lane?", options: ["None of the carry's - only when the carry cannot reach them", "All of them", "Half of them", "Only the ranged creeps"], correct: 0, why: "Gold given to the carry is gold that wins the late game; the support's own farm comes second." },
        { id: "p5b", q: "Your lane has pushed to the enemy tower. Which support tool brings it back?", options: ["Pulling a jungle camp into your wave", "Buying more wards", "Attacking the tower", "Going mid"], correct: 0, why: "The pulled camp fights your wave, so the enemy's wave walks toward your tower." },
        { id: "p5c", q: "What are sentry wards mainly for?", options: ["Revealing invisible units and removing enemy wards", "Long-range vision", "Healing", "Blocking creep waves"], correct: 0, why: "Sentries give true sight in a small area." },
        { id: "p5d", q: "In a fight, why should the hard support avoid dying first?", options: ["His saves and disables leave the fight with him", "Supports cannot be revived", "It costs the carry a level", "Because of mega creeps"], correct: 0, why: "A dead support saves nobody; position behind your cores and use spells first." },
        { id: "p5e", q: "Where are observer wards most useful in the mid game?", options: ["On the paths toward the next objective and the enemy's entrances", "Inside your own base", "On the enemy fountain", "Anywhere, it does not matter"], correct: 0, why: "Vision is for decisions: see the enemy coming before the fight at the next objective." },
      ],
      situations: [
        { id: "p5s1", scene: "Minute 6. Your carry dies twice to ganks from the river near your safe lane. The enemy has an observer there that you can see with a sentry.", q: "What is your first action?", options: ["Sentry the spot and destroy their ward, then ward the river yourself", "Buy a second damage item", "Leave to roam mid", "Tell the carry to farm the jungle alone"], correct: 0, why: "Their vision is why the ganks land; remove it and see their rotations first." },
        { id: "p5s2", scene: "Minute 12. Your team plans to take Roshan in two minutes; nobody has vision around the pit.", q: "What do you do?", options: ["Ward around the pit and deward theirs before the team goes in", "Go in immediately without vision", "Farm the jungle", "Buy boots"], correct: 0, why: "Roshan fights are decided by who sees whom; vision first, then the pit." },
      ],
      practice: [
        { id: "observers", text: "As position 5: place at least 8 observer wards.", roles: [5], need: 2, of: 3 },
        { id: "dewards", text: "As position 5: destroy at least 2 enemy wards.", roles: [5], need: 2, of: 3 },
      ],
    },
    // ------------------------------------------------------------------ 3 ----
    {
      id: "pos4",
      title: "Position 4: soft support",
      lead: "Pressure the map early, make your cores' lanes easier.",
      theory: [
        {
          h: "What the role is for",
          p: [
            "The soft support is the team's **early playmaker**: you win your lane, then move to help others with kills, smokes and stacks. You get more farm than the 5 but less than the cores.",
          ],
        },
        {
          h: "Lane and rotations",
          p: [
            "Usually you play with the offlaner against the enemy carry: harass, contest the enemy pull, and make the carry's lane hard. When your lane is safe, **rotate**: to mid when the power rune is about to spawn, or to a lane where the enemy is pushed up without escape.",
            "A good rotation ends in a kill, a rune or a tower; a failed one costs your offlaner his lane. Check the map before you leave.",
          ],
        },
        {
          h: "Stacks and Smokes",
          p: [
            "Stack camps when you pass them at the right second: they are free farm for your cores later. **Smoke of Deceit** hides your group until enemy heroes or towers are close: it is how a team surprises a farming carry.",
          ],
        },
      ],
      quiz: [
        { id: "p4a", q: "What is the soft support's main job in the first 10 minutes?", options: ["Win the lane, then create kills and pressure elsewhere", "Farm the most gold", "Stay in base", "Only place wards"], correct: 0, why: "Position 4 is the early playmaker: kills and pressure that let the cores farm." },
        { id: "p4b", q: "When is a rotation to mid well timed?", options: ["Right before a power rune spawns, with your own lane safe", "Whenever you are bored", "When your offlaner is about to die", "Only after 30 minutes"], correct: 0, why: "Arrive with the rune, from a lane that will not collapse without you." },
        { id: "p4c", q: "What does Smoke of Deceit do?", options: ["Hides your group until enemy heroes or towers come close", "Heals your team", "Gives vision", "Stuns enemies"], correct: 0, why: "Smoked heroes are invisible to the enemy until they get near enemy heroes or towers." },
        { id: "p4d", q: "Why stack camps as a support?", options: ["Your cores later farm several camps at once", "Stacks give the support XP only", "It kills the enemy carry", "It removes enemy wards"], correct: 0, why: "A stacked camp is two or more camps' gold in one place for a core with area damage." },
      ],
      situations: [
        { id: "p4s1", scene: "Minute 5:45. Your offlane is even; the enemy mid is low on health and has no escape spell. A power rune spawns at 6:00.", q: "What is the best move?", options: ["Rotate to mid for the rune and a kill attempt", "Stay and farm the offlane creeps", "Go back to base", "Stack the ancient camp"], correct: 0, why: "A safe lane, a rune about to spawn and a weak mid target: the classic rotation." },
        { id: "p4s2", scene: "Minute 14. The enemy carry farms alone in his jungle; your team of four is nearby with a Smoke.", q: "What is the strong play?", options: ["Smoke and catch him in the jungle", "Each farms separately", "Push the enemy high ground", "Wait for Tormentor"], correct: 0, why: "A smoked gank on a lone farming carry slows the enemy's strongest hero." },
      ],
      practice: [
        { id: "stacks", text: "As position 4: stack at least 3 camps.", roles: [4], need: 2, of: 3 },
        { id: "kp", text: "As position 4: take part in at least 55% of your team's kills.", target: 0.55, roles: [4], need: 2, of: 3 },
      ],
    },
    // ------------------------------------------------------------------ 4 ----
    {
      id: "pos3",
      title: "Position 3: offlane",
      lead: "The hard lane against the enemy carry, then the front of every fight.",
      theory: [
        {
          h: "What the role is for",
          p: [
            "The offlaner plays the **hard lane** against the enemy carry and support. Your first goal is not to win it outright: **survive, get levels, and make the carry's farm slow**.",
          ],
        },
        {
          h: "The lane",
          p: [
            "Experience matters more than last hits here: stay near the creeps when it is safe, take the enemy pull away, and harass the carry when your support helps. Pull the wave toward your side with creep aggro when the enemy freezes it under their tower.",
            "Pressure the enemy Tier 1 tower when you can: towers are gold for your team and space on the map.",
          ],
        },
        {
          h: "Mid game: initiation",
          p: [
            "Offlaners are usually durable heroes with a way to **start fights**: a gap closer and a disable. Build for that: an item that lets you jump in (often Blink Dagger) and one that keeps you alive there. You go first so your cores can hit what you caught.",
          ],
        },
      ],
      quiz: [
        { id: "p3a", q: "What is the offlaner's first goal in lane?", options: ["Survive, get levels and slow the enemy carry's farm", "Out-farm the carry", "Take every last hit", "Leave the lane at once"], correct: 0, why: "Against two enemies the realistic win is the carry farming slowly while you get levels." },
        { id: "p3b", q: "Which matters more for the offlaner in a hard lane?", options: ["Experience (staying near the creeps safely)", "Denies only", "Wards", "Buying many consumables"], correct: 0, why: "Levels make the offlaner relevant in fights even with little gold." },
        { id: "p3c", q: "Why do offlaners often buy a gap-closer like Blink Dagger?", options: ["To start fights on the right target", "To farm faster", "To ward from further away", "To deny towers"], correct: 0, why: "Initiation is the offlaner's mid-game job: get the key disable on the key target." },
        { id: "p3d", q: "What does pressuring the enemy Tier 1 tower give?", options: ["Gold for your team and space on the map", "Nothing until 30:00", "An extra life", "A free ward"], correct: 0, why: "Towers are team gold and push the enemy's safe area back." },
      ],
      situations: [
        { id: "p3s1", scene: "Offlane, minute 4. The enemy carry and support have frozen the wave under their tower; you are level 3, they are 4 and 3.", q: "What is the smart play?", options: ["Stay in experience range safely, contest their pull, wait for your support or a rune", "Dive the tower alone", "Leave the lane to farm the jungle from now on", "Attack the creeps under their tower"], correct: 0, why: "A frozen lane is dangerous to walk into; keep levels coming and break the freeze with help." },
        { id: "p3s2", scene: "Minute 18. You have Blink Dagger; the enemy carry stands behind his team's front line in a fight about to start.", q: "Whom do you jump on?", options: ["The enemy carry or their key spellcaster, with your team ready to follow", "The nearest creep", "The tankiest enemy in front", "Nobody, wait for the enemy to start"], correct: 0, why: "Initiation pays when it disables the hero that decides the fight." },
      ],
      practice: [
        { id: "xp10", text: "As position 3: reach the ranked average of experience at 10:00.", roles: [3], need: 2, of: 3 },
        { id: "deaths", text: "As position 3: die at most 6 times.", target: 6, roles: [3], need: 2, of: 3 },
      ],
    },
    // ------------------------------------------------------------------ 5 ----
    {
      id: "pos2",
      title: "Position 2: mid",
      lead: "A solo lane, the runes, and the first plays of the game.",
      theory: [
        {
          h: "What the role is for",
          p: [
            "The mid player gets a **solo lane**: the fastest levels in the game. Use that advantage early - mid heroes are often strongest when their ultimate comes online before everyone else's.",
          ],
        },
        {
          h: "The lane and the runes",
          p: [
            "Win the last-hit duel, deny, and harass when the enemy commits to a creep. Water runes at 2:00 and 4:00 refill you; from 6:00 a **power rune** spawns every 2 minutes. Controlling them keeps your lane and gives you the tools to gank.",
          ],
        },
        {
          h: "Rotations",
          p: [
            "With a good rune or your ultimate, **move**: to a side lane where the enemy is pushed up, together with your supports. Push your mid wave first so you lose little while away. A mid who only farms mid gives the enemy time to catch up.",
          ],
        },
      ],
      quiz: [
        { id: "p2a", q: "Why does the mid player level fastest?", options: ["He is alone in his lane", "Mid creeps give double XP", "Runes give XP", "Because of the tower"], correct: 0, why: "Experience is shared by nearby heroes; alone, he keeps all of it." },
        { id: "p2b", q: "When do power runes start spawning?", options: ["6:00, every 2 minutes", "0:00, every 4 minutes", "2:00 and 4:00", "Only after Roshan"], correct: 0, why: "Water runes at 2 and 4 minutes, power runes from 6:00 every 2 minutes." },
        { id: "p2c", q: "Before leaving mid to gank, you should...", options: ["Push your mid wave so you lose little while away", "Let the enemy wave hit your tower", "Buy a ward for mid", "Wait for the enemy mid to leave first"], correct: 0, why: "A pushed wave keeps your tower safe and your farm intact while you rotate." },
        { id: "p2d", q: "What is the risk of a mid who only farms mid?", options: ["The enemy gets time to catch up to his early advantage", "None", "He loses levels", "The tower dies"], correct: 0, why: "The mid's strength is timing: early levels used on the map, not stored." },
      ],
      situations: [
        { id: "p2s1", scene: "6:00. You take a double damage rune; your safe lane has the enemy offlaner pushed up to your tower with no escape items.", q: "What do you do?", options: ["Push the mid wave, then go with the rune to kill the offlaner with your supports", "Keep last-hitting mid", "Go to the enemy jungle alone", "Save the rune for later"], correct: 0, why: "A strong rune and an exposed target: convert the solo-lane advantage into a kill." },
        { id: "p2s2", scene: "Mid lane, 3:50. You are low on mana and health; the 4:00 water rune is near.", q: "What is best?", options: ["Take the water rune at 4:00 and stay in lane", "Walk to the fountain", "Buy a ward", "Fight the enemy mid now"], correct: 0, why: "The water rune refills you without losing a minute of lane." },
      ],
      practice: [
        { id: "xp10", text: "As position 2: reach the ranked average of experience at 10:00.", roles: [2], need: 2, of: 3 },
        { id: "kp", text: "As position 2: take part in at least half of your team's kills.", roles: [2], need: 2, of: 3 },
      ],
    },
    // ------------------------------------------------------------------ 6 ----
    {
      id: "pos1",
      title: "Position 1: carry",
      lead: "Farm the most, fight when your items say so, end the game.",
      theory: [
        {
          h: "What the role is for",
          p: [
            "The carry takes the most farm and becomes the team's strongest hero later. Your job is to turn gold into **items that win fights** - and then win them, take buildings and end the game.",
          ],
        },
        {
          h: "Farming",
          p: [
            "Never stand still: move between the lane wave and nearby jungle camps, take stacks your supports made, and use safe areas behind your towers. Every minute without gold or experience is a minute the enemy carry gets ahead (the Review tab measures **idle time**).",
          ],
        },
        {
          h: "When to fight",
          p: [
            "Fight when your **core item** is ready or the fight is right next to you; skip far fights you cannot reach in time - farming then is not selfish, it is the plan. Keep gold for **buyback** late in the game: your death without it can lose the match.",
          ],
        },
        {
          h: "Pushing",
          p: [
            "Farm in the lane that pushes the enemy, and take towers when the enemy shows elsewhere: buildings are permanent gold and space. A lead is won in fights but cashed in by buildings.",
          ],
        },
      ],
      quiz: [
        { id: "p1a", q: "What does a carry do between creep waves?", options: ["Farms nearby jungle camps or stacks", "Waits next to the tower", "Goes back to the fountain", "Places wards"], correct: 0, why: "Waves come every 30 seconds; the time between is for camps, not standing." },
        { id: "p1b", q: "When should a carry join a fight far away?", options: ["Usually not, unless his key item is ready or it decides the game", "Always", "Never", "Only at night"], correct: 0, why: "A carry who walks across the map for every fight neither fights well nor farms." },
        { id: "p1c", q: "Why keep buyback gold late in the game?", options: ["Your death without buyback can lose the match", "Buyback gives bonus damage", "Gold buys experience", "To buy wards later"], correct: 0, why: "Late, a dead carry means a lost fight and often the base." },
        { id: "p1d", q: "How does a lead become a win?", options: ["By taking buildings after winning fights", "By farming until 60:00", "By killing couriers", "By stacking camps"], correct: 0, why: "The Ancient is the win condition; buildings are the path there." },
      ],
      situations: [
        { id: "p1s1", scene: "Minute 16. Your key item is 400 gold away. Your team fights at the enemy's Tier 2 tower on the other side of the map, 4 vs 5.", q: "What is usually right?", options: ["Finish the item from the camps and lane near you; join the next fight with it", "Run across the map now", "Buy a consumable and run", "Go to Roshan alone"], correct: 0, why: "You would arrive late and weak; minutes later you arrive on time and strong." },
        { id: "p1s2", scene: "Minute 34. You won a fight; two enemies are dead for 50 seconds, the others have no buyback.", q: "What converts the win?", options: ["Take towers and barracks right now with the team", "Go farm the jungle", "Go back to base to shop first", "Kill Tormentor"], correct: 0, why: "A won fight is a window: buildings are the permanent reward." },
      ],
      generated: "items",
      practice: [
        { id: "nw20", text: "As position 1: reach the ranked average net worth at 20:00.", roles: [1], need: 2, of: 3 },
        { id: "idle", text: "As position 1: keep idle time under 1.5 minutes.", target: 1.5, roles: [1], need: 2, of: 3 },
      ],
    },
  ],
};
