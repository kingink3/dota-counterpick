// =============================================================================
//  STRATZ GraphQL queries for the match review (ADR-029). STRATZ limits a query's
//  complexity to 310k; a full match is ~1.4M, so a match is read in parts and
//  merged by the client: summary (all 10 players, light) + your stats, events,
//  timeline (casts, hp, gold), inventory + all players' positions.
//  Field lists come from the schema (introspection, stratz-raw/schema).
// =============================================================================

export function recentMatchesQuery(account: number, take = 20): string {
  return `{ player(steamAccountId: ${account}) { matches(request: {take: ${take}}) { id startDateTime durationSeconds gameMode lobbyType didRadiantWin parsedDateTime players(steamAccountId: ${account}) { heroId isVictory position kills deaths assists } } } }`;
}

export function matchSummaryQuery(id: number): string {
  return `{ match(id: ${id}) { id durationSeconds gameMode lobbyType didRadiantWin startDateTime parsedDateTime averageRank bracket firstBloodTime bottomLaneOutcome midLaneOutcome topLaneOutcome players { playerSlot steamAccountId steamAccount { name isAnonymous } isRadiant heroId position lane role isVictory kills deaths assists networth goldPerMinute experiencePerMinute numLastHits numDenies imp level item0Id item1Id item2Id item3Id item4Id item5Id neutral0Id stats { networthPerMinute lastHitsPerMinute } } } }`;
}

/** your player in parts; each part stays under the complexity limit. */
export const ME_PARTS = {
  stats: "playerSlot heroId position isRadiant stats { lastHitsPerMinute deniesPerMinute networthPerMinute experiencePerMinute impPerMinute heroDamagePerMinute heroDamageReceivedPerMinute tripsFountainPerMinute actionsPerMinute campStack wards { time type positionX positionY } wardDestruction { time isWard } farmDistributionReport { creepLocation { id count gold xp } neutralLocation { id count gold xp } ancientLocation { id count gold xp } buildings { id count gold xp } other { id count gold xp } } heroDamageReport { dealtTotal { physicalDamage magicalDamage pureDamage stunCount stunDuration disableCount disableDuration } receivedTotal { physicalDamage magicalDamage pureDamage } } }",
  events: "playerSlot playbackData { purchaseEvents { time itemId } deathEvents { time attacker isFromIllusion target byAbility byItem goldFed xpFed timeDead reliableGold unreliableGold positionX positionY goldLost assist isWardWalkThrough isAttemptTpOut isDieBack isBurst isEngagedOnDeath hasHealAvailable isTracked isFeed } killEvents { time target positionX positionY isSolo isGank } assistEvents { time target } itemUsedEvents { time itemId attacker target } buyBackEvents { time heroId deathTimeRemaining cost } runeEvents { time rune action } abilityLearnEvents { time abilityId level isUltimate isTalent } }",
  timeline: "playerSlot playbackData { abilityUsedEvents { time abilityId target } playerUpdateHealthEvents { time hp maxHp mp maxMp } playerUpdateGoldEvents { time gold unreliableGold networth } }",
  inventory: "playerSlot playbackData { inventoryEvents { time item0 { itemId charges } item1 { itemId charges } item2 { itemId charges } item3 { itemId charges } item4 { itemId charges } item5 { itemId charges } backPack0 { itemId charges } backPack1 { itemId charges } backPack2 { itemId charges } neutral0 { itemId charges } } }",
} as const;

export function matchMeQuery(id: number, account: number, part: keyof typeof ME_PARTS): string {
  return `{ match(id: ${id}) { players(steamAccountId: ${account}) { ${ME_PARTS[part]} } } }`;
}

export function matchPositionsQuery(id: number): string {
  return `{ match(id: ${id}) { players { playerSlot isRadiant playbackData { playerUpdatePositionEvents { time x y } } } } }`;
}

/** wards placed / destroyed and stacks of all ten (the match overview, support play). */
export function matchVisionQuery(id: number): string {
  return `{ match(id: ${id}) { players { playerSlot stats { campStack wards { time type } wardDestruction { time isWard } } } } }`;
}

/** HP of all ten heroes (the battle review checks saves on your cores). */
export function matchHealthQuery(id: number): string {
  return `{ match(id: ${id}) { players { playerSlot playbackData { playerUpdateHealthEvents { time hp maxHp } } } } }`;
}

export function leaderboardQuery(take = 10): string {
  return `{ leaderboard { season(request: {take: ${take}}) { players { steamAccountId lastUpdateDateTime } } } }`;
}
