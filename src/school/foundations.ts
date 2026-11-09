// =============================================================================
//  Module 1: Foundations (ADR-046). From "what is Dota" to reading a draft.
//  Facts checked for patch 7.41f (2026-11-09): map timings come from
//  data/timings.yaml (reviewed per patch, sources there); damage / resistances from
//  Liquipedia (base magic resistance 25%, +0.1% per Intelligence; debuff immunity).
//  Numbers that change often are left out on purpose: the lessons teach the rule,
//  not this week's value.
// =============================================================================

import type { Module } from "./types.js";

export const FOUNDATIONS: Module = {
  id: "foundations",
  title: "Foundations",
  patch: "7.41f",
  checked: "2026-11-09",
  lessons: [
    // ------------------------------------------------------------------ 1 ----
    {
      id: "goal",
      title: "What the game is",
      lead: "Two teams, three lanes, one goal: the enemy Ancient.",
      theory: [
        {
          h: "The win condition",
          p: [
            "Dota 2 is played **5 versus 5**: Radiant (bottom-left of the map) against Dire (top-right). A match is won in exactly one way: **destroy the enemy Ancient**, the building in the middle of their base. Kills, gold and towers matter only because they help you get there.",
            "There is no time limit. Most public matches last 30-45 minutes, but a team that is behind can turn a game around until its Ancient falls.",
          ],
        },
        {
          h: "Lanes and creeps",
          p: [
            "Three **lanes** connect the bases: top, middle and bottom. Every **30 seconds** each base sends a wave of computer-controlled **lane creeps** down every lane. They walk until they meet the enemy wave and fight it.",
            "Between the lanes lies the **jungle** with **neutral creep camps**: they belong to no team and give gold and experience to whoever kills them.",
          ],
        },
        {
          h: "Buildings",
          p: [
            "Each lane has three **towers** per team (Tier 1 outermost, then Tier 2 and Tier 3 at the base), plus two **Tier 4** towers guarding the Ancient. A tower attacks enemies near it; it is what makes your half of the map safer.",
            "Behind each Tier 3 tower stand **barracks** (one melee, one ranged). Destroying them makes your creeps in that lane stronger; destroying all of them gives you **mega creeps**, which push on their own.",
            "The base sits on **high ground**: attacking up the slope without vision is hard, which is why taking the last towers usually needs a coordinated push.",
          ],
        },
        {
          h: "Your hero",
          p: [
            "Each player controls one **hero**. You earn **experience** (levels: new abilities and stronger stats) and **gold** (items). Heroes respawn after death, but the time grows with level and you lose time and gold: dying is expensive.",
            "The **fountain** in your base heals you quickly. The **shop** sells items; a **courier** carries them to you so you do not have to walk back.",
          ],
        },
      ],
      quiz: [
        { id: "g1", q: "How is a match of Dota 2 won?", options: ["By destroying the enemy Ancient", "By the team with more kills after 60 minutes", "By destroying all enemy towers", "By killing Roshan three times"], correct: 0, why: "The Ancient is the only win condition. Kills, towers and Roshan help, but none of them ends the game." },
        { id: "g2", q: "How often does each base send a wave of lane creeps?", options: ["Every 30 seconds", "Every minute", "Every 2 minutes", "Only at the start"], correct: 0, why: "Waves leave every 30 seconds into all three lanes for the whole game." },
        { id: "g3", q: "Which side of the map is Radiant's?", options: ["Bottom-left", "Top-right", "Left and right halves", "It changes every game"], correct: 0, why: "Radiant is bottom-left, Dire top-right. The diagonal river splits the map." },
        { id: "g4", q: "What do you get for destroying ALL enemy barracks?", options: ["Mega creeps", "Instant victory", "Free Aegis", "Double gold"], correct: 0, why: "All barracks down turns your lane creeps into mega creeps, which push very hard but do not end the game by themselves." },
        { id: "g5", q: "Neutral creep camps are in the...", options: ["Jungle, between the lanes", "Enemy fountain", "Middle lane only", "Shops"], correct: 0, why: "Camps sit in the jungle; they belong to no team." },
        { id: "g6", q: "How many towers does each team have in each lane before the base's Tier 4s?", options: ["Three (Tier 1, 2, 3)", "One", "Two", "Five"], correct: 0, why: "Tier 1, 2 and 3 in each of the three lanes, then two Tier 4 towers at the Ancient." },
        { id: "g7", q: "Why is attacking the enemy high ground hard?", options: ["You attack uphill without vision of the top, under towers", "Heroes deal no damage there", "It is closed until 30:00", "Only couriers can go there"], correct: 0, why: "From below you do not see up the slope, while defenders see you and fight under their towers." },
        { id: "g8", q: "Why is dying expensive?", options: ["You lose time (respawn grows with level) and gold, and the enemy gains", "Your items break", "You lose a level", "Your team loses a tower"], correct: 0, why: "Respawn time grows with level and death costs gold; meanwhile the enemy gets gold, XP and map control." },
      ],
      situations: [
        { id: "gs1", scene: "Minute 3. You are in lane with a quarter of your health, no healing items, and the enemy is not attacking right now.", q: "What is usually best?", options: ["Have the courier bring a healing item and stay in lane", "Walk to the fountain and back", "Attack the enemy hero to finish it fast", "Go to the jungle"], correct: 0, why: "Walking to the fountain costs a minute or more of gold and experience. The courier brings regeneration while you keep farming carefully." },
        { id: "gs2", scene: "Your team has a big lead. All enemy Tier 3 towers in two lanes are down; the enemy is defending the high ground with all five heroes.", q: "Which is the most reliable way to finish?", options: ["Keep pressure from several lanes and take the remaining barracks and towers together", "Each hero attacks a different building alone", "Ignore the base and farm until 60:00", "Fight under their Tier 4 towers without vision"], correct: 0, why: "Pressure from several lanes splits the defense; taking buildings together without diving blind is how a lead becomes a win." },
      ],
      practice: [
        { id: "deaths", text: "Die at most 5 times in a match.", need: 2, of: 3 },
      ],
    },
    // ------------------------------------------------------------------ 2 ----
    {
      id: "heroes",
      title: "Heroes, attributes and roles",
      lead: "Strength, Agility, Intelligence, Universal - and the five positions.",
      theory: [
        {
          h: "Attributes",
          p: [
            "Every hero has three attributes that grow each level:",
            "- **Strength**: health and health regeneration.",
            "- **Agility**: armor and attack speed.",
            "- **Intelligence**: mana, mana regeneration and a little magic resistance (+0.1% per point).",
            "A hero's **primary attribute** also adds attack damage. **Universal** heroes have no single primary attribute: they get attack damage from all three, a smaller share of each.",
          ],
        },
        {
          h: "Melee and ranged",
          p: [
            "**Melee** heroes must stand next to their target to attack; **ranged** heroes attack from a distance. Melee heroes usually have more health or ways to close the gap; ranged heroes are safer in lane but often frailer.",
          ],
        },
        {
          h: "Abilities",
          p: [
            "Heroes have **abilities**: usually three basic ones and an **ultimate** available from level 6, plus an **innate** ability that every hero has from the start. Most abilities cost mana and have a cooldown. Talents at levels 10, 15, 20 and 25 add a choice of upgrades.",
          ],
        },
        {
          h: "The five positions",
          p: [
            "Teams split the map's resources by **position** (1 = gets the most, 5 = the least):",
            "- **Position 1, carry**: safe lane, farms the most, becomes the strongest late.",
            "- **Position 2, mid**: middle lane alone, levels fast, makes plays early.",
            "- **Position 3, offlane**: hard lane against the enemy carry, durable, starts fights.",
            "- **Position 4, soft support**: roams and helps lanes, some farm.",
            "- **Position 5, hard support**: protects the carry in lane, wards, buys utility.",
            "Positions are about **who gets the gold**, not fixed rules: one hero can be played in several.",
          ],
        },
      ],
      quiz: [
        { id: "h1", q: "Which attribute gives armor and attack speed?", options: ["Agility", "Strength", "Intelligence", "Universal"], correct: 0, why: "Agility: armor and attack speed. Strength: health. Intelligence: mana and a little magic resistance." },
        { id: "h2", q: "What does Intelligence add besides mana and mana regeneration?", options: ["A little magic resistance (+0.1% per point)", "Movement speed", "Evasion", "Health regeneration"], correct: 0, why: "Since patch 7.33, Intelligence gives base magic resistance: +0.1% per point." },
        { id: "h3", q: "How do Universal heroes get attack damage?", options: ["From all three attributes, a smaller share of each", "Only from Strength", "They have no attack damage from attributes", "From their level only"], correct: 0, why: "Universal heroes have no single primary attribute: all three add damage, each a smaller share than a primary attribute would." },
        { id: "h4", q: "At which level do ultimates become available?", options: ["6", "1", "10", "4"], correct: 0, why: "The ultimate can be learned from level 6 (a few heroes differ, but 6 is the rule)." },
        { id: "h5", q: "Which position usually plays the safe lane and farms the most?", options: ["Position 1 (carry)", "Position 3 (offlane)", "Position 5 (hard support)", "Position 4 (soft support)"], correct: 0, why: "Position 1 is the carry: safest lane, most farm, strongest late." },
        { id: "h6", q: "Who usually plays the middle lane alone?", options: ["Position 2 (mid)", "Position 1", "Position 5", "Nobody: mid is empty"], correct: 0, why: "The mid player gets a solo lane and levels faster." },
        { id: "h7", q: "Which statement about positions is true?", options: ["They describe who gets the gold; many heroes fit several positions", "Each hero can only be played in one position", "Position 5 always has the most gold", "Positions are assigned by the game"], correct: 0, why: "Positions are a team agreement about resources, not a rule of the game." },
        { id: "h8", q: "A melee hero compared with a ranged hero usually...", options: ["Must reach the target to attack, and often has more health or gap-closers", "Attacks from further away", "Cannot use items", "Has no abilities"], correct: 0, why: "Melee attacks need contact; to make up for it melee heroes are often tougher or have mobility." },
        { id: "h9", q: "Which ability does every hero have from level 1 without learning it?", options: ["The innate ability", "The ultimate", "A talent", "Teleport"], correct: 0, why: "Innate abilities are always there; talents come at 10/15/20/25, the ultimate at 6." },
      ],
      situations: [
        { id: "hs1", scene: "Your team: a carry, a mid and an offlaner are picked. You are the last pick and the team has no support yet.", q: "Which choice keeps the team working?", options: ["Pick a hero who can play position 4 or 5", "Pick a second carry: more damage", "Pick any hero and farm the jungle", "Leave the game"], correct: 0, why: "Without supports nobody wards, protects the carry in lane or buys utility; a second carry fights the first one for the same gold." },
        { id: "hs2", scene: "Enemy Strength hero has huge health; your damage is mostly magic from spells.", q: "What is most likely true?", options: ["Spells will take a long time to kill him; you need sustained damage or reductions", "He is weak against all spells", "Strength heroes cannot be stunned", "He has the most armor in the game"], correct: 0, why: "Strength means a big health pool: burst from a few spells often is not enough later in the game." },
      ],
      practice: [],
    },
    // ------------------------------------------------------------------ 3 ----
    {
      id: "damage",
      title: "Damage: physical, magical, pure",
      lead: "Armor, magic resistance and debuff immunity decide what hurts.",
      theory: [
        {
          h: "Three damage types",
          p: [
            "- **Physical**: right-click attacks and some spells. Reduced by **armor**. Attacks can also miss because of evasion or blind.",
            "- **Magical**: most spells. Reduced by **magic resistance**.",
            "- **Pure**: reduced by neither armor nor magic resistance. It is rarer and usually comes on cooldown spells.",
          ],
        },
        {
          h: "Armor",
          p: [
            "Armor multiplies physical damage taken by **1 / (1 + 0.06 x armor)**. With 10 armor you take 62.5% of physical damage; with 20 armor about 45%. Each point is worth less than the one before, but armor stays valuable against physical attackers.",
            "Some abilities and items **reduce armor** of the target: that makes all physical damage on it stronger.",
          ],
        },
        {
          h: "Magic resistance",
          p: [
            "Every hero starts with **25% magic resistance** and gets +0.1% per point of Intelligence. Other sources (items, abilities) stack **multiplicatively**: two sources of 30% and 40% leave 0.7 x 0.6 = 42% of the damage, not 30%.",
          ],
        },
        {
          h: "Disables and debuff immunity",
          p: [
            "**Disables** stop you from acting: stuns, silences (no spells), hexes, roots, fear, sleep and more. They decide most fights.",
            "**Debuff immunity** - from Black King Bar and some abilities - blocks most disables and slows, adds magic resistance and blocks pure damage. Some abilities **pierce** it (the tooltip says so): those still work.",
          ],
        },
      ],
      quiz: [
        { id: "d1", q: "What reduces physical damage?", options: ["Armor", "Magic resistance", "Intelligence", "Debuff immunity only"], correct: 0, why: "Armor reduces physical damage; magic resistance reduces magical damage." },
        { id: "d2", q: "With 10 armor, what share of physical damage do you take?", options: ["62.5%", "40%", "90%", "10%"], correct: 0, why: "1 / (1 + 0.06 x 10) = 1 / 1.6 = 0.625." },
        { id: "d3", q: "What is a hero's base magic resistance?", options: ["25%", "0%", "50%", "10%"], correct: 0, why: "All heroes start at 25%; Intelligence adds 0.1% per point." },
        { id: "d4", q: "You have two magic resistance sources: 30% and 40%. How much magical damage gets through?", options: ["42%", "30%", "0%", "70%"], correct: 0, why: "They stack multiplicatively: 0.7 x 0.6 = 0.42." },
        { id: "d5", q: "Pure damage is reduced by...", options: ["Neither armor nor magic resistance", "Armor only", "Magic resistance only", "Both"], correct: 0, why: "That is what pure means; debuff immunity is the main thing that blocks it." },
        { id: "d6", q: "What does Black King Bar give?", options: ["Debuff immunity: blocks most disables, adds magic resistance", "Invisibility", "Armor only", "Full immunity to every spell including piercing ones"], correct: 0, why: "BKB gives debuff immunity for a few seconds. Abilities marked as piercing still work." },
        { id: "d7", q: "An enemy reduces your armor. What happens?", options: ["You take more physical damage from everyone", "You take more magical damage", "Your spells cost more", "Nothing until you die"], correct: 0, why: "Lower armor raises all physical damage you take." },
        { id: "d8", q: "Which disable stops spells but not attacks or movement?", options: ["Silence", "Stun", "Hex", "Root"], correct: 0, why: "Silence blocks spells; stun and hex stop almost everything; root stops movement." },
      ],
      situations: [
        { id: "ds1", scene: "The enemy carry wins fights by right-clicking: all of its damage is physical. You can buy one defensive stat.", q: "Which helps you most against him?", options: ["Armor", "Magic resistance", "Mana", "Intelligence"], correct: 0, why: "Armor cuts physical damage directly; magic resistance does nothing against attacks." },
        { id: "ds2", scene: "Your carry dies in every fight before acting: two enemy heroes chain stuns and silences on him.", q: "Which item idea fits best?", options: ["Black King Bar: debuff immunity against those disables", "A second damage item", "Boots of Travel", "More armor"], correct: 0, why: "He dies because he cannot act, not because of the damage type. Debuff immunity lets him act through most disables." },
        { id: "ds3", scene: "An enemy spell deals pure damage and does not pierce debuff immunity.", q: "What protects you from it?", options: ["Debuff immunity (e.g. Black King Bar)", "Armor", "Magic resistance items", "Nothing in the game"], correct: 0, why: "Pure damage ignores armor and magic resistance; debuff immunity blocks it unless the spell pierces." },
      ],
      practice: [],
    },
    // ------------------------------------------------------------------ 4 ----
    {
      id: "map",
      title: "The map and its timings",
      lead: "Runes, camps, stacks, lotuses, shrines, Tormentor, Roshan, day and night.",
      theory: [
        {
          h: "Runes",
          p: [
            "- **Bounty runes**: gold; at 0:00 and then every **4 minutes**.",
            "- **Water runes**: at 2:00 and 4:00 at both power rune spots (heal and mana).",
            "- **Power runes** (haste, invisibility, double damage and others): from **6:00**, every **2 minutes** at one of the river spots. Mids fight for them.",
          ],
        },
        {
          h: "Neutral camps, stacking and pulling",
          p: [
            "Camps first appear at **1:00** and respawn **every minute on the minute** if the camp's area is empty at that moment.",
            "**Stacking**: hit a camp at about **:53-:55** and lead it away so the area is empty at :00 - a second camp spawns on top. Stacks become big farm for your cores later.",
            "**Pulling**: bring a jungle camp into your lane creeps (about :15 or :45, depending on the camp) so the wave does not push into the enemy tower.",
          ],
        },
        {
          h: "Lotuses and Wisdom Shrines",
          p: [
            "Each **Healing Lotus** pool grows one lotus every **3 minutes** (up to 6): a free heal.",
            "**Wisdom Shrines** in the jungle give experience every **7 minutes**; the first gives 200, each next one 300 more. Standing in the enemy's shrine reverses its countdown.",
          ],
        },
        {
          h: "Tormentor, Roshan, day and night",
          p: [
            "**Tormentor** first appears at **20:00** and returns 10 minutes after it is killed. The reward is an **Aghanim's Shard** for one of your two poorest heroes (by net worth) who does not have one yet.",
            "**Roshan** is the strongest neutral; killing him gives the **Aegis** (one extra life) and more. He respawns **8 to 11 minutes** after death.",
            "**Day and night** switch every **5 minutes** (night first at 5:00). At night most heroes see less - good for ganks and moving unseen.",
          ],
        },
        {
          h: "Vision: wards",
          p: [
            "**Observer wards** give vision of an area for several minutes. The shop holds up to **4**: 2 at the start, +1 every **2:15** - buy and place them so the stock never caps.",
            "**Sentry wards** reveal **invisible** units and enemy wards nearby: you need them to remove (\"deward\") enemy observers.",
          ],
        },
      ],
      quiz: [
        { id: "m1", q: "When do power runes start spawning?", options: ["6:00, then every 2 minutes", "0:00, then every 4 minutes", "2:00 and 4:00 only", "20:00"], correct: 0, why: "Water runes at 2:00/4:00, power runes from 6:00 every 2 minutes, bounty runes at 0:00 and every 4 minutes." },
        { id: "m2", q: "When should you pull a camp to stack it?", options: ["At about :53-:55", "At exactly :00", "At :30", "Any time"], correct: 0, why: "The area must be empty at :00 for a new camp to spawn; pulling at :53-:55 leads the creeps out just in time." },
        { id: "m3", q: "When does Tormentor first appear?", options: ["20:00", "10:00", "15:00", "It is always there"], correct: 0, why: "Since patch 7.39 the first Tormentor spawns at 20:00 (it was 15:00 before)." },
        { id: "m4", q: "How long after its death does Roshan come back?", options: ["8 to 11 minutes", "Exactly 5 minutes", "Never", "1 minute"], correct: 0, why: "Since 7.38, Roshan's respawn is a random time between 8 and 11 minutes." },
        { id: "m5", q: "What does a sentry ward do?", options: ["Reveals invisible units and enemy wards nearby", "Gives vision like an observer for 10 minutes", "Heals allies", "Stuns enemies"], correct: 0, why: "Sentries give true sight in a small area: invisible heroes and wards become visible." },
        { id: "m6", q: "How many observer wards can the shop hold at most?", options: ["4", "2", "10", "Unlimited"], correct: 0, why: "Stock: 2 at the start, +1 every 2:15, up to 4. If it is full, the restock is wasted." },
        { id: "m7", q: "When is the first night?", options: ["5:00", "0:00", "10:00", "There is no night"], correct: 0, why: "Day and night switch every 5 minutes; the first night is at 5:00." },
        { id: "m8", q: "What does the Aegis from Roshan give?", options: ["One extra life", "Debuff immunity forever", "Double gold", "Vision of the whole map"], correct: 0, why: "Aegis of the Immortal: the holder respawns on the spot after one death." },
        { id: "m9", q: "How often does a Healing Lotus pool grow a lotus?", options: ["Every 3 minutes (up to 6)", "Every 30 seconds", "Every 10 minutes", "Only after Roshan"], correct: 0, why: "Each pool spawns one Healing Lotus every 3 minutes, holding up to 6." },
      ],
      situations: [
        { id: "ms1", scene: "It is 5:50. You are position 5 standing next to a large camp near your safe lane. The lane is calm.", q: "What is the best use of the next few seconds?", options: ["Hit the camp at about 5:53-5:55 and pull it away to stack it", "Wait until 6:00 and attack the camp", "Go to the enemy fountain", "Stand in the camp at 6:00"], correct: 0, why: "Pulling at :53-:55 empties the camp area at :00: a second camp spawns, doubling the farm for your carry later." },
        { id: "ms2", scene: "Minute 7. The shop shows 4 observer wards in stock and you have none.", q: "What does that mean?", options: ["The stock is capped: every 2:15 that passes wastes a ward - buy and place them", "Nothing: wards are useless before 10:00", "The enemy has no wards", "You should sell your boots"], correct: 0, why: "At 4 the stock stops growing; unused restocks are lost vision for the whole game." },
        { id: "ms3", scene: "19:30. Your team is ahead and healthy; the enemy is farming far away.", q: "Which objective is about to appear?", options: ["Tormentor at 20:00 (an Aghanim's Shard)", "The first power rune", "A water rune", "The first Roshan respawn"], correct: 0, why: "Tormentor's first spawn is 20:00; a healthy, ahead team can take it right away. The Shard goes to one of your two poorest heroes." },
      ],
      practice: [
        { id: "observers", text: "As position 4 or 5: place at least 8 observer wards.", roles: [4, 5], need: 2, of: 3 },
        { id: "stacks", text: "As position 4 or 5: stack at least 3 camps.", roles: [4, 5], need: 2, of: 3 },
      ],
    },
    // ------------------------------------------------------------------ 5 ----
    {
      id: "economy",
      title: "Gold, experience and time",
      lead: "Last hits, denies, and why standing around costs a game.",
      theory: [
        {
          h: "Last hits and denies",
          p: [
            "You get gold from a creep only if **your hit kills it** - the **last hit**. Good players time their attacks to the creep's last moments.",
            "You can also hit **your own** creeps when they are low: a **deny**. The enemy gets no gold from a denied creep and less experience.",
          ],
        },
        {
          h: "Experience",
          p: [
            "Experience is shared among heroes **near** a dying enemy unit - you do not need the last hit, just to be close. That is why a solo lane (mid) levels fastest, and why standing out of range of the creeps wastes experience.",
          ],
        },
        {
          h: "Other gold",
          p: [
            "All heroes get a little gold over time. **Kills and assists**, **towers** and **bounty runes** give more; tower gold is shared by the team.",
            "Dying loses gold and time. **Buyback** lets you pay gold to respawn at once (it has a cooldown) - keeping buyback gold late in the game can save it.",
          ],
        },
        {
          h: "Time is the real resource",
          p: [
            "A minute with no last hits, no experience, no wards, no stacks and no pressure is a minute given to the enemy. Walk with a purpose: to a camp, a lane, a rune, or a fight. The Review tab measures this as **idle time**.",
          ],
        },
      ],
      quiz: [
        { id: "e1", q: "When do you get gold for a creep?", options: ["When your hit kills it (the last hit)", "When you hit it at all", "When it dies anywhere on the map", "Only from heroes"], correct: 0, why: "Only the killing blow gives the creep's gold." },
        { id: "e2", q: "What does a deny do?", options: ["The enemy gets no gold from that creep and less experience", "You get double gold", "Your creep becomes stronger", "Nothing"], correct: 0, why: "Denying your own low creep takes its gold away from the enemy and reduces their experience." },
        { id: "e3", q: "To get experience from a dying creep you must...", options: ["Be near it", "Get the last hit", "Have attacked it", "Be level 6"], correct: 0, why: "Experience goes to heroes nearby; the last hit only decides the gold." },
        { id: "e4", q: "What is buyback?", options: ["Paying gold to respawn immediately (with a cooldown)", "Selling an item back for full price", "Getting a lost level back", "Reviving an ally"], correct: 0, why: "Buyback trades gold for time; it has a cooldown." },
        { id: "e5", q: "Why does the mid player usually level fastest?", options: ["He shares experience with nobody in his lane", "Mid creeps give double experience", "Mid heroes have a talent for it", "Runes give experience"], correct: 0, why: "Experience is split among nearby heroes; alone in a lane you keep all of it." },
        { id: "e6", q: "Which minute is wasted?", options: ["Walking with nothing to farm, ward, stack or fight", "Stacking a camp", "Placing a ward", "Taking a rune"], correct: 0, why: "Stacks, wards and runes all pay later; wandering with no target pays nothing." },
      ],
      situations: [
        { id: "es1", scene: "Lane, minute 2. Two enemy creeps are at low health; your own ranged creep is very low too.", q: "What gives the most value?", options: ["Last-hit the enemy creeps; deny your creep if you can", "Hit the full-health enemy creep", "Hit the enemy hero and ignore creeps", "Walk to the jungle"], correct: 0, why: "Gold comes only from last hits; denying takes gold and experience from the enemy." },
        { id: "es2", scene: "Minute 22. Your carry has just bought his big item and has no gold left; the enemy has buyback, he does not.", q: "Why is a risky fight now dangerous for your team?", options: ["If your carry dies he cannot buy back; the enemy can", "Buyback does not exist after 20:00", "Gold has no use late", "Items break on death"], correct: 0, why: "Without buyback gold a death removes your carry from the next fight; the enemy can be back at once." },
      ],
      practice: [
        { id: "cs10", text: "As position 1, 2 or 3: reach the ranked average of last hits at 10:00.", roles: [1, 2, 3], need: 2, of: 3 },
        { id: "idle", text: "Keep idle time under 2 minutes (alive, out of base, nothing that pays).", need: 2, of: 3 },
      ],
    },
    // ------------------------------------------------------------------ 6 ----
    {
      id: "items",
      title: "Items and answers",
      lead: "Slots, actives, and buying what this game asks for.",
      theory: [
        {
          h: "Slots",
          p: [
            "A hero carries **6 item slots**, a **backpack of 3** (items there give no stats or effects until moved), a **neutral item** slot and a slot for the **Town Portal** scroll.",
            "Bigger items are built from **components** and sometimes a **recipe**; the shop shows the tree.",
          ],
        },
        {
          h: "Active and passive",
          p: [
            "**Passive** items work on their own (stats, auras). **Active** items must be used: a blink, a dispel, debuff immunity, a stun. An active item you forget to press does nothing - the Review tab counts these.",
          ],
        },
        {
          h: "Buy for the game, not by habit",
          p: [
            "Every match asks different questions: invisible enemies need **detection**, chains of disables need **debuff immunity or a dispel**, evasive enemies need **true strike**, heavy healing needs **healing reduction**. Before each big purchase ask: what is killing us, and what does this item answer?",
            "The Draft tab ranks items for this kind of reason; the situations below come from the same knowledge base.",
          ],
        },
      ],
      quiz: [
        { id: "i1", q: "Do items in the backpack give their stats?", options: ["No, not until moved to the main slots", "Yes, all of them", "Only passives", "Only at night"], correct: 0, why: "The backpack only carries items; their effects work in the 6 main slots." },
        { id: "i2", q: "Enemy heroes go invisible to gank. What does your team need?", options: ["Detection: sentry wards, dust or items that reveal", "More armor", "Magic resistance", "Movement speed"], correct: 0, why: "You cannot fight what you cannot see; detection reveals invisible units." },
        { id: "i3", q: "What is the main difference between active and passive items?", options: ["Active items must be used; passive ones work on their own", "Active items are cheaper", "Passive items have cooldowns", "There is none"], correct: 0, why: "An active item's effect needs a key press at the right time." },
        { id: "i4", q: "How many main item slots does a hero have?", options: ["6", "9", "4", "Unlimited"], correct: 0, why: "6 main slots, plus a 3-slot backpack, a neutral slot and the Town Portal slot." },
        { id: "i5", q: "Enemy relies on evasion to dodge your attacks. Which property answers it?", options: ["True strike (attacks cannot miss)", "Lifesteal", "Mana regeneration", "Armor reduction on yourself"], correct: 0, why: "True strike ignores evasion." },
      ],
      situations: [],
      generated: "items",
      practice: [],
    },
    // ------------------------------------------------------------------ 7 ----
    {
      id: "draft",
      title: "Reading a draft",
      lead: "Which hero answers this enemy lineup - and why.",
      theory: [
        {
          h: "Counters are mechanisms",
          p: [
            "A hero counters another because of a **mechanism**: a silence against a spell-reliant hero, a dispel against a hex, armor reduction against an armor stack, a long disable against a slippery hero. \"He has a high win rate against him\" is a hint; the mechanism is the reason.",
          ],
        },
        {
          h: "Two sides",
          p: [
            "A good pick answers what the enemy does **and** survives what the enemy uses: a hero that needs to channel spells is a risk into many silences. The Draft tab scores both sides and shows each reason.",
          ],
        },
        {
          h: "Your team",
          p: [
            "Pick for what your team lacks: a support if there is none, magic damage if everyone hits physically, a way to start fights if nobody can. Two heroes that want the same farm make each other weaker.",
          ],
        },
      ],
      quiz: [
        { id: "r1", q: "Why does one hero counter another?", options: ["Because of a mechanism: what his abilities do against the other's", "Because his win rate is higher in general", "Because he costs more gold", "Because of his attribute"], correct: 0, why: "Win rates point at counters; the mechanism explains them and tells you how to use it." },
        { id: "r2", q: "Your team deals only physical damage. What does the enemy need to buy?", options: ["Armor: one kind of item answers your whole team", "Nothing", "Magic resistance", "Mana"], correct: 0, why: "A one-school team is answered by one kind of defense; mixed damage is harder to itemize against." },
        { id: "r3", q: "The enemy has three silences. Which kind of pick is a risk?", options: ["A hero who needs to cast many spells in a fight", "A right-click carry with debuff immunity", "A durable initiator", "Any support"], correct: 0, why: "Silences hit spell-reliant heroes hardest." },
      ],
      situations: [],
      generated: "draft",
      practice: [
        { id: "kp", text: "Take part in at least half of your team's kills.", need: 2, of: 3 },
      ],
    },
  ],
};
