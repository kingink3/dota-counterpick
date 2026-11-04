// =============================================================================
//  STRATZ GraphQL queries for the match review (ADR-029). A full match in one query
//  is over STRATZ's complexity limit (1.4M vs 310k), so a match is read in parts:
//  summary (all 10 players, light), you (stats + all events), positions (all 10,
//  for "where were your allies when you died"), map (towers, Roshan).
//  Field lists come from the schema (introspection, stratz-raw/schema).
// =============================================================================

export function recentMatchesQuery(account: number, take = 20): string {
  return `{ player(steamAccountId: ${account}) { matches(request: {take: ${take}}) { id startDateTime durationSeconds gameMode lobbyType didRadiantWin parsedDateTime players(steamAccountId: ${account}) { heroId isVictory position kills deaths assists } } } }`;
}

export function matchSummaryQuery(id: number): string {
  return `{ match(id: ${id}) { id durationSeconds gameMode lobbyType didRadiantWin startDateTime averageRank bracket firstBloodTime players { playerSlot steamAccountId isRadiant heroId position lane role isVictory kills deaths assists networth goldPerMinute experiencePerMinute numLastHits numDenies imp level item0Id item1Id item2Id item3Id item4Id item5Id neutral0Id stats { networthPerMinute lastHitsPerMinute } } radiantNetworthLeads radiantExperienceLeads } }`;
}

export function matchMeQuery(id: number, account: number): string {
  return `{ match(id: ${id}) { id players(steamAccountId: ${account}) { playerSlot heroId position isRadiant stats { lastHitsPerMinute deniesPerMinute networthPerMinute experiencePerMinute impPerMinute heroDamagePerMinute heroDamageReceivedPerMinute tripsFountainPerMinute actionsPerMinute campStack wards { time type positionX positionY } wardDestruction { time } farmDistributionReport { creepLocation { id count gold xp } neutralLocation { id count gold xp } ancientLocation { id count gold xp } buildings { id count gold xp } other { id count gold xp } buyBackGold abandonGold } heroDamageReport { dealtTotal { physicalDamage magicalDamage pureDamage stunCount stunDuration disableCount disableDuration } receivedTotal { physicalDamage magicalDamage pureDamage } } actionReport { moveToPosition moveToTarget attackPosition attackTarget castPosition castTarget castNoTarget heldPosition pingUsed } } playbackData { purchaseEvents { time itemId } deathEvents { time attacker isFromIllusion target byAbility byItem goldFed xpFed timeDead reliableGold unreliableGold positionX positionY goldLost assist isWardWalkThrough isAttemptTpOut isDieBack isBurst isEngagedOnDeath hasHealAvailable isTracked isFeed } killEvents { time attacker isFromIllusion target byAbility byItem gold xp positionX positionY assist isSolo isGank isInvisible isSmoke isTpRecently isRuneEffected } assistEvents { time attacker target gold xp subTime positionX positionY } itemUsedEvents { time itemId attacker target } abilityUsedEvents { time abilityId attacker target } abilityLearnEvents { time abilityId levelObtained level isUltimate isTalent isMaxLevel } playerUpdateHealthEvents { time hp maxHp mp maxMp } playerUpdateGoldEvents { time gold unreliableGold networth networthDifference } buyBackEvents { time heroId deathTimeRemaining cost } runeEvents { time rune action gold positionX positionY } inventoryEvents { time item0 { itemId charges } item1 { itemId charges } item2 { itemId charges } item3 { itemId charges } item4 { itemId charges } item5 { itemId charges } backPack0 { itemId charges } backPack1 { itemId charges } backPack2 { itemId charges } neutral0 { itemId charges } } } } } }`;
}

export function matchPositionsQuery(id: number): string {
  return `{ match(id: ${id}) { id players { playerSlot playbackData { playerUpdatePositionEvents { time x y } deathEvents { time positionX positionY } } } } }`;
}

export function matchMapQuery(id: number): string {
  return `{ match(id: ${id}) { id playbackData { towerDeathEvents { time radiant dire } roshanEvents { time hp maxHp createTime x y } } } }`;
}
